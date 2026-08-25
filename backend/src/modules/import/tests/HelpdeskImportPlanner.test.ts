import { describe, expect, it } from "vitest";
import type { HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";
import { HelpdeskImportSelection } from "../domain/wizard/HelpdeskImportSelection.js";
import {
  SelectedSourceUserMissingError,
  UnselectedSourceUserLeakError
} from "../domain/wizard/HelpdeskImportScope.js";
import {
  membershipScopeFor,
  planImport,
  REASON,
  type ImportPlan,
  type PlannedItem,
  type SourceOrganizationLinkKind
} from "../domain/wizard/HelpdeskImportPlanner.js";
import {
  acessoConcedido,
  alvo,
  CLIENTE,
  CLIENTE_ID,
  EMPRESA,
  GRUPO_PUBLIC_ID,
  grupoElegivel,
  grupoInelegivel,
  IDENTIDADE_PUBLIC_ID,
  jaImportado,
  membershipAtiva,
  organizacaoAfirmada,
  organizacaoAfirmadaNaoResolvida,
  organizacaoAusente,
  organizacaoJaVinculada,
  OUTRA_ORG_PUBLIC_ID,
  ORG_PUBLIC_ID,
  relacaoExistente,
  usuario,
  type TargetOverrides
} from "./wizardTestSupport.js";

function planejar(
  usuarios: readonly HelpdeskUserRecord[],
  overrides: TargetOverrides = {},
  extras: {
    readonly targetOrganizationPublicId?: string;
    readonly parentBusinessGroupPublicId?: string;
    readonly linkKinds?: ReadonlyMap<number, SourceOrganizationLinkKind>;
    readonly cliente?: typeof CLIENTE;
  } = {}
): ImportPlan {
  const selection = HelpdeskImportSelection.create({
    sourceClientId: CLIENTE_ID,
    selectedSourceUserIds: usuarios.map((u) => u.id),
    targetOrganizationPublicId: extras.targetOrganizationPublicId,
    parentBusinessGroupPublicId: extras.parentBusinessGroupPublicId
  });
  return planImport({
    selection,
    users: usuarios,
    client: extras.cliente ?? CLIENTE,
    target: alvo(overrides),
    linkKindBySourceUserId: extras.linkKinds
  });
}

function acoes(items: readonly PlannedItem[]): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.entityKind, i.action]));
}

function motivos(items: readonly PlannedItem[]): readonly string[] {
  return [...new Set(items.map((i) => i.reasonCode))];
}

// =====================================================================
// Organização
// =====================================================================

