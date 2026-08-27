import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../app/http/createApp.js";
import { SessionValidationFailedError } from "../../../security/domain/errors/SessionValidationErrors.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";
import type { AuthenticatedPrincipal, ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { AuthorizeApplicationAccessService, AuthorizedApplicationAccess } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { AdminApiDeps } from "../adminApiRoutes.js";
import {
  PortalReferenceAlreadyLinkedDifferentError,
  PortalReferenceCompanyRequiredError,
  PortalReferenceLegacyIdInvalidError,
  PortalReferenceOrganizationNotActiveError,
  PortalReferenceOrganizationNotFoundError
} from "../../../organization/domain/errors/PortalOrganizationReferenceErrors.js";
import {
  PortalGroupReferenceIncompleteError,
  PortalOrganizationReferenceRequiredError
} from "../../application/errors/UserProvisioningErrors.js";

const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const IDENTITY = "8aceafb7-5ff7-4043-947b-85f035757e9e";
const ORG = "971ec096-e7de-4cc1-be06-2b4709565757";
const ACCESS = "4d982417-1cf1-4f21-ad5e-bfbf6c7fd3c1";
const MEMBERSHIP = "7a9e673b-d2c5-499a-917a-3ecf4ce41558";
const BATCH = "9bca284c-621c-4e4e-b889-42c0db889b7e";
const REFERENCIA = "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11";
const GRUPO = "1c0a9e42-6f31-4c8b-9d77-0a5b3c2e1f90";
const EMPRESA_PENDENTE = "2d1b8f53-7a42-4d9c-8e66-1b6c4d3f2a01";

/** Cobertura como o serviço de consulta a devolve para uma COMPANY vinculada. */
const COBERTURA_DE_EMPRESA = {
  organizationPublicId: ORG,
  organizationType: "COMPANY",
  organizationStatus: "ACTIVE",
  systemCode: "PCTEC_PORTAL",
  entityType: "clientes",
  covered: true,
  reference: { publicId: REFERENCIA, legacyId: 71, status: "ACTIVE" },
  group: null
};

/** Grupo com uma empresa pendente — o caso que a tela precisa saber listar. */
const COBERTURA_DE_GRUPO_PARCIAL = {
  organizationPublicId: GRUPO,
  organizationType: "BUSINESS_GROUP",
  organizationStatus: "ACTIVE",
  systemCode: "PCTEC_PORTAL",
  entityType: "clientes",
  covered: false,
  reference: null,
  group: {
    totalActiveCompanies: 2,
    linkedCompanies: 1,
    missingCompaniesCount: 1,
    missingCompanies: [
      { publicId: EMPRESA_PENDENTE, legalName: "EMPRESA PENDENTE LTDA", tradeName: "Pendente" }
    ],
    missingCompaniesTruncated: false
  }
};

const PRINCIPAL: AuthenticatedPrincipal = { identityPublicId: ADMIN, sessionPublicId: "22222222-2222-2222-2222-222222222222" };
const AUTORIZACAO: AuthorizedApplicationAccess = {
  identityPublicId: ADMIN,
  applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
  applicationCode: "PCTEC_INGRESSA",
  accessProfile: "ADMIN"
};

/** Identidade sintética — nenhum dado real de pessoa nesta suíte. */
const IDENTIDADE_SINTETICA = {
  public_id: IDENTITY,
  full_name: "Piloto Um",
  email: "piloto.um@example.invalid",
  status: "PENDING",
  type: "HUMAN",
  login_enabled: 0,
  version: 1,
  federated: true,
  externalReferences: [
    { public_id: "ref-1", system_code: "PCTEC_HELPDESK", entity_type: "users", legacy_id: 35, status: "ACTIVE" }
  ],
  memberships: [],
  applicationAccesses: []
};

let servidor: Server | undefined;

function fakeDeps(overrides: Partial<AdminApiDeps> = {}) {
  return {
    readRepository: {
      resumo: vi.fn(async () => ({ identitiesByStatus: [{ status: "ACTIVE", total: 3 }], activeMemberships: 3 })),
      listarIdentidades: vi.fn(async (f: Record<string, unknown>) => ({
        items: [IDENTIDADE_SINTETICA],
        total: 1,
        limit: Number(f["limit"] ?? 25),
        offset: 0
      })),
      detalharIdentidade: vi.fn(async (id: string) => (id === IDENTITY ? IDENTIDADE_SINTETICA : undefined)),
      listarOrganizacoes: vi.fn(async () => ({ items: [{ public_id: ORG, type: "COMPANY" }], total: 1, limit: 25, offset: 0 })),
      detalharOrganizacao: vi.fn(async (id: string) => (id === ORG ? { public_id: ORG, members: [], children: [] } : undefined)),
      listarAplicacoes: vi.fn(async () => [
        { public_id: "app-1", code: "APP_SINTETICA", name: "Aplicação Sintética", status: "ACTIVE" }
      ]),
      listarLotes: vi.fn(async () => ({ items: [{ public_id: BATCH, mode: "APPLY" }], total: 1, limit: 25, offset: 0 })),
      listarItensDoLote: vi.fn(async () => ({
        items: [
          {
            public_id: "item-1",
            action: "CREATE",
            after_snapshot: JSON.stringify({ full_name: "Piloto Um", bcrypt_hash: "nao-pode-vazar" }),
            before_snapshot: null
          }
        ],
        total: 1,
        limit: 25,
        offset: 0
      }))
    },
    grantApplicationAccessService: { execute: vi.fn(async () => ({ applicationAccessPublicId: ACCESS })) },
    revokeApplicationAccessService: { execute: vi.fn(async () => ({ applicationAccessPublicId: ACCESS, status: "REVOKED", version: 2 })) },
    createMembershipService: { execute: vi.fn(async () => ({ publicId: MEMBERSHIP })) },
    endMembershipService: { execute: vi.fn(async () => ({ publicId: MEMBERSHIP, status: "INACTIVE" })) },
    activateFederatedIdentityService: { execute: vi.fn(async () => ({ identityPublicId: IDENTITY, status: "ACTIVE", alreadyActive: false })) },
    // Associação inicial de COMPANY a BUSINESS_GROUP — rota anterior a
    // esta branch, incluída na guarda de origem a pedido da revisão.
    createOrganizationRelationshipService: {
      execute: vi.fn(async () => ({
        publicId: "bbbb2222-2222-4222-8222-222222222222",
        parentOrganizationPublicId: IDENTITY,
        childOrganizationPublicId: ORG
      }))
    },
    provisionOrganizationService: {
      execute: vi.fn(async () => ({ publicId: ORG, type: "COMPANY", status: "ACTIVE", version: 1, relationshipPublicId: null }))
    },
    provisionOrganizationUserService: {
      execute: vi.fn(async () => ({
        identityPublicId: IDENTITY,
        fullName: "Piloto Um",
        email: "piloto.um@example.invalid",
        status: "ACTIVE",
        loginEnabled: false,
        membership: { publicId: MEMBERSHIP, organizationPublicId: ORG, profile: "CUSTOMER", scope: "ORGANIZATION_ONLY", status: "ACTIVE" },
        applicationAccesses: [{ applicationCode: "PCTEC_PORTAL", accessProfile: "USER" }]
      }))
    },
    createIdentityInvitationService: {
      execute: vi.fn(async () => ({
        deliveryMode: "MANUAL_DEV",
        results: [{
          identityPublicId: IDENTITY, fullName: "Piloto Um", outcome: "CREATED", reasonCode: null,
          invitationPublicId: "aaaa1111-1111-4111-8111-111111111111",
          expiresAt: "2026-09-02T12:00:00.000Z", deliveryMode: "MANUAL_DEV", delivered: false,
          manualLink: "https://ingressa.example.invalid/convite#token-sintetico"
        }]
      }))
    },
    auditEventReadRepository: {
      listar: vi.fn(async (f: Record<string, unknown>) => ({ items: [], total: 0, limit: 25, offset: 0, filtros: f })),
      listarTiposDeEvento: vi.fn(async () => ["identity.created"])
    },
    // Cobertura do Portal — a MESMA consulta que a tela mostra e que o
    // provisionamento usa como gate.
    portalOrganizationCoverageService: {
      execute: vi.fn(async (publicId: string) => (publicId === ORG ? COBERTURA_DE_EMPRESA : undefined))
    },
    linkPortalOrganizationReferenceService: {
      execute: vi.fn(async (pedido: { organizationPublicId: string; legacyId: unknown }) => ({
        publicId: REFERENCIA,
        organizationPublicId: pedido.organizationPublicId,
        systemCode: "PCTEC_PORTAL",
        entityType: "clientes",
        legacyId: Number(pedido.legacyId),
        status: "ACTIVE",
        alreadyLinked: false
      }))
    },
    ...overrides
  } as unknown as AdminApiDeps;
}

/** Origem confiável desta suíte — nunca lida do ambiente, para o teste não depender do .env. */
const ORIGEM_CONFIAVEL = "https://ingressa.example.invalid";

async function subir(opcoes: { sessaoInvalida?: boolean; semAdmin?: boolean; deps?: AdminApiDeps } = {}) {
  const deps = opcoes.deps ?? fakeDeps();
  const app = createApp({
    allowedOrigins: [ORIGEM_CONFIAVEL],
    validateSessionService: {
      execute: async () => {
        if (opcoes.sessaoInvalida === true) throw new SessionValidationFailedError("SESSION_NOT_FOUND");
        return PRINCIPAL;
      }
    } as unknown as ValidateSessionService,
    authorizeApplicationAccessService: {
      execute: async () => {
        if (opcoes.semAdmin === true) throw new ApplicationAccessDeniedError("PROFILE_INSUFFICIENT");
        return AUTORIZACAO;
      }
    } as unknown as AuthorizeApplicationAccessService,
    adminApi: deps
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  servidor = server;
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, deps };
}

async function chamar(
  baseUrl: string,
  caminho: string,
  init: RequestInit & { comSessao?: boolean; origem?: string | null; referer?: string } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.comSessao !== false) headers["cookie"] = `${SESSION_COOKIE_NAME}=token-de-teste`;
  // Um navegador real sempre manda `Origin` numa mutação same-origin.
  // `origem: null` reproduz a requisição forjada que não manda nenhum.
  if (init.origem !== null) headers["origin"] = init.origem ?? ORIGEM_CONFIAVEL;
  if (init.referer !== undefined) headers["referer"] = init.referer;
  const r = await fetch(`${baseUrl}${caminho}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

afterEach(async () => {
  if (servidor !== undefined) {
    await new Promise<void>((r) => servidor!.close(() => r()));
    servidor = undefined;
  }
});

describe("API administrativa — autenticação e autorização", () => {
  it("401 sem sessão", async () => {
    const { baseUrl } = await subir();
    expect((await chamar(baseUrl, "/api/v1/admin/summary", { comSessao: false })).status).toBe(401);
  });

  it("401 com sessão inválida", async () => {
    const { baseUrl } = await subir({ sessaoInvalida: true });
    expect((await chamar(baseUrl, "/api/v1/admin/identities")).status).toBe(401);
  });

  it("403 para quem não é ADMIN em PCTEC_INGRESSA", async () => {
    const { baseUrl } = await subir({ semAdmin: true });
    expect((await chamar(baseUrl, "/api/v1/admin/identities")).status).toBe(403);
  });

  it("200 para ADMIN autenticado", async () => {
    const { baseUrl } = await subir();
    expect((await chamar(baseUrl, "/api/v1/admin/summary")).status).toBe(200);
  });

  it.each([
    ["/api/v1/admin/identities", "POST"],
    ["/api/v1/admin/memberships", "POST"]
  ])("mutação %s exige sessão", async (caminho, method) => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, caminho, { method, comSessao: false, body: "{}" });
    expect(r.status).toBe(401);
  });
});

describe("API administrativa — leitura", () => {
  it("lista identidades com paginação defensiva", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/identities?limit=999&status=PENDING&q=pi");

    expect(r.status).toBe(200);
    expect(r.body["total"]).toBe(1);
    const filtros = (deps.readRepository.listarIdentidades as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]?.[0];
    expect(filtros?.["status"]).toBe("PENDING");
  });

  it("404 para identidade inexistente e 422 para publicId malformado", async () => {
    const { baseUrl } = await subir();
    expect((await chamar(baseUrl, `/api/v1/admin/identities/${ORG}`)).status).toBe(404);
    expect((await chamar(baseUrl, "/api/v1/admin/identities/nao-e-uuid")).status).toBe(422);
  });

  it("itens de lote saem com snapshot redigido — o valor sensível nunca aparece", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, `/api/v1/admin/import-batches/${BATCH}/items`);

    expect(r.status).toBe(200);
    const serializado = JSON.stringify(r.body);
    expect(serializado).not.toContain("nao-pode-vazar");
    expect(serializado).toContain("[REDIGIDO]");
    expect(serializado).toContain("bcrypt_hash");
  });

  it("lista aplicações para o seletor de concessão", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/applications");

    expect(r.status).toBe(200);
    expect((r.body["items"] as { code: string }[])[0]?.code).toBe("APP_SINTETICA");
  });

  it("nenhuma resposta de leitura carrega senha, hash ou token", async () => {
    const { baseUrl } = await subir();
    for (const caminho of ["/api/v1/admin/summary", "/api/v1/admin/identities", "/api/v1/admin/organizations", "/api/v1/admin/import-batches", "/api/v1/admin/applications"]) {
      const r = await chamar(baseUrl, caminho);
      const texto = JSON.stringify(r.body).toLowerCase();
      for (const proibido of ["password", "senha", "credential", '"token"', "secret"]) {
        expect(texto).not.toContain(proibido);
      }
    }
  });
});

describe("API administrativa — mutações", () => {
  it("ativa identidade federada usando o vínculo, com o ator autenticado", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, `/api/v1/admin/identities/${IDENTITY}/activate-federated`, { method: "POST", body: "{}" });

    expect(r.status).toBe(200);
    const chamada = (deps.activateFederatedIdentityService.execute as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]?.[0];
    expect(chamada?.["legacyUserId"]).toBe(35);
    expect(chamada?.["approvedByIdentityPublicId"]).toBe(ADMIN);
  });

  it("409 ao ativar identidade sem vínculo federado", async () => {
    const deps = fakeDeps({
      readRepository: {
        ...fakeDeps().readRepository,
        detalharIdentidade: vi.fn(async () => ({ ...IDENTIDADE_SINTETICA, externalReferences: [] }))
      } as never
    });
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/identities/${IDENTITY}/activate-federated`, { method: "POST", body: "{}" });

    expect(r.status).toBe(409);
    expect((r.body["error"] as { code: string }).code).toBe("IDENTITY_NOT_FEDERATED");
  });

  it("concede acesso com o concedente vindo da sessão, nunca do corpo", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, `/api/v1/admin/identities/${IDENTITY}/application-accesses`, {
      method: "POST",
      body: JSON.stringify({ applicationCode: "PCTEC_HELPDESK", accessProfile: "USER", grantedByIdentityPublicId: "forjado" })
    });

    expect(r.status).toBe(201);
    const chamada = (deps.grantApplicationAccessService.execute as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]?.[0];
    expect(chamada?.["grantedByIdentityPublicId"]).toBe(ADMIN);
  });

  it("revoga exigindo expectedVersion — sem ela, 422", async () => {
    const { baseUrl, deps } = await subir();
    expect((await chamar(baseUrl, `/api/v1/admin/application-accesses/${ACCESS}/revoke`, { method: "POST", body: "{}" })).status).toBe(422);

    const ok = await chamar(baseUrl, `/api/v1/admin/application-accesses/${ACCESS}/revoke`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: 1 })
    });
    expect(ok.status).toBe(200);
    const chamada = (deps.revokeApplicationAccessService.execute as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]?.[0];
    expect(chamada?.["expectedVersion"]).toBe(1);
    expect(chamada?.["revokedByIdentityPublicId"]).toBe(ADMIN);
  });

  it("cria membership delegando ao serviço de domínio", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/memberships", {
      method: "POST",
      body: JSON.stringify({ identityPublicId: IDENTITY, organizationPublicId: ORG, profile: "CUSTOMER", scope: "ORGANIZATION_ONLY" })
    });

    expect(r.status).toBe(201);
    expect(deps.createMembershipService.execute).toHaveBeenCalledTimes(1);
  });

  it("encerra membership exigindo motivo", async () => {
    const { baseUrl, deps } = await subir();
    expect((await chamar(baseUrl, `/api/v1/admin/memberships/${MEMBERSHIP}/end`, { method: "POST", body: "{}" })).status).toBe(422);

    const ok = await chamar(baseUrl, `/api/v1/admin/memberships/${MEMBERSHIP}/end`, {
      method: "POST",
      body: JSON.stringify({ reason: "encerrado pelo administrador" })
    });
    expect(ok.status).toBe(200);
    expect(deps.endMembershipService.execute).toHaveBeenCalledTimes(1);
  });

  it("não existe DELETE — desativação é sempre por serviço de domínio", async () => {
    const { baseUrl } = await subir();
    for (const caminho of [`/api/v1/admin/identities/${IDENTITY}`, `/api/v1/admin/memberships/${MEMBERSHIP}`, `/api/v1/admin/application-accesses/${ACCESS}`]) {
      expect((await chamar(baseUrl, caminho, { method: "DELETE" })).status).toBe(404);
    }
  });
});

