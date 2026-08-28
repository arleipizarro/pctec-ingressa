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
import type { PortalCatalogApiDeps } from "../portalCatalogRoutes.js";
import { PORTAL_RECONCILIATION_CONFIRMATION } from "../../../portal/application/ReconcilePortalOrganizationReferencesService.js";

const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ORG = "971ec096-e7de-4cc1-be06-2b4709565757";
const CNPJ = "11222333000181";
const ORIGEM_CONFIAVEL = "https://ingressa.example.invalid";

const PRINCIPAL: AuthenticatedPrincipal = {
  identityPublicId: ADMIN,
  sessionPublicId: "22222222-2222-2222-2222-222222222222"
};
const AUTORIZACAO: AuthorizedApplicationAccess = {
  identityPublicId: ADMIN,
  applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
  applicationCode: "PCTEC_INGRESSA",
  accessProfile: "ADMIN"
};

let servidor: Server | undefined;

function fakeDeps(overrides: Partial<PortalCatalogApiDeps> = {}): PortalCatalogApiDeps {
  return {
    catalogService: {
      execute: vi.fn(async (f: Record<string, unknown>) => ({
        items: [
          {
            legacyId: 71,
            name: "CLIENTE SINTETICO",
            tradeName: "Sintético",
            documentMasked: "**.***.333/0001-81",
            hasDocument: true,
            active: true
          }
        ],
        total: 1,
        limit: 10,
        offset: Number(f["offset"] ?? 0)
      }))
    },
    matchService: {
      execute: vi.fn(async (publicId: string) => ({
        organizationPublicId: publicId,
        status: "EXACT_UNIQUE",
        hasDocument: true,
        candidateCount: 1,
        suggestion: {
          legacyId: 71,
          name: "CLIENTE SINTETICO",
          tradeName: "Sintético",
          documentMasked: "**.***.333/0001-81",
          active: true
        }
      }))
    },
    confirmSelectionService: {
      execute: vi.fn(async (pedido: { legacyId: unknown }) => ({
        publicId: "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11",
        organizationPublicId: ORG,
        systemCode: "PCTEC_PORTAL",
        entityType: "clientes",
        legacyId: Number(pedido.legacyId),
        status: "ACTIVE",
        alreadyLinked: false,
        clientName: "CLIENTE SINTETICO",
        clientDocumentMasked: "**.***.333/0001-81"
      }))
    },
    reconciliationService: {
      dryRun: vi.fn(async () => ({
        items: [
          {
            organizationPublicId: ORG,
            legalName: "UNICA LTDA",
            tradeName: null,
            status: "EXACT_UNIQUE",
            hasDocument: true,
            candidateCount: 1,
            suggestedLegacyId: 71,
            suggestedClientName: "CLIENTE SINTETICO",
            suggestedClientDocumentMasked: "**.***.333/0001-81"
          }
        ],
        counts: { EXACT_UNIQUE: 1, NOT_FOUND: 0, AMBIGUOUS: 0, DOCUMENT_MISSING_OR_INVALID: 0, ALREADY_LINKED: 0 },
        total: 1,
        limit: 50,
        offset: 0,
        eligibleCount: 1
      })),
      execute: vi.fn(async () => ({
        items: [
          {
            organizationPublicId: ORG,
            legalName: "UNICA LTDA",
            status: "LINKED",
            legacyId: 71,
            referencePublicId: "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11",
            reasonCode: null
          }
        ],
        linked: 1,
        alreadyLinked: 0,
        skipped: 0,
        failed: 0
      }))
    },
    ...overrides
  } as unknown as PortalCatalogApiDeps;
}

async function subir(
  opcoes: { sessaoInvalida?: boolean; semAdmin?: boolean; deps?: PortalCatalogApiDeps; semCatalogo?: boolean } = {}
) {
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
    ...(opcoes.semCatalogo === true ? {} : { portalCatalog: deps })
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  servidor = server;
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, deps };
}