describe("assistente — organização", () => {
  it("empresa sem grupo e ainda não importada: cria empresa e referência externa", () => {
    const plano = planejar([usuario()]);

    expect(acoes(plano.organization.items)).toEqual({
      ORGANIZATION: "CREATE",
      ORGANIZATION_EXTERNAL_REFERENCE: "CREATE"
    });
    // Sem grupo afirmado, nenhuma relação é proposta — o vínculo
    // grupo→empresa da origem não é legível e nunca é inferido.
    expect(plano.organization.items.some((i) => i.entityKind === "ORGANIZATION_RELATIONSHIP")).toBe(false);
    expect(plano.organization.blockingReasonCode).toBeUndefined();
  });

  it("a razão social proposta vem do nome cadastral da origem, sem documento", () => {
    const plano = planejar([usuario()]);
    const item = plano.organization.items.find((i) => i.entityKind === "ORGANIZATION");

    expect(item?.after?.["legal_name"]).toBe(CLIENTE.name);
    expect(item?.after).not.toHaveProperty("document_number");
  });

  it("organização já importada é REUTILIZADA por referência externa ativa, nunca recriada", () => {
    const plano = planejar([usuario()], { resolvedOrganization: organizacaoJaVinculada() });

    expect(acoes(plano.organization.items)).toEqual({
      ORGANIZATION: "SKIP",
      ORGANIZATION_EXTERNAL_REFERENCE: "SKIP"
    });
    expect(motivos(plano.organization.items)).toContain(REASON.organizationAlreadyLinked);
    expect(plano.organization.existingOrganizationPublicId).toBe(ORG_PUBLIC_ID);
  });

  it("destino afirmado pelo ADMIN é reutilizado e ganha a referência externa que faltava", () => {
    const plano = planejar([usuario()], { resolvedOrganization: organizacaoAfirmada() }, {
      targetOrganizationPublicId: ORG_PUBLIC_ID
    });

    // A empresa não é recriada; o que nasce é o vínculo que fará a
    // próxima execução resolver sozinha o que hoje depende de alguém
    // digitar o publicId certo.
    expect(acoes(plano.organization.items)).toEqual({
      ORGANIZATION: "SKIP",
      ORGANIZATION_EXTERNAL_REFERENCE: "CREATE"
    });
  });

  it("afirmação que contradiz a referência externa ativa BLOQUEIA o lote", () => {
    const plano = planejar(
      [usuario()],
      { resolvedOrganization: organizacaoJaVinculada(EMPRESA, "já aponta para outra") },
      { targetOrganizationPublicId: OUTRA_ORG_PUBLIC_ID }
    );

    expect(plano.organization.blockingReasonCode).toBe(REASON.organizationAssertionConflict);
    expect(plano.organization.items.every((i) => i.action === "CONFLICT")).toBe(true);
    expect(plano.writes).toBe(false);
  });

  it("destino afirmado que não é COMPANY ACTIVE bloqueia — nunca corrige por aproximação", () => {
    const plano = planejar([usuario()], { resolvedOrganization: organizacaoAfirmadaNaoResolvida() }, {
      targetOrganizationPublicId: OUTRA_ORG_PUBLIC_ID
    });

    expect(plano.organization.blockingReasonCode).toBe(REASON.organizationNotEligible);
    expect(plano.writes).toBe(false);
  });

  it("empresa inativa na origem nunca vira empresa ativa no destino", () => {
    const plano = planejar([usuario()], {}, { cliente: { ...CLIENTE, active: false } });

    expect(plano.organization.blockingReasonCode).toBe(REASON.sourceClientInactive);
    expect(plano.organization.items.every((i) => i.action === "QUARANTINE")).toBe(true);
  });
});

describe("assistente — grupo empresarial", () => {
  it("grupo afirmado e empresa nova: cria a relação explícita grupo → empresa", () => {
    const plano = planejar([usuario()], { businessGroup: grupoElegivel() }, {
      parentBusinessGroupPublicId: GRUPO_PUBLIC_ID
    });

    expect(acoes(plano.organization.items)).toEqual({
      ORGANIZATION: "CREATE",
      ORGANIZATION_EXTERNAL_REFERENCE: "CREATE",
      ORGANIZATION_RELATIONSHIP: "CREATE"
    });
  });

  it("relação já existente com o MESMO pai é SKIP, não duplicação", () => {
    const plano = planejar(
      [usuario()],
      { resolvedOrganization: organizacaoJaVinculada(), businessGroup: grupoElegivel(relacaoExistente()) },
      { parentBusinessGroupPublicId: GRUPO_PUBLIC_ID }
    );

    const relacao = plano.organization.items.find((i) => i.entityKind === "ORGANIZATION_RELATIONSHIP");
    expect(relacao?.action).toBe("SKIP");
    expect(relacao?.reasonCode).toBe(REASON.relationshipAlreadyActive);
  });

  it("empresa que já pertence a OUTRO grupo bloqueia — trocar o pai não é efeito de importação", () => {
    const plano = planejar(
      [usuario()],
      {
        resolvedOrganization: organizacaoJaVinculada(),
        businessGroup: grupoElegivel(relacaoExistente(OUTRA_ORG_PUBLIC_ID))
      },
      { parentBusinessGroupPublicId: GRUPO_PUBLIC_ID }
    );

    expect(plano.organization.blockingReasonCode).toBe(REASON.relationshipParentDiverged);
    expect(plano.writes).toBe(false);
  });

  it("grupo inelegível (inexistente, tipo errado ou inativo) bloqueia o lote", () => {
    const plano = planejar([usuario()], { businessGroup: grupoInelegivel() }, {
      parentBusinessGroupPublicId: GRUPO_PUBLIC_ID
    });

    expect(plano.organization.blockingReasonCode).toBe(REASON.businessGroupNotEligible);
  });
});

// =====================================================================
// Usuários
// =====================================================================