describe("API administrativa — provisionamento", () => {
  it("cria organização com 201 e devolve o publicId", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ type: "COMPANY", legalName: "EMPRESA NOVA LTDA" })
    });
    expect(r.status).toBe(201);
    expect(r.body["publicId"]).toBe(ORG);
  });

  it("razão social vazia é 422, e o serviço nem é chamado", async () => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, "/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ type: "COMPANY", legalName: "   " })
    });
    expect(r.status).toBe(422);
    expect(deps.provisionOrganizationService.execute).not.toHaveBeenCalled();
  });

  it("o ator vem da sessão, nunca do corpo", async () => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    await chamar(baseUrl, "/api/v1/admin/organizations", {
      method: "POST",
      // Tentativa explícita de forjar o ator pelo corpo.
      body: JSON.stringify({ type: "COMPANY", legalName: "X LTDA", actorPublicId: IDENTITY })
    });
    const chamada = (deps.provisionOrganizationService.execute as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(chamada.actorPublicId).toBe(ADMIN);
  });

  it("provisiona usuário e devolve o convite como fato SEPARADO", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/users`, {
      method: "POST",
      body: JSON.stringify({
        fullName: "Piloto Um", email: "piloto.um@example.invalid",
        membershipProfile: "CUSTOMER", membershipScope: "ORGANIZATION_ONLY",
        applicationCodes: ["PCTEC_PORTAL"], sendInvitation: true
      })
    });

    expect(r.status).toBe(201);
    expect(r.body["identityPublicId"]).toBe(IDENTITY);
    expect(r.body["invitationRequested"]).toBe(true);
    expect((r.body["invitation"] as Record<string, unknown>)["outcome"]).toBe("CREATED");
  });

  it("sem sendInvitation, nenhum convite é emitido", async () => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/users`, {
      method: "POST",
      body: JSON.stringify({
        fullName: "Piloto Um", email: "piloto.um@example.invalid",
        membershipProfile: "CUSTOMER", membershipScope: "ORGANIZATION_ONLY",
        applicationCodes: ["PCTEC_PORTAL"]
      })
    });

    expect(r.body["invitationRequested"]).toBe(false);
    expect(r.body["invitation"]).toBeNull();
    expect(deps.createIdentityInvitationService.execute).not.toHaveBeenCalled();
  });

  it("falha do convite NÃO derruba o provisionamento", async () => {
    const deps = fakeDeps({
      createIdentityInvitationService: {
        execute: vi.fn(async () => { throw new Error("SMTP fora do ar"); })
      } as never
    });
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/users`, {
      method: "POST",
      body: JSON.stringify({
        fullName: "Piloto Um", email: "piloto.um@example.invalid",
        membershipProfile: "CUSTOMER", membershipScope: "ORGANIZATION_ONLY",
        applicationCodes: ["PCTEC_PORTAL"], sendInvitation: true
      })
    });

    // O usuário existe. Responder erro aqui faria o ADMIN tentar criar
    // tudo de novo e bater em e-mail duplicado.
    expect(r.status).toBe(201);
    expect(r.body["identityPublicId"]).toBe(IDENTITY);
    expect((r.body["invitation"] as Record<string, unknown>)["outcome"]).toBe("FAILED");
  });
});

describe("API administrativa — auditoria", () => {
  it("lista com 200 e repassa os filtros para a projeção", async () => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    const r = await chamar(
      baseUrl,
      "/api/v1/admin/audit-events?from=2026-08-01&eventType=identity.created&limit=10"
    );

    expect(r.status).toBe(200);
    const filtros = (deps.auditEventReadRepository.listar as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(filtros).toMatchObject({ from: "2026-08-01", eventType: "identity.created", limit: "10" });
  });

  it.each(["from", "to"])("data inválida em %s é 422, e nada é consultado", async (campo) => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/audit-events?${campo}=trinta-de-fevereiro`);

    // Ignorar em silêncio devolveria a base inteira parecendo ser o
    // recorte pedido.
    expect(r.status).toBe(422);
    expect((r.body["error"] as { code: string }).code).toBe("AUDIT_PERIOD_INVALID");
    expect(deps.auditEventReadRepository.listar).not.toHaveBeenCalled();
  });

  it("os tipos de evento vêm da base", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/audit-events/event-types");
    expect(r.status).toBe(200);
    expect(r.body["items"]).toEqual(["identity.created"]);
  });

  it("auditoria exige sessão ADMIN", async () => {
    const { baseUrl } = await subir({ semAdmin: true });
    expect((await chamar(baseUrl, "/api/v1/admin/audit-events")).status).toBe(403);
  });
});