async function chamar(
  baseUrl: string,
  caminho: string,
  init: RequestInit & { comSessao?: boolean; origem?: string | null } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.comSessao !== false) headers["cookie"] = `${SESSION_COOKIE_NAME}=token-de-teste`;
  if (init.origem !== null) headers["origin"] = init.origem ?? ORIGEM_CONFIAVEL;
  const r = await fetch(`${baseUrl}${caminho}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  const texto = await r.text();
  return { status: r.status, texto, body: (texto.length > 0 ? JSON.parse(texto) : {}) as Record<string, unknown> };
}

afterEach(async () => {
  if (servidor !== undefined) {
    await new Promise<void>((r) => servidor!.close(() => r()));
    servidor = undefined;
  }
});

const ROTAS_DE_LEITURA = [
  "/api/v1/admin/portal-catalog/clients?q=sintetico",
  `/api/v1/admin/portal-catalog/organizations/${ORG}/match`,
  "/api/v1/admin/portal-catalog/reconciliation/dry-run"
];

describe("catálogo do Portal — autenticação e autorização", () => {
  it.each(ROTAS_DE_LEITURA)("401 sem sessão em %s", async (caminho) => {
    const { baseUrl } = await subir();
    expect((await chamar(baseUrl, caminho, { comSessao: false })).status).toBe(401);
  });

  it.each(ROTAS_DE_LEITURA)("401 com sessão inválida em %s", async (caminho) => {
    const { baseUrl } = await subir({ sessaoInvalida: true });
    expect((await chamar(baseUrl, caminho)).status).toBe(401);
  });

  it.each(ROTAS_DE_LEITURA)("403 para quem não é ADMIN em %s", async (caminho) => {
    const { baseUrl } = await subir({ semAdmin: true });
    expect((await chamar(baseUrl, caminho)).status).toBe(403);
  });

  it("a execução da reconciliação também exige sessão e ADMIN", async () => {
    const semSessao = await subir();
    expect(
      (await chamar(semSessao.baseUrl, "/api/v1/admin/portal-catalog/reconciliation/execute", {
        method: "POST",
        comSessao: false,
        body: "{}"
      })).status
    ).toBe(401);
    await new Promise<void>((r) => servidor!.close(() => r()));
    servidor = undefined;

    const semAdmin = await subir({ semAdmin: true });
    expect(
      (await chamar(semAdmin.baseUrl, "/api/v1/admin/portal-catalog/reconciliation/execute", {
        method: "POST",
        body: "{}"
      })).status
    ).toBe(403);
  });
});

describe("catálogo do Portal — guarda de origem", () => {
  it("403 na execução sem cabeçalho Origin", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/portal-catalog/reconciliation/execute", {
      method: "POST",
      origem: null,
      body: JSON.stringify({ organizationPublicIds: [ORG], confirmation: PORTAL_RECONCILIATION_CONFIRMATION })
    });
    expect(r.status).toBe(403);
    expect(deps.reconciliationService.execute).not.toHaveBeenCalled();
  });

  it("403 na execução com origem desconhecida", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/portal-catalog/reconciliation/execute", {
      method: "POST",
      origem: "https://atacante.example.invalid",
      body: JSON.stringify({ organizationPublicIds: [ORG], confirmation: PORTAL_RECONCILIATION_CONFIRMATION })
    });
    expect(r.status).toBe(403);
    expect(deps.reconciliationService.execute).not.toHaveBeenCalled();
  });

  it("o dry-run é GET e por isso não passa pela guarda de origem — porque não escreve", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/portal-catalog/reconciliation/dry-run", { origem: null });
    expect(r.status).toBe(200);
  });
});

describe("catálogo do Portal — contrato", () => {
  it("busca repassa o termo e devolve CNPJ mascarado", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/portal-catalog/clients?q=sintetico&limit=5");

    expect(r.status).toBe(200);
    expect(deps.catalogService.execute).toHaveBeenCalledWith(expect.objectContaining({ q: "sintetico", limit: "5" }));
    expect(r.texto).toContain("**.***.333/0001-81");
    expect(r.texto).not.toContain(CNPJ);
  });

  it("422 para publicId malformado na correspondência, sem chegar ao serviço", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/portal-catalog/organizations/nao-e-uuid/match");

    expect(r.status).toBe(422);
    expect(deps.matchService.execute).not.toHaveBeenCalled();
  });

  it("a execução manda o ator da SESSÃO — nunca o que vier no corpo", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/portal-catalog/reconciliation/execute", {
      method: "POST",
      body: JSON.stringify({
        organizationPublicIds: [ORG],
        confirmation: PORTAL_RECONCILIATION_CONFIRMATION,
        actorPublicId: "11111111-1111-4111-8111-111111111111"
      })
    });

    expect(r.status).toBe(200);
    expect(deps.reconciliationService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorPublicId: ADMIN, confirmation: PORTAL_RECONCILIATION_CONFIRMATION })
    );
  });

  it("nenhuma resposta carrega segredo, SQL, documento inteiro ou id interno", async () => {
    const { baseUrl } = await subir();
    const respostas = [
      await chamar(baseUrl, "/api/v1/admin/portal-catalog/clients?q=sintetico"),
      await chamar(baseUrl, `/api/v1/admin/portal-catalog/organizations/${ORG}/match`),
      await chamar(baseUrl, "/api/v1/admin/portal-catalog/reconciliation/dry-run"),
      await chamar(baseUrl, "/api/v1/admin/portal-catalog/reconciliation/execute", {
        method: "POST",
        body: JSON.stringify({ organizationPublicIds: [ORG], confirmation: PORTAL_RECONCILIATION_CONFIRMATION })
      })
    ];

    for (const resposta of respostas) {
      const corpo = resposta.texto.toLowerCase();
      for (const proibido of [
        "password", "senha", "token", "secret", "credential",
        "select ", "insert ", "update ", "delete ",
        "internalid", "internal_id",
        "portal_source_db", "mysql", "mariadb",
        cnpjEmMinusculas()
      ]) {
        expect(corpo).not.toContain(proibido);
      }
    }
  });
});

describe("catálogo do Portal — confirmação do cliente selecionado", () => {
  const CAMINHO = `/api/v1/admin/portal-catalog/organizations/${ORG}/link`;

  it("201 ao criar, mandando SÓ o legacyId e o ator da sessão ao serviço", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, CAMINHO, {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 })
    });

    expect(r.status).toBe(201);
    expect(deps.confirmSelectionService.execute).toHaveBeenCalledWith({
      organizationPublicId: ORG,
      legacyId: 71,
      actorPublicId: ADMIN,
      correlationId: expect.anything()
    });
  });

  it("200 quando o vínculo idêntico já existia", async () => {
    const deps = fakeDeps({
      confirmSelectionService: {
        execute: vi.fn(async () => ({
          publicId: "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11",
          organizationPublicId: ORG,
          systemCode: "PCTEC_PORTAL",
          entityType: "clientes",
          legacyId: 71,
          status: "ACTIVE",
          alreadyLinked: true,
          clientName: "CLIENTE SINTETICO",
          clientDocumentMasked: "**.***.333/0001-81"
        }))
      }
    } as unknown as Partial<PortalCatalogApiDeps>);
    const { baseUrl } = await subir({ deps });

    const r = await chamar(baseUrl, CAMINHO, { method: "POST", body: JSON.stringify({ legacyId: 71 }) });
    expect(r.status).toBe(200);
  });

  it("descarta na fronteira qualquer dado comercial que o navegador mande junto", async () => {
    const { baseUrl, deps } = await subir();
    await chamar(baseUrl, CAMINHO, {
      method: "POST",
      body: JSON.stringify({
        legacyId: 71,
        // Tudo abaixo é ignorado: o servidor relê o cliente na fonte.
        name: "NOME INVENTADO",
        documentNumber: "99999999999999",
        active: true,
        systemCode: "PCTEC_HUB",
        entityType: "clientes_grupo",
        actorPublicId: "11111111-1111-4111-8111-111111111111"
      })
    });

    const pedido = (deps.confirmSelectionService.execute as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual(
      ["actorPublicId", "correlationId", "legacyId", "organizationPublicId"].sort()
    );
    expect(pedido["actorPublicId"]).toBe(ADMIN);
  });

  it("403 sem origem confiável, e o serviço nunca é chamado", async () => {
    const { baseUrl, deps } = await subir();
    const semOrigem = await chamar(baseUrl, CAMINHO, {
      method: "POST",
      origem: null,
      body: JSON.stringify({ legacyId: 71 })
    });
    const origemEstranha = await chamar(baseUrl, CAMINHO, {
      method: "POST",
      origem: "https://atacante.example.invalid",
      body: JSON.stringify({ legacyId: 71 })
    });

    expect(semOrigem.status).toBe(403);
    expect(origemEstranha.status).toBe(403);
    expect(deps.confirmSelectionService.execute).not.toHaveBeenCalled();
  });

  it("401 sem sessão e 403 sem ADMIN", async () => {
    const semSessao = await subir();
    expect(
      (await chamar(semSessao.baseUrl, CAMINHO, { method: "POST", comSessao: false, body: "{}" })).status
    ).toBe(401);
    await new Promise<void>((r) => servidor!.close(() => r()));
    servidor = undefined;

    const semAdmin = await subir({ semAdmin: true });
    expect((await chamar(semAdmin.baseUrl, CAMINHO, { method: "POST", body: "{}" })).status).toBe(403);
  });

  it("422 para publicId malformado, sem chegar ao serviço", async () => {
    const { baseUrl, deps } = await subir();
    const r = await chamar(baseUrl, "/api/v1/admin/portal-catalog/organizations/nao-e-uuid/link", {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 })
    });

    expect(r.status).toBe(422);
    expect(deps.confirmSelectionService.execute).not.toHaveBeenCalled();
  });

  it("a resposta não devolve o documento inteiro", async () => {
    const { baseUrl } = await subir();
    const r = await chamar(baseUrl, CAMINHO, { method: "POST", body: JSON.stringify({ legacyId: 71 }) });

    expect(r.texto).toContain("**.***.333/0001-81");
    expect(r.texto).not.toContain(CNPJ);
  });
});

describe("catálogo do Portal — fonte não configurada", () => {
  it("503 com código próprio, e sem revelar nome de variável nem credencial", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { baseUrl } = await subir({ semCatalogo: true });

    for (const caminho of ROTAS_DE_LEITURA) {
      const r = await chamar(baseUrl, caminho);
      expect(r.status).toBe(503);
      expect((r.body["error"] as { code: string }).code).toBe("PORTAL_CATALOG_SOURCE_NOT_CONFIGURED");
    }

    // A confirmação também: sem a fonte não há como reler o cliente, e
    // escrever sem reler é justamente o que esta rota existe para evitar.
    const confirmacao = await chamar(baseUrl, `/api/v1/admin/portal-catalog/organizations/${ORG}/link`, {
      method: "POST",
      body: JSON.stringify({ legacyId: 71 })
    });
    expect(confirmacao.status).toBe(503);

    for (const caminho of ROTAS_DE_LEITURA) {
      const r = await chamar(baseUrl, caminho);
      expect(r.status).toBe(503);
      expect((r.body["error"] as { code: string }).code).toBe("PORTAL_CATALOG_SOURCE_NOT_CONFIGURED");
      const corpo = r.texto.toUpperCase();
      expect(corpo).not.toContain("PORTAL_SOURCE_DB");
      expect(corpo).not.toContain("PASSWORD");
      expect(corpo).not.toContain("ENV-FILE");
    }
    aviso.mockRestore();
  });

  it("a indisponibilidade do catálogo NÃO derruba o resto da API", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { baseUrl } = await subir({ semCatalogo: true });
    // `/health` não depende de sessão nem do Portal — se o boot tivesse
    // caído, nem isto responderia.
    expect((await chamar(baseUrl, "/health", { comSessao: false })).status).toBe(200);
    aviso.mockRestore();
  });
});

/** O CNPJ sintético em minúsculas, para a varredura case-insensitive. */
function cnpjEmMinusculas(): string {
  return CNPJ.toLowerCase();
}
