import { describe, expect, it } from "vitest";
import { planPilotImport, REASON } from "../domain/pilot/HelpdeskPilotPlanner.js";
import type { HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";
import type { IngressaTargetState } from "../domain/pilot/IngressaTargetState.js";
import {
  NegativeControlLeakError,
  OutOfPilotScopeError,
  PILOT_MEMBERSHIP_SCOPE
} from "../domain/pilot/HelpdeskPilotScope.js";

const ORG_PUBLIC_ID = "971ec096-e7de-4cc1-be06-2b4709565757";
const APP_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000003";
const CLIENTE_PILOTO = 75;
const RAZAO_SOCIAL = "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA - BOSQUE";

function usuario(overrides: Partial<HelpdeskUserRecord> = {}): HelpdeskUserRecord {
  return {
    id: 35,
    name: "Piloto Um",
    email: "piloto.um@example.invalid",
    role: "cliente",
    active: true,
    clientId: CLIENTE_PILOTO,
    ...overrides
  };
}

function destino(overrides: Partial<IngressaTargetState> = {}): IngressaTargetState {
  return {
    organization: { publicId: ORG_PUBLIC_ID, legalName: RAZAO_SOCIAL, type: "COMPANY", status: "ACTIVE" },
    application: { publicId: APP_PUBLIC_ID, code: "PCTEC_HELPDESK", status: "ACTIVE" },
    externalReferencesByLegacyId: new Map(),
    identitiesByEmailNormalized: new Map(),
    identitiesByPublicId: new Map(),
    membershipsByIdentityPublicId: new Map(),
    applicationAccessesByIdentityPublicId: new Map(),
    counts: { identities: 7, identityExternalReferences: 1, memberships: 3, applicationAccesses: 2 },
    ...overrides
  };
}

function planejar(users: readonly HelpdeskUserRecord[], target = destino(), client = { id: CLIENTE_PILOTO, name: RAZAO_SOCIAL, active: true }) {
  return planPilotImport({ users, client, expectedSourceClientId: CLIENTE_PILOTO, target });
}

describe("planner do piloto — primeira execução", () => {
  it("propõe as quatro criações para cada usuário do escopo", () => {
    const plano = planejar([usuario({ id: 35 }), usuario({ id: 44, email: "piloto.dois@example.invalid", name: "Piloto Dois" })]);

    expect(plano.users.map((u) => u.sourceLegacyId)).toEqual([35, 44]);
    expect(plano.countsByAction).toEqual({ CREATE: 8, SKIP: 0, CONFLICT: 0, QUARANTINE: 0 });

    for (const usuarioPlano of plano.users) {
      expect(usuarioPlano.items.map((i) => i.entityKind)).toEqual([
        "IDENTITY",
        "IDENTITY_EXTERNAL_REFERENCE",
        "MEMBERSHIP",
        "APPLICATION_ACCESS"
      ]);
      expect(usuarioPlano.items.every((i) => i.action === "CREATE")).toBe(true);
    }
  });

  it("propõe membership sempre ORGANIZATION_ONLY, na organização resolvida", () => {
    const plano = planejar([usuario()]);
    const membership = plano.items.find((i) => i.entityKind === "MEMBERSHIP");
    expect(membership?.after?.["scope"]).toBe(PILOT_MEMBERSHIP_SCOPE);
    expect(membership?.after?.["scope"]).not.toBe("ORGANIZATION_AND_DESCENDANTS");
    expect(membership?.after?.["organization_public_id"]).toBe(ORG_PUBLIC_ID);
  });

  it("marca a referência externa como CREATED_FROM_SOURCE", () => {
    const plano = planejar([usuario()]);
    const referencia = plano.items.find((i) => i.entityKind === "IDENTITY_EXTERNAL_REFERENCE");
    expect(referencia?.after?.["match_method"]).toBe("CREATED_FROM_SOURCE");
    expect(referencia?.after?.["system_code"]).toBe("PCTEC_HELPDESK");
    expect(referencia?.after?.["entity_type"]).toBe("users");
  });

  it("nenhum snapshot carrega campo de autenticação", () => {
    const plano = planejar([usuario()]);
    for (const item of plano.items) {
      const chaves = Object.keys(item.after ?? {}).join(",").toLowerCase();
      for (const proibido of ["password", "senha", "token", "hash", "salt", "secret"]) {
        expect(chaves).not.toContain(proibido);
      }
    }
  });
});

describe("planner do piloto — escopo e controle negativo", () => {
  it("recusa o usuário 45 com erro próprio, sem produzir nenhuma decisão", () => {
    expect(() => planejar([usuario({ id: 45 })])).toThrow(NegativeControlLeakError);
  });

  it.each([1, 36, 43, 46, 999])("recusa o usuário %s, fora do escopo", (id) => {
    expect(() => planejar([usuario({ id })])).toThrow(OutOfPilotScopeError);
  });

  it("recusa o lote inteiro se o controle negativo vier junto dos válidos", () => {
    expect(() => planejar([usuario({ id: 35 }), usuario({ id: 45 })])).toThrow(NegativeControlLeakError);
  });
});

describe("planner do piloto — autorização por vínculo cadastral", () => {
  it("põe em quarentena quem está em outra empresa, ainda que ativo e cliente", () => {
    const plano = planejar([usuario({ clientId: 77 })]);
    expect(plano.countsByAction.QUARANTINE).toBe(4);
    expect(plano.items.every((i) => i.reasonCode === REASON.sourceClientOutOfPilot)).toBe(true);
    expect(plano.users[0]?.writes).toBe(false);
  });

  it("põe em quarentena quem não tem vínculo cadastral nenhum", () => {
    const plano = planejar([usuario({ clientId: null })]);
    expect(plano.items.every((i) => i.reasonCode === REASON.sourceWithoutClient)).toBe(true);
  });

  it("põe em quarentena atendente e administrador — papel não é vínculo", () => {
    for (const role of ["atendente", "admin"]) {
      const plano = planejar([usuario({ role })]);
      expect(plano.items.every((i) => i.reasonCode === REASON.sourceNotExternal)).toBe(true);
    }
  });

  it("põe em quarentena usuário inativo na origem", () => {
    const plano = planejar([usuario({ active: false })]);
    expect(plano.items.every((i) => i.reasonCode === REASON.sourceInactive)).toBe(true);
  });

  it("o nome do cliente não é chave de decisão — só vai para o snapshot", () => {
    const plano = planejar([usuario()], destino(), {
      id: CLIENTE_PILOTO,
      name: "NOME COMERCIAL DIFERENTE DA RAZAO SOCIAL",
      active: true
    });

    // A associação foi afirmada pelo operador (client id + publicId) e
    // verificada contra o banco; renomear a empresa na origem não pode
    // mudar quem tem acesso a quê.
    expect(plano.countsByAction.CREATE).toBe(4);
    const membership = plano.items.find((i) => i.entityKind === "MEMBERSHIP");
    expect(membership?.after?.["source_client_name"]).toBe("NOME COMERCIAL DIFERENTE DA RAZAO SOCIAL");
    expect(membership?.after?.["source_client_id"]).toBe(CLIENTE_PILOTO);
    expect(membership?.after?.["organization_public_id"]).toBe(ORG_PUBLIC_ID);
  });
});

describe("planner do piloto — colisão de e-mail", () => {
  it("produz CONFLICT no usuário inteiro, nunca aplicação parcial", () => {
    const alvo = destino({
      identitiesByEmailNormalized: new Map([
        [
          "piloto.um@example.invalid",
          {
            publicId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            fullName: "Piloto Um Divergente",
            emailNormalized: "piloto.um@example.invalid",
            status: "ACTIVE"
          }
        ]
      ])
    });
    const plano = planejar([usuario()], alvo);

    expect(plano.countsByAction.CONFLICT).toBe(4);
    expect(plano.countsByAction.CREATE).toBe(0);
    expect(plano.users[0]?.writes).toBe(false);
    expect(plano.items.every((i) => i.reasonCode === REASON.emailBelongsToAnotherIdentity)).toBe(true);
  });
});

describe("planner do piloto — idempotência por referência externa", () => {
  const IDENTITY_PUBLIC_ID = "11111111-2222-3333-4444-555555555555";

  function alvoJaVinculado(overrides: Partial<IngressaTargetState> = {}): IngressaTargetState {
    return destino({
      externalReferencesByLegacyId: new Map([
        [
          "35",
          {
            publicId: "ref-1",
            identityPublicId: IDENTITY_PUBLIC_ID,
            legacyId: "35",
            matchMethod: "CREATED_FROM_SOURCE",
            status: "ACTIVE"
          }
        ]
      ]),
      identitiesByPublicId: new Map([
        [
          IDENTITY_PUBLIC_ID,
          {
            publicId: IDENTITY_PUBLIC_ID,
            fullName: "Piloto Um",
            emailNormalized: "piloto.um@example.invalid",
            status: "ACTIVE"
          }
        ]
      ]),
      ...overrides
    });
  }

  it("uma segunda execução sem mudanças não propõe escrita nenhuma", () => {
    const alvo = alvoJaVinculado({
      membershipsByIdentityPublicId: new Map([
        [
          IDENTITY_PUBLIC_ID,
          {
            publicId: "mem-1",
            identityPublicId: IDENTITY_PUBLIC_ID,
            organizationPublicId: ORG_PUBLIC_ID,
            profile: "CUSTOMER",
            scope: "ORGANIZATION_ONLY",
            status: "ACTIVE"
          }
        ]
      ]),
      applicationAccessesByIdentityPublicId: new Map([
        [
          IDENTITY_PUBLIC_ID,
          {
            publicId: "acc-1",
            identityPublicId: IDENTITY_PUBLIC_ID,
            applicationPublicId: APP_PUBLIC_ID,
            accessProfile: "USER",
            status: "GRANTED"
          }
        ]
      ])
    });

    const plano = planejar([usuario()], alvo);
    expect(plano.countsByAction).toEqual({ CREATE: 0, SKIP: 4, CONFLICT: 0, QUARANTINE: 0 });
    expect(plano.users[0]?.writes).toBe(false);
  });

  it("cadastro divergente vira QUARANTINE do usuário inteiro — nunca UPDATE", () => {
    const alvo = alvoJaVinculado({
      identitiesByPublicId: new Map([
        [
          IDENTITY_PUBLIC_ID,
          {
            publicId: IDENTITY_PUBLIC_ID,
            fullName: "Nome Antigo",
            emailNormalized: "piloto.um@example.invalid",
            status: "ACTIVE"
          }
        ]
      ])
    });
    const plano = planejar([usuario()], alvo);

    expect(plano.countsByAction).toEqual({ CREATE: 0, SKIP: 0, CONFLICT: 0, QUARANTINE: 4 });
    expect(plano.items.every((i) => i.reasonCode === REASON.identityUpdateUnsupported)).toBe(true);
    expect(plano.users[0]?.writes).toBe(false);
  });

  it("nenhum plano possível emite UPDATE — o apply não sabe executá-lo", () => {
    const cenarios = [
      planejar([usuario()]),
      planejar([usuario({ clientId: 77 })]),
      planejar([usuario({ active: false })]),
      planejar([usuario()], alvoJaVinculado())
    ];
    for (const plano of cenarios) {
      expect(plano.items.some((i) => (i.action as string) === "UPDATE")).toBe(false);
    }
  });

  it("recusa membership com escopo mais amplo em vez de reduzi-lo sozinho", () => {
    const alvo = alvoJaVinculado({
      membershipsByIdentityPublicId: new Map([
        [
          IDENTITY_PUBLIC_ID,
          {
            publicId: "mem-1",
            identityPublicId: IDENTITY_PUBLIC_ID,
            organizationPublicId: ORG_PUBLIC_ID,
            profile: "CUSTOMER",
            scope: "ORGANIZATION_AND_DESCENDANTS",
            status: "ACTIVE"
          }
        ]
      ])
    });
    const plano = planejar([usuario()], alvo);
    const membership = plano.items.find((i) => i.entityKind === "MEMBERSHIP");
    expect(membership?.action).toBe("CONFLICT");
    expect(membership?.reasonCode).toBe(REASON.membershipScopeDiverged);
  });
});