/**
 * Rotas mutáveis desta entrega que passaram a exigir origem confiável.
 *
 * A lista é o contrato: acrescentar uma rota mutável aqui sem pendurar
 * `origemSegura` nela faz estes testes falharem, em vez de deixar uma
 * porta aberta em silêncio.
 */
const MUTACOES_PROTEGIDAS: readonly { caminho: string; corpo: unknown }[] = [
  { caminho: "/api/v1/admin/organizations", corpo: { type: "COMPANY", legalName: "EMPRESA NOVA LTDA" } },
  {
    caminho: `/api/v1/admin/organizations/${ORG}/users`,
    corpo: {
      fullName: "Piloto Um", email: "piloto.um@example.invalid",
      membershipProfile: "CUSTOMER", membershipScope: "ORGANIZATION_ONLY",
      applicationCodes: ["PCTEC_PORTAL"]
    }
  },
  { caminho: `/api/v1/admin/organizations/${ORG}/parent`, corpo: { parentOrganizationPublicId: IDENTITY } },
  { caminho: `/api/v1/admin/organizations/${ORG}/portal-reference`, corpo: { legacyId: 71 } }
];

describe("API administrativa — proteção de origem (CSRF)", () => {
  it.each(MUTACOES_PROTEGIDAS.map((m) => [m.caminho, m] as const))(
    "%s aceita a origem confiável e chega ao handler",
    async (_caminho, mutacao) => {
      const { baseUrl } = await subir();
      const r = await chamar(baseUrl, mutacao.caminho, {
        method: "POST",
        body: JSON.stringify(mutacao.corpo),
        origem: ORIGEM_CONFIAVEL
      });

      // O handler respondeu de verdade — nunca 403 de origem.
      expect(r.status).toBe(201);
    }
  );

  it.each(MUTACOES_PROTEGIDAS.map((m) => [m.caminho, m] as const))(
    "%s recusa requisição SEM origem",
    async (_caminho, mutacao) => {
      const { baseUrl } = await subir();
      const r = await chamar(baseUrl, mutacao.caminho, {
        method: "POST",
        body: JSON.stringify(mutacao.corpo),
        origem: null
      });

      // Ausência de Origin e de Referer nunca é tratada como segura.
      expect(r.status).toBe(403);
      expect((r.body["error"] as { code: string }).code).toBe("CSRF_ORIGIN_REJECTED");
    }
  );

  it.each(MUTACOES_PROTEGIDAS.map((m) => [m.caminho, m] as const))(
    "%s recusa origem maliciosa",
    async (_caminho, mutacao) => {
      const { baseUrl } = await subir();
      const r = await chamar(baseUrl, mutacao.caminho, {
        method: "POST",
        body: JSON.stringify(mutacao.corpo),
        origem: "https://atacante.example.invalid"
      });

      expect(r.status).toBe(403);
      expect((r.body["error"] as { code: string }).code).toBe("CSRF_ORIGIN_REJECTED");
    }
  );

  it("origem maliciosa é barrada ANTES de o serviço ser chamado", async () => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    await chamar(baseUrl, "/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ type: "COMPANY", legalName: "EMPRESA NOVA LTDA" }),
      origem: "https://atacante.example.invalid"
    });

    // 403 depois de escrever no banco não protegeria nada.
    expect(deps.provisionOrganizationService.execute).not.toHaveBeenCalled();
  });

  it("Referer confiável basta quando o Origin não vem", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ type: "COMPANY", legalName: "EMPRESA NOVA LTDA" }),
      origem: null,
      referer: `${ORIGEM_CONFIAVEL}/admin/organizacoes`
    });

    // Regra do ADR-030, não reimplementada aqui: Origin confiável, ou
    // Referer confiável na ausência dele.
    expect(r.status).toBe(201);
  });

  it("autenticação vem ANTES da origem: sem sessão é 401, não 403", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ type: "COMPANY", legalName: "X LTDA" }),
      comSessao: false,
      origem: "https://atacante.example.invalid"
    });

    expect(r.status).toBe(401);
  });

  it("sessão ADMIN continua obrigatória mesmo com origem confiável", async () => {
    const { baseUrl } = await subir({ semAdmin: true });
    const r = await chamar(baseUrl, "/api/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ type: "COMPANY", legalName: "X LTDA" }),
      origem: ORIGEM_CONFIAVEL
    });

    // 403 de AUTORIZAÇÃO, não de origem — códigos distintos para causas
    // distintas.
    expect(r.status).toBe(403);
    expect((r.body["error"] as { code: string }).code).not.toBe("CSRF_ORIGIN_REJECTED");
  });

  it.each([
    "/api/v1/admin/audit-events",
    "/api/v1/admin/audit-events/event-types"
  ])("a auditoria é só leitura: %s responde 200 sem origem alguma", async (caminho) => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, caminho, { origem: null });

    // GET não muda estado; exigir origem aqui só quebraria leitura
    // legítima sem proteger nada.
    expect(r.status).toBe(200);
  });

  it("a auditoria não aceita mutação: POST devolve 404, não 403", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/audit-events", { method: "POST", body: "{}" });

    // É o motivo de a guarda não estar no router inteiro: 403 aqui
    // diria "sua origem não é confiável" sobre uma rota que não existe.
    expect(r.status).toBe(404);
  });
});