describe("assistente — usuário de empresa", () => {
  it("usuário externo novo produz as quatro entidades, todas CREATE", () => {
    const plano = planejar([usuario()]);

    expect(acoes(plano.users[0]!.items)).toEqual({
      IDENTITY: "CREATE",
      IDENTITY_EXTERNAL_REFERENCE: "CREATE",
      MEMBERSHIP: "CREATE",
      APPLICATION_ACCESS: "CREATE"
    });
    expect(plano.users[0]?.writes).toBe(true);
  });

  it("vínculo de empresa concede escopo ORGANIZATION_ONLY, e só ele", () => {
    const plano = planejar([usuario()]);
    const membership = plano.users[0]!.items.find((i) => i.entityKind === "MEMBERSHIP");

    expect(membership?.after?.["scope"]).toBe("ORGANIZATION_ONLY");
    expect(membership?.after?.["profile"]).toBe("CUSTOMER");
    expect(membership?.after?.["link_kind"]).toBe("COMPANY");
  });

  it("o acesso concedido é sempre PCTEC_HELPDESK/USER — nunca ADMIN", () => {
    const plano = planejar([usuario()]);
    const acesso = plano.users[0]!.items.find((i) => i.entityKind === "APPLICATION_ACCESS");

    expect(acesso?.after?.["application_code"]).toBe("PCTEC_HELPDESK");
    expect(acesso?.after?.["access_profile"]).toBe("USER");
  });

  it("nenhum snapshot carrega campo de autenticação da origem", () => {
    const plano = planejar([usuario()]);
    const chaves = plano.items.flatMap((i) => [...Object.keys(i.after ?? {}), ...Object.keys(i.before ?? {})]);

    for (const proibido of ["password", "hash", "token", "reset_expires", "salt", "secret"]) {
      expect(chaves.some((c) => c.toLowerCase().includes(proibido))).toBe(false);
    }
  });
});

describe("assistente — usuário amplo de grupo", () => {
  const AMPLO = new Map<number, SourceOrganizationLinkKind>([[999911, "BUSINESS_GROUP"]]);

  it("vínculo de grupo concede ORGANIZATION_AND_DESCENDANTS, apontando para o GRUPO", () => {
    const plano = planejar([usuario()], { businessGroup: grupoElegivel() }, {
      parentBusinessGroupPublicId: GRUPO_PUBLIC_ID,
      linkKinds: AMPLO
    });
    const membership = plano.users[0]!.items.find((i) => i.entityKind === "MEMBERSHIP");

    expect(membership?.after?.["scope"]).toBe("ORGANIZATION_AND_DESCENDANTS");
    expect(membership?.after?.["organization_public_id"]).toBe(GRUPO_PUBLIC_ID);
    expect(membership?.after?.["link_kind"]).toBe("BUSINESS_GROUP");
  });

  it("vínculo de grupo sem grupo de destino afirmado vai para QUARANTINE, não reduz escopo", () => {
    const plano = planejar([usuario()], {}, { linkKinds: AMPLO });

    expect(plano.users[0]?.items.every((i) => i.action === "QUARANTINE")).toBe(true);
    expect(motivos(plano.users[0]!.items)).toContain(REASON.businessGroupNotAsserted);
  });

  it("o escopo é função do vínculo — a tela não escolhe", () => {
    expect(membershipScopeFor("COMPANY")).toBe("ORGANIZATION_ONLY");
    expect(membershipScopeFor("BUSINESS_GROUP")).toBe("ORGANIZATION_AND_DESCENDANTS");
  });
});

