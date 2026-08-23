import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../application/GetPortalContextService.js";
import type {
  AuthorizeApplicationAccessService,
  AuthorizedApplicationAccess
} from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import type { GetActiveIdentityExternalReferenceService } from "../../../identity/application/GetActiveIdentityExternalReferenceService.js";
import type {
  PortalTenantScopeResult,
  ResolvePortalTenantScopeService
} from "../../application/ResolvePortalTenantScopeService.js";
import type { PortalContextResult } from "../../application/GetPortalContextService.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import { OrganizationAccessDeniedError } from "../../domain/errors/PortalErrors.js";
import { OrganizationExternalReferenceNotFoundError } from "../../../organization/domain/errors/OrganizationExternalReferenceErrors.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../requireServiceCredential.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const AFIP_GROUP_PUBLIC_ID = "cc9c41b2-425b-48f2-82d9-506d396c2562";
const BOSQUE_PUBLIC_ID = "971ec096-e7de-4cc1-be06-2b4709565757";
const BELGICA_PUBLIC_ID = "e99baabc-a86a-404e-982c-59b744627aba";
const REAL_SERVICE_CREDENTIAL = "segredo-de-teste-p1d-tenant-scope";

const GROUP_SCOPE: PortalTenantScopeResult = {
  selection: {
    publicId: AFIP_GROUP_PUBLIC_ID,
    type: "BUSINESS_GROUP",
    legalName: "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA",
    tradeName: "AFIP"
  },
  organizations: [
    {
      publicId: BELGICA_PUBLIC_ID,
      type: "COMPANY",
      legalName: "AFIP BELGICA",
      tradeName: "AFIP - BELGICA",
      legacyId: 77
    },
    {
      publicId: BOSQUE_PUBLIC_ID,
      type: "COMPANY",
      legalName: "AFIP BOSQUE",
      tradeName: "AFIP - BOSQUE",
      legacyId: 75
    }
  ]
};

const COMPANY_SCOPE: PortalTenantScopeResult = {
  selection: {
    publicId: BOSQUE_PUBLIC_ID,
    type: "COMPANY",
    legalName: "AFIP BOSQUE",
    tradeName: "AFIP - BOSQUE"
  },
  organizations: [
    {
      publicId: BOSQUE_PUBLIC_ID,
      type: "COMPANY",
      legalName: "AFIP BOSQUE",
      tradeName: "AFIP - BOSQUE",
      legacyId: 75
    }
  ]
};

interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
}
function extractError(body: Record<string, unknown>): ErrorEnvelope {
  return body["error"] as ErrorEnvelope;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeAuthorizeApplicationAccessService {
  public calls: Array<{ identityPublicId: string; applicationCode: string; requiredProfile: string }> = [];
  public shouldGrant = true;

  public async execute(request: {
    identityPublicId: string;
    applicationCode: string;
    requiredProfile: string;
  }): Promise<AuthorizedApplicationAccess> {
    this.calls.push(request);
    if (!this.shouldGrant) {
      throw new ApplicationAccessDeniedError("ACCESS_NOT_FOUND");
    }
    return {
      identityPublicId: request.identityPublicId,
      applicationPublicId: "3f9c1a2e-7d4b-4e5a-9c3f-000000000001",
      applicationCode: request.applicationCode,
      accessProfile: request.requiredProfile
    };
  }
}

class FakeRequireOrganizationAccessService {
  public calls: Array<{ identityPublicId: string; organizationPublicId: string }> = [];
  public shouldAllow = true;
  /**
   * Contexto devolvido após autorizar — é o que a rota repassa como
   * conjunto autorizado ao tenant-scope (C-1). Por padrão, o grupo
   * AFIP com as duas filhas alcançáveis.
   */
  public context: PortalContextResult = {
    identityPublicId: VALID_IDENTITY_PUBLIC_ID,
    organizations: [
      { publicId: AFIP_GROUP_PUBLIC_ID, type: "BUSINESS_GROUP", legalName: "AFIP", tradeName: "AFIP" },
      { publicId: BELGICA_PUBLIC_ID, type: "COMPANY", legalName: "AFIP BELGICA", tradeName: "AFIP - BELGICA" },
      { publicId: BOSQUE_PUBLIC_ID, type: "COMPANY", legalName: "AFIP BOSQUE", tradeName: "AFIP - BOSQUE" }
    ]
  };

  public async execute(identityPublicId: string, organizationPublicId: string): Promise<PortalContextResult> {
    this.calls.push({ identityPublicId, organizationPublicId });
    if (!this.shouldAllow) {
      throw new OrganizationAccessDeniedError();
    }
    return this.context;
  }
}

class FakeResolvePortalTenantScopeService {
  public calls: string[] = [];
  /** Conjuntos autorizados recebidos, na ordem — prova de propagação (C-1). */
  public authorizedSets: Array<readonly string[]> = [];
  public result: PortalTenantScopeResult = GROUP_SCOPE;
  public failure: Error | undefined;

  public async execute(
    organizationPublicId: string,
    authorizedOrganizationPublicIds: ReadonlySet<string>
  ): Promise<PortalTenantScopeResult> {
    this.calls.push(organizationPublicId);
    this.authorizedSets.push([...authorizedOrganizationPublicIds]);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.result;
  }
}

async function startTestServer(
  overrides: {
    authorizeApplicationAccessService?: FakeAuthorizeApplicationAccessService;
    requireOrganizationAccessService?: FakeRequireOrganizationAccessService;
    resolvePortalTenantScopeService?: FakeResolvePortalTenantScopeService;
    serviceCredential?: string;
  } = {}
) {
  const app = createApp({
    validateSessionService: {
      execute: async () => ({ identityPublicId: "", sessionPublicId: "" })
    } as unknown as ValidateSessionService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    getActiveOrganizationExternalReferenceService: {} as unknown as GetActiveOrganizationExternalReferenceService,
    getActiveIdentityExternalReferenceService: {} as unknown as GetActiveIdentityExternalReferenceService,
    authorizeApplicationAccessService: (overrides.authorizeApplicationAccessService ??
      new FakeAuthorizeApplicationAccessService()) as unknown as AuthorizeApplicationAccessService,
    requireOrganizationAccessService: (overrides.requireOrganizationAccessService ??
      new FakeRequireOrganizationAccessService()) as unknown as RequireOrganizationAccessService,
    resolvePortalTenantScopeService: (overrides.resolvePortalTenantScopeService ??
      new FakeResolvePortalTenantScopeService()) as unknown as ResolvePortalTenantScopeService,
    serviceCredential: overrides.serviceCredential ?? REAL_SERVICE_CREDENTIAL
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${(address as { port: number }).port}` };
}

function tenantScopeUrl(baseUrl: string, identityPublicId: string, organizationPublicId: string): string {
  return `${baseUrl}/api/v1/service/portal/identities/${identityPublicId}/organizations/${organizationPublicId}/tenant-scope`;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("GET /api/v1/service/portal/identities/:id/organizations/:org/tenant-scope", () => {
  let server: Server;
  let baseUrl: string;
  let authorizeService: FakeAuthorizeApplicationAccessService;
  let organizationAccessService: FakeRequireOrganizationAccessService;
  let tenantScopeService: FakeResolvePortalTenantScopeService;

  beforeEach(async () => {
    authorizeService = new FakeAuthorizeApplicationAccessService();
    organizationAccessService = new FakeRequireOrganizationAccessService();
    tenantScopeService = new FakeResolvePortalTenantScopeService();
    ({ server, baseUrl } = await startTestServer({
      authorizeApplicationAccessService: authorizeService,
      requireOrganizationAccessService: organizationAccessService,
      resolvePortalTenantScopeService: tenantScopeService
    }));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  // A. sem service credential → 401
  it("A. sem header X-Portal-Service-Credential → 401 SERVICE_CREDENTIAL_INVALID", async () => {
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    expect(authorizeService.calls).toHaveLength(0);
    expect(organizationAccessService.calls).toHaveLength(0);
    expect(tenantScopeService.calls).toHaveLength(0);
  });

  // B. credential errada → 401, indistinguível de ausente
  it("B. credential inválida → 401, indistinguível de ausente", async () => {
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "credential-errada" }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    expect(tenantScopeService.calls).toHaveLength(0);
  });

  // C. ApplicationAccess negado → 403, nada mais executa
  it("C. Identity sem ApplicationAccess(PCTEC_PORTAL, USER) → 403 APPLICATION_ACCESS_DENIED", async () => {
    authorizeService.shouldGrant = false;
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("APPLICATION_ACCESS_DENIED");
    expect(organizationAccessService.calls).toHaveLength(0);
    expect(tenantScopeService.calls).toHaveLength(0);
  });

  // D. ordem obrigatória do pipeline
  it("D. pipeline na ordem: ApplicationAccess → OrganizationAccess → tenant-scope", async () => {
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    expect(res.status).toBe(200);
    expect(authorizeService.calls).toEqual([
      {
        identityPublicId: VALID_IDENTITY_PUBLIC_ID,
        applicationCode: "PCTEC_PORTAL",
        requiredProfile: "USER"
      }
    ]);
    expect(organizationAccessService.calls).toEqual([
      { identityPublicId: VALID_IDENTITY_PUBLIC_ID, organizationPublicId: AFIP_GROUP_PUBLIC_ID }
    ]);
    expect(tenantScopeService.calls).toEqual([AFIP_GROUP_PUBLIC_ID]);
  });

  // E. seleção fora do PortalContext → 403, escopo nunca resolvido
  it("E. organização fora do PortalContext → 403 ORGANIZATION_ACCESS_DENIED, escopo nunca resolvido", async () => {
    organizationAccessService.shouldAllow = false;
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("ORGANIZATION_ACCESS_DENIED");
    expect(tenantScopeService.calls).toHaveLength(0);
  });

  // F. BUSINESS_GROUP consolidado
  it("F. BUSINESS_GROUP → selection do grupo e organizations[] com as COMPANY filhas", async () => {
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);

    const selection = body["selection"] as Record<string, unknown>;
    expect(selection["type"]).toBe("BUSINESS_GROUP");
    expect(selection["tradeName"]).toBe("AFIP");

    const organizations = body["organizations"] as Array<Record<string, unknown>>;
    expect(organizations).toHaveLength(2);
    expect(organizations.map((o) => o["legacyId"])).toEqual([77, 75]);
    expect(organizations.every((o) => o["type"] === "COMPANY")).toBe(true);
  });

  // G. COMPANY individual continua com uma organização só
  it("G. COMPANY → selection e organizations[] com exatamente a própria empresa", async () => {
    tenantScopeService.result = COMPANY_SCOPE;
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, BOSQUE_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect((body["selection"] as Record<string, unknown>)["type"]).toBe("COMPANY");
    const organizations = body["organizations"] as Array<Record<string, unknown>>;
    expect(organizations).toHaveLength(1);
    expect(organizations[0]?.["legacyId"]).toBe(75);
  });

  // H. contrato de campos — nem mais, nem menos
  it("H. cada organização tem exatamente publicId, type, legalName, tradeName, legacyId", async () => {
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["organizations", "selection"]);
    expect(Object.keys(body["selection"] as object).sort()).toEqual(["legalName", "publicId", "tradeName", "type"]);
    for (const organization of body["organizations"] as Array<Record<string, unknown>>) {
      expect(Object.keys(organization).sort()).toEqual(["legacyId", "legalName", "publicId", "tradeName", "type"]);
    }
  });

  // I. nunca vaza ids internos nem identidade
  it("I. resposta nunca contém identityPublicId, internalId, membership, CNPJ nem credential", async () => {
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const raw = (await res.text()).toLowerCase();
    expect(raw).not.toContain("identitypublicid");
    expect(raw).not.toContain("internalid");
    expect(raw).not.toContain("membership");
    expect(raw).not.toContain("documentnumber");
    expect(raw).not.toContain("credential");
    // O identityPublicId do piloto nunca é ecoado no corpo.
    expect(raw).not.toContain(VALID_IDENTITY_PUBLIC_ID);
  });

  // J. fail-closed do escopo é propagado como 404
  it("J. filha ACTIVE sem referência comercial → 404 ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND", async () => {
    tenantScopeService.failure = new OrganizationExternalReferenceNotFoundError(
      BELGICA_PUBLIC_ID,
      "PCTEC_PORTAL",
      "clientes"
    );
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(extractError(body).code).toBe("ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  // K. nenhuma filha autorizada → 403, nunca 200 com lista vazia (C-1)
  it("K. grupo sem nenhuma filha autorizada → 403 ORGANIZATION_ACCESS_DENIED, nunca escopo vazio", async () => {
    tenantScopeService.failure = new OrganizationAccessDeniedError();
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("ORGANIZATION_ACCESS_DENIED");
    // Nenhuma referência comercial é revelada junto com a negativa.
    expect(body).not.toHaveProperty("organizations");
    expect(body).not.toHaveProperty("selection");
  });

  // K-b. o PortalContext autorizado atravessa o pipeline (C-1)
  it("K-b. a rota repassa ao tenant-scope exatamente os publicId do PortalContext que autorizou", async () => {
    const res = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    expect(res.status).toBe(200);
    expect(tenantScopeService.authorizedSets).toHaveLength(1);
    expect([...tenantScopeService.authorizedSets[0]!].sort()).toEqual(
      organizationAccessService.context.organizations.map((o) => o.publicId).sort()
    );
  });

  // K-c. contexto restrito (ORGANIZATION_ONLY) chega restrito ao service
  it("K-c. PortalContext só com o grupo (ORGANIZATION_ONLY) é propagado sem filhas", async () => {
    organizationAccessService.context = {
      identityPublicId: VALID_IDENTITY_PUBLIC_ID,
      organizations: [
        { publicId: AFIP_GROUP_PUBLIC_ID, type: "BUSINESS_GROUP", legalName: "AFIP", tradeName: "AFIP" }
      ]
    };
    await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    // A rota nunca "completa" o contexto com as filhas canônicas.
    expect(tenantScopeService.authorizedSets[0]).toEqual([AFIP_GROUP_PUBLIC_ID]);
  });

  // L. a rota não reimplementa hierarquia
  it("L. rota não implementa hierarquia — delega integralmente ao service de aplicação", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("../servicePortalTenantScopeRoutes.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(source).not.toContain("BUSINESS_GROUP");
    expect(source).not.toContain("findChildren");
    expect(source).not.toContain("isBusinessGroup");
    expect(source).not.toContain("OrganizationRepository");
    expect(source).not.toContain("clientes");
    // E não recalcula o contexto: usa o que o boundary devolveu.
    expect(source).not.toContain("getPortalContextService");
    expect(source).toContain("portalContext.organizations");
  });

  // M. rotas anteriores do namespace continuam intactas
  it("M. rotas P1A.1 / Fatia 4 / P1B.1 continuam respondendo 401 sem credential", async () => {
    const urls = [
      `${baseUrl}/api/v1/service/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/organizations/${BOSQUE_PUBLIC_ID}/external-references/PCTEC_PORTAL`,
      `${baseUrl}/api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/33`,
      `${baseUrl}/api/v1/service/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/context`
    ];
    for (const url of urls) {
      const res = await fetch(url);
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    }
  });

  // N. a rota nunca é alcançável pelo pipeline browser-facing
  it("N. /api/v1/portal/.../tenant-scope (browser-facing) não existe", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/organizations/${BOSQUE_PUBLIC_ID}/tenant-scope`
    );
    // Sem cookie de sessão o pipeline browser-facing barra antes; o que
    // importa é que nunca responde 200 com escopo comercial.
    expect(res.status).not.toBe(200);
  });
});

// fail-closed: credencial vazia → rota indisponível, /health intacto
describe("fail-closed: serviceCredential vazio → tenant-scope 401, /health 200", () => {
  it("com credential='', tenant-scope retorna 401 e /health continua 200", async () => {
    const { server, baseUrl } = await startTestServer({ serviceCredential: "" });
    try {
      const routeRes = await fetch(tenantScopeUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID, AFIP_GROUP_PUBLIC_ID), {
        headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "qualquer" }
      });
      expect(routeRes.status).toBe(401);
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