/**
 * Integração com o Portal — consulta de cobertura e criação do vínculo.
 *
 * O que estas rotas precisam garantir, além do óbvio: que `systemCode` e
 * `entityType` NÃO são escolhidos pelo cliente, que o ator sai da sessão,
 * que a idempotência não é confundida com criação, e que nada do que sai
 * daqui carrega segredo, documento ou id interno.
 */
describe("API administrativa — integração com o Portal", () => {
  it("o detalhe da organização carrega a cobertura junto, vinda do serviço de consulta", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}`);

    expect(r.status).toBe(200);
    expect(r.body["portal"]).toMatchObject({
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      covered: true,
      reference: { publicId: REFERENCIA, legacyId: 71, status: "ACTIVE" }
    });
    expect(deps.portalOrganizationCoverageService.execute).toHaveBeenCalledWith(ORG);
  });

  it("num grupo, a cobertura descreve o que falta — só com publicId e nomes organizacionais", async () => {
    const deps = fakeDeps({
      readRepository: {
        ...fakeDeps().readRepository,
        detalharOrganizacao: vi.fn(async () => ({ public_id: GRUPO, type: "BUSINESS_GROUP", members: [], children: [] }))
      },
      portalOrganizationCoverageService: { execute: vi.fn(async () => COBERTURA_DE_GRUPO_PARCIAL) }
    } as unknown as Partial<AdminApiDeps>);
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${GRUPO}`);

    expect(r.status).toBe(200);
    const portal = r.body["portal"] as { covered: boolean; reference: unknown; group: Record<string, unknown> };
    expect(portal.covered).toBe(false);
    // Grupo NUNCA tem referência própria, nem no contrato.
    expect(portal.reference).toBeNull();
    expect(portal.group["totalActiveCompanies"]).toBe(2);
    expect(portal.group["linkedCompanies"]).toBe(1);
    expect(portal.group["missingCompanies"]).toEqual([
      { publicId: EMPRESA_PENDENTE, legalName: "EMPRESA PENDENTE LTDA", tradeName: "Pendente" }
    ]);
    // A lista de pendentes não carrega id legado de ninguém.
    expect(JSON.stringify(portal.group["missingCompanies"])).not.toMatch(/legacy/i);
  });

  it("vincula uma COMPANY ao Portal: 201, systemCode/entityType fixos e ator da sessão", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/portal-reference`, {
      method: "POST",
      // `systemCode` e `entityType` no corpo são IGNORADOS: a rota não os
      // lê. Sem isso, esta tela seria um CLI genérico com autenticação.
      body: JSON.stringify({ legacyId: 71, systemCode: "PCTEC_HUB", entityType: "clientes_grupo" })
    });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ systemCode: "PCTEC_PORTAL", entityType: "clientes", legacyId: 71, alreadyLinked: false });
    const chamada = (deps.linkPortalOrganizationReferenceService.execute as unknown as {
      mock: { calls: Record<string, unknown>[][] };
    }).mock.calls[0]?.[0];
    expect(chamada?.["organizationPublicId"]).toBe(ORG);
    expect(chamada?.["legacyId"]).toBe(71);
    expect(chamada?.["actorPublicId"]).toBe(ADMIN);
    expect(chamada).not.toHaveProperty("systemCode");
    expect(chamada).not.toHaveProperty("entityType");
  });

  it("repetir o MESMO vínculo responde 200, não 201 — nada foi criado", async () => {
    const deps = fakeDeps({
      linkPortalOrganizationReferenceService: {
        execute: vi.fn(async () => ({
          publicId: REFERENCIA,
          organizationPublicId: ORG,
          systemCode: "PCTEC_PORTAL",
          entityType: "clientes",
          legacyId: 71,
          status: "ACTIVE",
          alreadyLinked: true
        }))
      }
    } as unknown as Partial<AdminApiDeps>);
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/portal-reference`, {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 })
    });

    expect(r.status).toBe(200);
    expect(r.body["alreadyLinked"]).toBe(true);
  });

  it.each([
    ["vínculo diferente já existente", new PortalReferenceAlreadyLinkedDifferentError(), 409, "PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT"],
    ["BUSINESS_GROUP", new PortalReferenceCompanyRequiredError(), 422, "PORTAL_REFERENCE_COMPANY_REQUIRED"],
    ["organização INACTIVE", new PortalReferenceOrganizationNotActiveError(), 422, "PORTAL_REFERENCE_ORGANIZATION_NOT_ACTIVE"],
    ["legacyId inválido", new PortalReferenceLegacyIdInvalidError(), 422, "PORTAL_REFERENCE_LEGACY_ID_INVALID"],
    ["organização inexistente", new PortalReferenceOrganizationNotFoundError(ORG), 404, "PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND"]
  ])("%s vira %s com código estável", async (_rotulo, erroDeDominio, status, code) => {
    const deps = fakeDeps({
      linkPortalOrganizationReferenceService: {
        execute: vi.fn(async () => {
          throw erroDeDominio;
        })
      }
    } as unknown as Partial<AdminApiDeps>);
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/portal-reference`, {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 })
    });

    expect(r.status).toBe(status);
    expect((r.body["error"] as { code: string }).code).toBe(code);
  });

  it("publicId malformado é 422 e o serviço nem é chamado", async () => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, "/api/v1/admin/organizations/nao-e-uuid/portal-reference", {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 })
    });

    expect(r.status).toBe(422);
    expect(deps.linkPortalOrganizationReferenceService.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["sem sessão", { comSessao: false }, 401],
    ["sem ADMIN", {}, 403]
  ])("vínculo %s é recusado pelos gates existentes, sem chegar ao serviço", async (rotulo, extra, status) => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps, ...(rotulo === "sem ADMIN" ? { semAdmin: true } : {}) });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/portal-reference`, {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 }),
      ...extra
    });

    expect(r.status).toBe(status);
    expect(deps.linkPortalOrganizationReferenceService.execute).not.toHaveBeenCalled();
  });

  it("origem insegura é barrada ANTES do serviço", async () => {
    const deps = fakeDeps();
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/portal-reference`, {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 }),
      origem: "https://atacante.example.invalid"
    });

    expect(r.status).toBe(403);
    expect(deps.linkPortalOrganizationReferenceService.execute).not.toHaveBeenCalled();
  });

  it("o provisionamento recusado por cobertura devolve código estável e os publicIds que faltam", async () => {
    const deps = fakeDeps({
      provisionOrganizationUserService: {
        execute: vi.fn(async () => {
          throw new PortalGroupReferenceIncompleteError({
            organizationPublicId: GRUPO,
            totalActiveCompanies: 2,
            linkedCompanies: 1,
            missingCompaniesCount: 1,
            missingCompanyPublicIds: [EMPRESA_PENDENTE]
          });
        })
      }
    } as unknown as Partial<AdminApiDeps>);
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${GRUPO}/users`, {
      method: "POST",
      body: JSON.stringify({
        fullName: "Piloto Um",
        email: "piloto.um@example.invalid",
        membershipProfile: "CUSTOMER",
        membershipScope: "ORGANIZATION_AND_DESCENDANTS",
        applicationCodes: ["PCTEC_PORTAL"],
        sendInvitation: true
      })
    });

    expect(r.status).toBe(422);
    const erroDaResposta = r.body["error"] as { code: string; details: Record<string, unknown>[] };
    expect(erroDaResposta.code).toBe("PORTAL_GROUP_REFERENCE_INCOMPLETE");
    expect(erroDaResposta.details[0]).toMatchObject({
      totalActiveCompanies: 2,
      linkedCompanies: 1,
      missingCompanyPublicIds: [EMPRESA_PENDENTE]
    });

    // A recusa acontece no serviço, ANTES da transação — e o convite,
    // que só existe depois do commit, nunca é emitido.
    expect(deps.createIdentityInvitationService.execute).not.toHaveBeenCalled();
  });

  it("COMPANY sem referência: o convite não é emitido quando o provisionamento recusa", async () => {
    const deps = fakeDeps({
      provisionOrganizationUserService: {
        execute: vi.fn(async () => {
          throw new PortalOrganizationReferenceRequiredError(ORG);
        })
      }
    } as unknown as Partial<AdminApiDeps>);
    const { baseUrl } = await subir({ deps });
    const r = await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/users`, {
      method: "POST",
      body: JSON.stringify({
        fullName: "Piloto Um",
        email: "piloto.um@example.invalid",
        membershipProfile: "CUSTOMER",
        membershipScope: "ORGANIZATION_ONLY",
        applicationCodes: ["PCTEC_PORTAL"],
        sendInvitation: true
      })
    });

    expect(r.status).toBe(422);
    expect((r.body["error"] as { code: string }).code).toBe("PORTAL_ORGANIZATION_REFERENCE_REQUIRED");
    expect(deps.createIdentityInvitationService.execute).not.toHaveBeenCalled();
  });

  it("nenhuma resposta do fluxo Portal carrega segredo, documento ou id interno", async () => {
    const { baseUrl } = await subir();
    const respostas = [
      await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}`),
      await chamar(baseUrl, `/api/v1/admin/organizations/${ORG}/portal-reference`, {
        method: "POST",
        body: JSON.stringify({ legacyId: 71 })
      })
    ];

    for (const resposta of respostas) {
      const texto = JSON.stringify(resposta.body).toLowerCase();
      for (const proibido of ["password", "senha", "credential", '"token"', "secret", "cnpj", "document_number", "internalid", "internal_id", "select ", "insert "]) {
        expect(texto).not.toContain(proibido);
      }
    }
  });
});