describe("assistente — recusas de origem", () => {
  it("usuário INTERNO não recebe membership automático em cliente", () => {
    const plano = planejar([usuario({ role: "atendente", clientId: CLIENTE_ID })]);

    expect(plano.users[0]?.items.every((i) => i.action === "QUARANTINE")).toBe(true);
    expect(motivos(plano.users[0]!.items)).toContain(REASON.sourceNotExternal);
    expect(plano.users[0]?.writes).toBe(false);
  });

  it("usuário inativo na origem não vira acesso no destino", () => {
    const plano = planejar([usuario({ active: false })]);
    expect(motivos(plano.users[0]!.items)).toContain(REASON.sourceInactive);
  });

  it("usuário sem vínculo cadastral com empresa nenhuma vai para QUARANTINE", () => {
    const plano = planejar([usuario({ clientId: null })]);
    expect(motivos(plano.users[0]!.items)).toContain(REASON.sourceWithoutClient);
  });

  it("vínculo ambíguo — client_id diferente do selecionado — nunca vira CREATE por aproximação", () => {
    const plano = planejar([usuario({ clientId: 999977 })]);

    expect(motivos(plano.users[0]!.items)).toContain(REASON.sourceClientOutOfSelection);
    expect(plano.users[0]?.items.some((i) => i.action === "CREATE")).toBe(false);
  });

  it.each([[""], ["   "], ["sem-arroba"], ["@sem-local.invalid"]])(
    "e-mail inválido (%s) vai para QUARANTINE, nunca vira Identity",
    (email) => {
      const plano = planejar([usuario({ email })]);
      expect(motivos(plano.users[0]!.items)).toContain(REASON.sourceEmailInvalid);
      expect(plano.users[0]?.writes).toBe(false);
    }
  );

  it("e-mail duplicado DENTRO da seleção coloca AMBOS em CONFLICT", () => {
    const plano = planejar([
      usuario({ id: 999911, email: "repetido.999901@example.invalid" }),
      usuario({ id: 999912, name: "Externo Sintetico Dois", email: "REPETIDO.999901@example.invalid" })
    ]);

    expect(plano.users).toHaveLength(2);
    for (const usuarioPlano of plano.users) {
      expect(usuarioPlano.items.every((i) => i.action === "CONFLICT")).toBe(true);
      expect(usuarioPlano.writes).toBe(false);
    }
    expect(motivos(plano.users[0]!.items)).toContain(REASON.sourceEmailDuplicated);
  });

  it("e-mail que já pertence a outra Identity vira CONFLICT — associar por e-mail exige humano", () => {
    const user = usuario();
    const plano = planejar([user], {
      identitiesByEmailNormalized: new Map([
        [
          user.email,
          { publicId: "aaaaaaaf-0000-4000-8000-00000000000f", fullName: "Outra Pessoa", emailNormalized: user.email, status: "ACTIVE" }
        ]
      ])
    });

    expect(motivos(plano.users[0]!.items)).toContain(REASON.emailBelongsToAnotherIdentity);
    expect(plano.users[0]?.items.every((i) => i.action === "CONFLICT")).toBe(true);
  });
});

describe("assistente — reconciliação de quem já foi importado", () => {
  it("usuário já importado resulta em SKIP, nunca em duplicação", () => {
    const user = usuario();
    const plano = planejar([user], {
      resolvedOrganization: organizacaoJaVinculada(),
      ...jaImportado(user, {
        membershipsByIdentityPublicId: membershipAtiva(),
        applicationAccessesByIdentityPublicId: acessoConcedido()
      })
    });

    expect(acoes(plano.users[0]!.items)).toEqual({
      IDENTITY: "SKIP",
      IDENTITY_EXTERNAL_REFERENCE: "SKIP",
      MEMBERSHIP: "SKIP",
      APPLICATION_ACCESS: "SKIP"
    });
    expect(plano.users[0]?.writes).toBe(false);
    expect(plano.writes).toBe(false);
  });

  it("vinculado mas sem membership: cria só o que falta", () => {
    const user = usuario();
    const plano = planejar([user], {
      resolvedOrganization: organizacaoJaVinculada(),
      ...jaImportado(user, { applicationAccessesByIdentityPublicId: acessoConcedido() })
    });

    expect(acoes(plano.users[0]!.items)).toEqual({
      IDENTITY: "SKIP",
      IDENTITY_EXTERNAL_REFERENCE: "SKIP",
      MEMBERSHIP: "CREATE",
      APPLICATION_ACCESS: "SKIP"
    });
    expect(plano.users[0]?.writes).toBe(true);
  });

  it("cadastro divergente na origem vira QUARANTINE do usuário inteiro — não UPDATE", () => {
    const user = usuario();
    const importado = jaImportado(user);
    const plano = planejar([user], {
      resolvedOrganization: organizacaoJaVinculada(),
      ...importado,
      identitiesByPublicId: new Map([
        [
          IDENTIDADE_PUBLIC_ID,
          { publicId: IDENTIDADE_PUBLIC_ID, fullName: "Nome Antigo", emailNormalized: user.email, status: "ACTIVE" }
        ]
      ])
    });

    expect(plano.users[0]?.items.every((i) => i.action === "QUARANTINE")).toBe(true);
    expect(motivos(plano.users[0]!.items)).toContain(REASON.identityUpdateUnsupported);
    expect(plano.items.some((i) => i.action === "CREATE" && i.entityKind === "IDENTITY")).toBe(false);
  });

  it("membership com escopo mais amplo do que o vínculo concede vira CONFLICT e zera a escrita do usuário", () => {
    const user = usuario();
    const plano = planejar([user], {
      resolvedOrganization: organizacaoJaVinculada(),
      ...jaImportado(user, {
        membershipsByIdentityPublicId: membershipAtiva(ORG_PUBLIC_ID, "ORGANIZATION_AND_DESCENDANTS")
      })
    });

    const membership = plano.users[0]!.items.find((i) => i.entityKind === "MEMBERSHIP");
    expect(membership?.action).toBe("CONFLICT");
    expect(membership?.reasonCode).toBe(REASON.membershipScopeDiverged);
    // Conceder o acesso de alguém cuja membership está em conflito é a
    // concessão parcial não auditada que a fatia proíbe.
    expect(plano.users[0]?.writes).toBe(false);
  });
});

