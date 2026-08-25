import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../app/http/createApp.js";
import { SessionValidationFailedError } from "../../../security/domain/errors/SessionValidationErrors.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";
import type { AuthenticatedPrincipal, ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { AuthorizeApplicationAccessService, AuthorizedApplicationAccess } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { AdminApiDeps } from "../adminApiRoutes.js";

const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const IDENTITY = "8aceafb7-5ff7-4043-947b-85f035757e9e";
const ORG = "971ec096-e7de-4cc1-be06-2b4709565757";
const ACCESS = "4d982417-1cf1-4f21-ad5e-bfbf6c7fd3c1";
const MEMBERSHIP = "7a9e673b-d2c5-499a-917a-3ecf4ce41558";
const BATCH = "9bca284c-621c-4e4e-b889-42c0db889b7e";

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
    ...overrides
  } as unknown as AdminApiDeps;
}

async function subir(opcoes: { sessaoInvalida?: boolean; semAdmin?: boolean; deps?: AdminApiDeps } = {}) {
  const deps = opcoes.deps ?? fakeDeps();
  const app = createApp({
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

async function chamar(baseUrl: string, caminho: string, init: RequestInit & { comSessao?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.comSessao !== false) headers["cookie"] = `${SESSION_COOKIE_NAME}=token-de-teste`;
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
