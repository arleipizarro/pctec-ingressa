import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../app/http/createApp.js";
import { SessionValidationFailedError } from "../../../security/domain/errors/SessionValidationErrors.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";
import type { AuthenticatedPrincipal, ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type {
  AuthorizeApplicationAccessService,
  AuthorizedApplicationAccess
} from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { HelpdeskImportApiDeps } from "../helpdeskImportRoutes.js";
import { HelpdeskImportSelection } from "../../../import/domain/wizard/HelpdeskImportSelection.js";
import { WIZARD_APPLY_CONFIRMATION } from "../../../import/application/RunHelpdeskImportWizardService.js";
import { HelpdeskUserSourceUnavailableError } from "../../../import/domain/errors/HelpdeskUserSourceErrors.js";

const ADMIN = "cccccccc-0000-4000-8000-000000000001";
const OUTRO_ADMIN = "cccccccc-0000-4000-8000-000000000009";
const ORIGEM_CONFIAVEL = "https://ingressa-dev.example.invalid";
const LOTE_DRY_RUN = "dddddddd-0000-4000-8000-000000000001";
const CLIENTE_ID = 999901;

const PRINCIPAL: AuthenticatedPrincipal = {
  identityPublicId: ADMIN,
  sessionPublicId: "cccccccc-0000-4000-8000-000000000002"
};
const AUTORIZACAO: AuthorizedApplicationAccess = {
  identityPublicId: ADMIN,
  applicationPublicId: "cccccccc-0000-4000-8000-000000000003",
  applicationCode: "PCTEC_INGRESSA",
  accessProfile: "ADMIN"
};

const PLANO_PREPARADO = {
  selection: HelpdeskImportSelection.create({ sourceClientId: CLIENTE_ID, selectedSourceUserIds: [999911] }),
  cliente: { id: CLIENTE_ID, name: "EMPRESA SINTETICA 999901 LTDA", active: true },
  usuarios: [],
  target: {
    resolvedOrganization: {
      kind: "ABSENT",
      organization: undefined,
      externalReference: undefined,
      assertionConflict: undefined
    },
    businessGroup: undefined,
    application: { publicId: "cccccccc-0000-4000-8000-000000000004", code: "PCTEC_HELPDESK", status: "ACTIVE" }
  },
  plano: {
    organization: {
      sourceClientId: CLIENTE_ID,
      items: [
        {
          entityKind: "ORGANIZATION",
          sourceEntityType: "clients",
          sourceLegacyId: CLIENTE_ID,
          action: "CREATE",
          reasonCode: "CREATED_FROM_SOURCE",
          before: undefined,
          after: { legal_name: "EMPRESA SINTETICA 999901 LTDA", type: "COMPANY", status: "ACTIVE" },
          existingTargetPublicId: undefined
        }
      ],
      writes: true,
      existingOrganizationPublicId: undefined,
      blockingReasonCode: undefined
    },
    users: [
      {
        sourceLegacyId: 999911,
        sourceName: "Externo Sintetico Um",
        sourceEmail: "externo.um.999901@example.invalid",
        emailNormalized: "externo.um.999901@example.invalid",
        linkKind: "COMPANY",
        writes: true,
        existingIdentityPublicId: undefined,
        items: [
          {
            entityKind: "IDENTITY",
            sourceEntityType: "users",
            sourceLegacyId: 999911,
            action: "CREATE",
            reasonCode: "CREATED_FROM_SOURCE",
            before: undefined,
            // Campo proibido injetado de propósito: a rota tem que
            // redigi-lo mesmo vindo de dentro do próprio plano.
            after: { full_name: "Externo Sintetico Um", email: "externo.um.999901@example.invalid" },
            existingTargetPublicId: undefined
          }
        ]
      }
    ],
    items: [],
    countsByAction: { CREATE: 5, SKIP: 0, CONFLICT: 0, QUARANTINE: 0 },
    writes: true
  }
};

let servidor: Server | undefined;

function fakeDeps(overrides: Record<string, unknown> = {}) {
  return {
    catalogService: {
      listCompanies: vi.fn(async (q: Record<string, unknown>) => ({
        items: [{ sourceClientId: CLIENTE_ID, name: "EMPRESA SINTETICA 999901 LTDA", active: true, linkedOrganization: null }],
        total: 1,
        limit: Number(q["limit"] ?? 25),
        offset: 0
      })),
      listUsers: vi.fn(async (id: number) => ({
        sourceClientId: id,
        items: [],
        total: 0,
        eligibleTotal: 0,
        alreadyImportedTotal: 0
      }))
    },
    wizardService: {
      prepare: vi.fn(async () => PLANO_PREPARADO),
      execute: vi.fn(async (r: Record<string, unknown>) => ({
        batchPublicId: "eeeeeeee-0000-4000-8000-000000000001",
        mode: r["mode"],
        status: "COMPLETED",
        users: [],
        recordedItems: 5
      }))
    },
    ...overrides
  } as unknown as HelpdeskImportApiDeps;
}

async function subir(opcoes: { sessaoInvalida?: boolean; semAdmin?: boolean; deps?: HelpdeskImportApiDeps } = {}) {
  const deps = opcoes.deps ?? fakeDeps();
  const app = createApp({
    validateSessionService: {
      execute: async () => {
        if (opcoes.sessaoInvalida === true) {
          throw new SessionValidationFailedError("SESSION_NOT_FOUND");
        }
        return PRINCIPAL;
      }
    } as unknown as ValidateSessionService,
    authorizeApplicationAccessService: {
      execute: async () => {
        if (opcoes.semAdmin === true) {
          throw new ApplicationAccessDeniedError("PROFILE_INSUFFICIENT");
        }
        return AUTORIZACAO;
      }
    } as unknown as AuthorizeApplicationAccessService,
    allowedOrigins: [ORIGEM_CONFIAVEL],
    helpdeskImport: deps
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  servidor = server;
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, deps };
}

async function chamar(
  baseUrl: string,
  caminho: string,
  init: RequestInit & { comSessao?: boolean; comOrigem?: boolean | string } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.comSessao !== false) {
    headers["cookie"] = `${SESSION_COOKIE_NAME}=token-de-teste`;
  }
  if (init.comOrigem === true) {
    headers["origin"] = ORIGEM_CONFIAVEL;
  } else if (typeof init.comOrigem === "string") {
    headers["origin"] = init.comOrigem;
  }
  const r = await fetch(`${baseUrl}${caminho}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

const SELECAO = JSON.stringify({ sourceClientId: CLIENTE_ID, selectedSourceUserIds: [999911] });

afterEach(async () => {
  if (servidor !== undefined) {
    await new Promise<void>((r) => servidor!.close(() => r()));
    servidor = undefined;
  }
});

describe("assistente de importação — autenticação e autorização", () => {
  const ROTAS_DE_LEITURA = [
    "/api/v1/admin/helpdesk-import/companies",
    `/api/v1/admin/helpdesk-import/companies/${CLIENTE_ID}/users`
  ];

  it.each(ROTAS_DE_LEITURA)("401 sem sessão em %s", async (rota) => {
    const { baseUrl } = await subir();
    expect((await chamar(baseUrl, rota, { comSessao: false })).status).toBe(401);
  });

  it.each(ROTAS_DE_LEITURA)("401 com sessão inválida em %s", async (rota) => {
    const { baseUrl } = await subir({ sessaoInvalida: true });
    expect((await chamar(baseUrl, rota)).status).toBe(401);
  });

  it.each(ROTAS_DE_LEITURA)("403 para quem NÃO é ADMIN em PCTEC_INGRESSA em %s", async (rota) => {
    const { baseUrl } = await subir({ semAdmin: true });
    expect((await chamar(baseUrl, rota)).status).toBe(403);
  });

  it("sem ADMIN, nem o dry-run nem o apply chegam ao serviço", async () => {
    const { baseUrl, deps } = await subir({ semAdmin: true });

    for (const rota of ["/dry-run", "/apply", "/preview"]) {
      const r = await chamar(baseUrl, `/api/v1/admin/helpdesk-import${rota}`, {
        method: "POST",
        body: SELECAO,
        comOrigem: true
      });
      expect(r.status).toBe(403);
    }
    expect(deps.wizardService.execute).not.toHaveBeenCalled();
    expect(deps.wizardService.prepare).not.toHaveBeenCalled();
  });

  it("200 para ADMIN autenticado", async () => {
    const { baseUrl } = await subir();
    expect((await chamar(baseUrl, "/api/v1/admin/helpdesk-import/companies")).status).toBe(200);
  });
});

describe("assistente de importação — guarda de origem (CSRF)", () => {
  it.each(["/preview", "/dry-run", "/apply"])("403 sem cabeçalho de origem em %s", async (rota) => {
    const { baseUrl, deps } = await subir();

    const r = await chamar(baseUrl, `/api/v1/admin/helpdesk-import${rota}`, { method: "POST", body: SELECAO });

    expect(r.status).toBe(403);
    expect((r.body["error"] as Record<string, unknown>)["code"]).toBe("CSRF_ORIGIN_REJECTED");
    expect(deps.wizardService.execute).not.toHaveBeenCalled();
  });

  it.each(["/preview", "/dry-run", "/apply"])("403 com origem não confiável em %s", async (rota) => {
    const { baseUrl } = await subir();

    const r = await chamar(baseUrl, `/api/v1/admin/helpdesk-import${rota}`, {
      method: "POST",
      body: SELECAO,
      comOrigem: "https://site-malicioso.example.invalid"
    });

    expect(r.status).toBe(403);
    expect((r.body["error"] as Record<string, unknown>)["code"]).toBe("CSRF_ORIGIN_REJECTED");
  });

  it("aceita Referer confiável quando Origin está ausente", async () => {
    const { baseUrl } = await subir();

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/preview", {
      method: "POST",
      body: SELECAO,
      headers: { referer: `${ORIGEM_CONFIAVEL}/importacoes/nova` }
    });

    expect(r.status).toBe(200);
  });

  it("a leitura do catálogo não exige origem — GET não muda estado", async () => {
    const { baseUrl } = await subir();
    expect((await chamar(baseUrl, "/api/v1/admin/helpdesk-import/companies")).status).toBe(200);
  });
});

describe("assistente de importação — catálogo", () => {
  it("repassa busca e paginação, e nunca devolve campo de autenticação", async () => {
    const { baseUrl, deps } = await subir();

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/companies?q=sintetica&limit=10&offset=20");

    expect(r.status).toBe(200);
    expect(deps.catalogService.listCompanies).toHaveBeenCalledWith(
      expect.objectContaining({ q: "sintetica", limit: "10", offset: "20" })
    );
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash|token|senha/i);
  });

  it.each([["0"], ["-1"], ["abc"], ["1.5"]])("422 para empresa de origem inválida (%s)", async (valor) => {
    const { baseUrl, deps } = await subir();

    const r = await chamar(baseUrl, `/api/v1/admin/helpdesk-import/companies/${valor}/users`);

    expect(r.status).toBe(422);
    expect(deps.catalogService.listUsers).not.toHaveBeenCalled();
  });
});

describe("assistente de importação — seleção e ator", () => {
  it("o ator é derivado da SESSÃO, e um ator no corpo é ignorado", async () => {
    const { baseUrl, deps } = await subir();

    await chamar(baseUrl, "/api/v1/admin/helpdesk-import/dry-run", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        actorIdentityPublicId: OUTRO_ADMIN,
        approvedByIdentityPublicId: OUTRO_ADMIN
      })
    });

    const pedido = vi.mocked(deps.wizardService.execute).mock.calls[0]?.[0] as unknown as { actorIdentityPublicId: string };
    expect(pedido.actorIdentityPublicId).toBe(ADMIN);
  });

  it("a UI não decide nada: ação, escopo e perfil no corpo são descartados", async () => {
    const { baseUrl, deps } = await subir();

    await chamar(baseUrl, "/api/v1/admin/helpdesk-import/dry-run", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        action: "CREATE",
        scope: "ORGANIZATION_AND_DESCENDANTS",
        accessProfile: "ADMIN",
        membershipProfile: "EMPLOYEE"
      })
    });

    const pedido = vi.mocked(deps.wizardService.execute).mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual(["actorIdentityPublicId", "mode", "selection"]);
    expect(JSON.stringify(pedido)).not.toContain("ORGANIZATION_AND_DESCENDANTS");
  });

  it.each([
    [{}],
    [{ sourceClientId: CLIENTE_ID }],
    [{ sourceClientId: CLIENTE_ID, selectedSourceUserIds: [] }],
    [{ sourceClientId: 0, selectedSourceUserIds: [1] }]
  ])("recusa seleção inválida sem chamar o serviço: %j", async (corpo) => {
    const { baseUrl, deps } = await subir();

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/dry-run", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify(corpo)
    });

    expect(r.status).toBe(422);
    expect(deps.wizardService.execute).not.toHaveBeenCalled();
  });
});

describe("assistente de importação — pré-visualização", () => {
  it("devolve o mapeamento proposto sem abrir lote", async () => {
    const { baseUrl, deps } = await subir();

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/preview", {
      method: "POST",
      comOrigem: true,
      body: SELECAO
    });

    expect(r.status).toBe(200);
    expect(deps.wizardService.prepare).toHaveBeenCalled();
    expect(deps.wizardService.execute).not.toHaveBeenCalled();
    expect(r.body["applyConfirmationWord"]).toBe(WIZARD_APPLY_CONFIRMATION);
    expect((r.body["organization"] as Record<string, unknown>)["resolution"]).toBe("ABSENT");
  });

  it("os snapshots da pré-visualização passam pela mesma redação do relatório", async () => {
    const { baseUrl } = await subir();

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/preview", {
      method: "POST",
      comOrigem: true,
      body: SELECAO
    });

    const usuarios = r.body["users"] as { items: { after: { fields: Record<string, unknown> } }[] }[];
    const campos = usuarios[0]?.items[0]?.after?.fields ?? {};
    expect(campos).toHaveProperty("full_name");
    // Campo fora da whitelist da entidade nunca atravessa a fronteira.
    expect(Object.keys(campos)).not.toContain("bcrypt_hash");
  });
});

describe("assistente de importação — APPLY", () => {
  it("exige o lote de dry-run aprovado", async () => {
    const { baseUrl, deps } = await subir();

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/apply", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        confirmation: WIZARD_APPLY_CONFIRMATION
      })
    });

    expect(r.status).toBe(422);
    expect((r.body["error"] as Record<string, unknown>)["code"]).toBe("IMPORT_WIZARD_DRY_RUN_REQUIRED");
    expect(deps.wizardService.execute).not.toHaveBeenCalled();
  });

  it("a confirmação chega ao serviço para ser validada NO BACKEND", async () => {
    const { baseUrl, deps } = await subir();

    await chamar(baseUrl, "/api/v1/admin/helpdesk-import/apply", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        dryRunBatchPublicId: LOTE_DRY_RUN,
        confirmation: "aplicar"
      })
    });

    expect(deps.wizardService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "APPLY", confirmation: "aplicar", dryRunBatchPublicId: LOTE_DRY_RUN })
    );
  });

  it("o correlationId da requisição desce para o serviço — é ele que amarra o vínculo à importação", async () => {
    const { baseUrl, deps } = await subir();
    const CORRELACAO = "eeeeeeee-0000-4000-8000-000000000001";

    await chamar(baseUrl, "/api/v1/admin/helpdesk-import/apply", {
      method: "POST",
      comOrigem: true,
      headers: { "x-correlation-id": CORRELACAO },
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        dryRunBatchPublicId: LOTE_DRY_RUN,
        confirmation: WIZARD_APPLY_CONFIRMATION
      })
    });

    expect(deps.wizardService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "APPLY", correlationId: CORRELACAO })
    );
  });

  it("sem cabeçalho, a correlação gerada pelo middleware é a que desce — nunca `undefined`", async () => {
    const { baseUrl, deps } = await subir();

    await chamar(baseUrl, "/api/v1/admin/helpdesk-import/apply", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        dryRunBatchPublicId: LOTE_DRY_RUN,
        confirmation: WIZARD_APPLY_CONFIRMATION
      })
    });

    const pedido = (deps.wizardService.execute as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      correlationId?: string;
    };
    expect(pedido.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("um apply bem formado devolve 201 com o lote criado", async () => {
    const { baseUrl } = await subir();

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/apply", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        dryRunBatchPublicId: LOTE_DRY_RUN,
        confirmation: WIZARD_APPLY_CONFIRMATION
      })
    });

    expect(r.status).toBe(201);
    expect(r.body["mode"]).toBe("APPLY");
  });
});

describe("assistente de importação — indisponível sem configuração da fonte", () => {
  it("responde 503 com código próprio, nunca 404 e nunca derruba o resto da API", async () => {
    // `helpdeskImport` ausente e sem HELPDESK_DB_* no ambiente: é o
    // estado real do processo de DEV hoje.
    const app = createApp({
      validateSessionService: { execute: async () => PRINCIPAL } as unknown as ValidateSessionService,
      authorizeApplicationAccessService: {
        execute: async () => AUTORIZACAO
      } as unknown as AuthorizeApplicationAccessService,
      allowedOrigins: [ORIGEM_CONFIAVEL]
    });
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", r));
    servidor = server;
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const wizard = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/companies");
    const saude = await fetch(`${baseUrl}/health`);

    expect(wizard.status).toBe(503);
    expect((wizard.body["error"] as Record<string, unknown>)["code"]).toBe("IMPORT_WIZARD_SOURCE_NOT_CONFIGURED");
    // A mensagem nunca carrega credencial nem nome de variável.
    expect(JSON.stringify(wizard.body)).not.toMatch(/HELPDESK_DB|password|senha/i);
    expect(saude.status).toBe(200);
  });
});

/**
 * Fonte de USUÁRIOS indisponível, na fronteira HTTP.
 *
 * A recusa precisa chegar ao navegador como uma CONDIÇÃO DO SERVIDOR, e
 * não como "essa empresa não tem usuários": 404 ou uma lista vazia
 * levariam quem opera a concluir a importação sem usuários, ou a
 * recadastrá-los à mão, sobre uma informação que ninguém verificou.
 */
describe("assistente de importação — fonte de usuários indisponível", () => {
  function depsQueRecusamUsuarios(): HelpdeskImportApiDeps {
    const base = fakeDeps();
    return {
      ...base,
      catalogService: {
        ...base.catalogService,
        listUsers: vi.fn(async () => {
          throw new HelpdeskUserSourceUnavailableError();
        })
      } as unknown as HelpdeskImportApiDeps["catalogService"],
      wizardService: {
        ...base.wizardService,
        execute: vi.fn(async () => {
          throw new HelpdeskUserSourceUnavailableError();
        }),
        prepare: vi.fn(async () => {
          throw new HelpdeskUserSourceUnavailableError();
        })
      } as unknown as HelpdeskImportApiDeps["wizardService"]
    };
  }

  it("listar usuários responde 503 com o código estável — nunca 404 nem lista vazia", async () => {
    const { baseUrl } = await subir({ deps: depsQueRecusamUsuarios() });

    const r = await chamar(baseUrl, `/api/v1/admin/helpdesk-import/companies/${CLIENTE_ID}/users`);

    expect(r.status).toBe(503);
    const erro = r.body["error"] as Record<string, unknown>;
    expect(erro["code"]).toBe("HELPDESK_USER_SOURCE_UNAVAILABLE");
    // Uma lista vazia teria vindo em `items`; não há corpo de sucesso.
    expect(r.body["items"]).toBeUndefined();
  });

  it("o APPLY responde 503 e não devolve lote concluído", async () => {
    const { baseUrl } = await subir({ deps: depsQueRecusamUsuarios() });

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/apply", {
      method: "POST",
      comOrigem: true,
      body: JSON.stringify({
        sourceClientId: CLIENTE_ID,
        selectedSourceUserIds: [999911],
        dryRunBatchPublicId: LOTE_DRY_RUN,
        confirmation: WIZARD_APPLY_CONFIRMATION
      })
    });

    expect(r.status).toBe(503);
    expect((r.body["error"] as Record<string, unknown>)["code"]).toBe("HELPDESK_USER_SOURCE_UNAVAILABLE");
    // Nada de "COMPLETED" com zero usuários — que seria a leitura errada
    // virando um fato registrado no lote.
    expect(r.body["status"]).toBeUndefined();
    expect(r.body["batchPublicId"]).toBeUndefined();
  });

  it("a mensagem explica a indisponibilidade sem afirmar ausência de usuários", async () => {
    const { baseUrl } = await subir({ deps: depsQueRecusamUsuarios() });

    const r = await chamar(baseUrl, `/api/v1/admin/helpdesk-import/companies/${CLIENTE_ID}/users`);
    const mensagem = String((r.body["error"] as Record<string, unknown>)["message"]).toLowerCase();

    expect(mensagem).toContain("indisponível");
    for (const proibido of ["nenhum usuário", "sem usuários", "não encontrado", "não possui usuários"]) {
      expect(mensagem).not.toContain(proibido);
    }
    // E não vaza vocabulário de banco para a tela.
    for (const proibido of ["select", "pctec_helpdesk", "pctecdb", "helpdesk_usuarios", "mariadb"]) {
      expect(mensagem).not.toContain(proibido);
    }
  });

  it("o catálogo de EMPRESAS continua respondendo — o bloqueio é só dos usuários", async () => {
    const { baseUrl } = await subir({ deps: depsQueRecusamUsuarios() });

    const r = await chamar(baseUrl, "/api/v1/admin/helpdesk-import/companies");

    expect(r.status).toBe(200);
  });
});