describe("assistente — travas de escopo", () => {
  it("organização bloqueada bloqueia TODOS os usuários do lote", () => {
    const plano = planejar([usuario(), usuario({ id: 999912, email: "dois.999901@example.invalid" })], {
      businessGroup: grupoInelegivel()
    }, { parentBusinessGroupPublicId: GRUPO_PUBLIC_ID });

    expect(plano.users).toHaveLength(2);
    for (const usuarioPlano of plano.users) {
      expect(usuarioPlano.items.every((i) => i.action === "QUARANTINE")).toBe(true);
      expect(motivos(usuarioPlano.items)).toContain(REASON.organizationNotResolved);
    }
    expect(plano.writes).toBe(false);
  });

  it("CONTROLE NEGATIVO: usuário não selecionado devolvido pela fonte derruba a execução", () => {
    const selection = HelpdeskImportSelection.create({
      sourceClientId: CLIENTE_ID,
      selectedSourceUserIds: [999911]
    });

    expect(() =>
      planImport({
        selection,
        users: [usuario({ id: 999911 }), usuario({ id: 999945, email: "nao.selecionado@example.invalid" })],
        client: CLIENTE,
        target: alvo()
      })
    ).toThrow(UnselectedSourceUserLeakError);
  });

  it("o não selecionado fica AUSENTE do lote — nem CREATE, nem SKIP", () => {
    const plano = planejar([usuario({ id: 999911 })]);
    const ids = new Set(plano.items.filter((i) => i.sourceEntityType === "users").map((i) => i.sourceLegacyId));

    expect(ids).toEqual(new Set([999911]));
    expect(ids.has(999945)).toBe(false);
  });

  it("usuário selecionado que sumiu da origem impede a abertura do lote", () => {
    const selection = HelpdeskImportSelection.create({
      sourceClientId: CLIENTE_ID,
      selectedSourceUserIds: [999911, 999912]
    });

    expect(() =>
      planImport({ selection, users: [usuario({ id: 999911 })], client: CLIENTE, target: alvo() })
    ).toThrow(SelectedSourceUserMissingError);
  });

  it("as contagens por ação somam exatamente os itens do plano", () => {
    const plano = planejar([usuario(), usuario({ id: 999912, email: "dois.999901@example.invalid" })]);
    const soma = Object.values(plano.countsByAction).reduce((a, b) => a + b, 0);

    expect(soma).toBe(plano.items.length);
    expect(plano.items.length).toBe(2 + 2 * 4);
  });

  it("sem organização resolvida, o snapshot de membership afirma null — nunca um publicId inventado", () => {
    const plano = planejar([usuario()], { resolvedOrganization: organizacaoAusente() });
    const membership = plano.users[0]!.items.find((i) => i.entityKind === "MEMBERSHIP");

    expect(membership?.after?.["organization_public_id"]).toBeNull();
  });
});
