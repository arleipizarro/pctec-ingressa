import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService, PortalContextResult } from "../../application/GetPortalContextService.js";
import type { AuthorizeApplicationAccessService, AuthorizedApplicationAccess } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import type { GetActiveIdentityExternalReferenceService } from "../../../identity/application/GetActiveIdentityExternalReferenceService.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../requireServiceCredential.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const REAL_SERVICE_CREDENTIAL = "segredo-de-teste-p1b1-context";

const FAKE_CONTEXT: PortalContextResult = {
  identityPublicId: VALID_IDENTITY_PUBLIC_ID,
  organizations: [
    {
      publicId: "cc9c41b2-425b-48f2-82d9-506d396c2562",
      type: "BUSINESS_GROUP",
      legalName: "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA",
      tradeName: "AFIP"
    },
    {
      publicId: "971ec096-e7de-4cc1-be06-2b4709565757",
      type: "COMPANY",
      legalName: "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA - BOSQUE",
      tradeName: "AFIP - BOSQUE"
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

class FakeGetPortalContextService {
  public calls: string[] = [];
  public result: PortalContextResult = FAKE_CONTEXT;

  public async execute(identityPublicId: string): Promise<PortalContextResult> {
    this.calls.push(identityPublicId);
    return this.result;
  }
}

async function startTestServer(overrides: {
  authorizeApplicationAccessService?: FakeAuthorizeApplicationAccessService;
  getPortalContextService?: FakeGetPortalContextService;
  serviceCredential?: string;
} = {}) {
  const app = createApp({
    validateSessionService: {
      execute: async () => ({ identityPublicId: "", sessionPublicId: "" })
    } as unknown as ValidateSessionService,
    requireOrganizationAccessService: {} as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService: {} as unknown as GetActiveOrganizationExternalReferenceService,
    getActiveIdentityExternalReferenceService: {} as unknown as GetActiveIdentityExternalReferenceService,
    authorizeApplicationAccessService:
      (overrides.authorizeApplicationAccessService ?? new FakeAuthorizeApplicationAccessService()) as unknown as AuthorizeApplicationAccessService,
    getPortalContextService:
      (overrides.getPortalContextService ?? new FakeGetPortalContextService()) as unknown as GetPortalContextService,
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

function contextUrl(baseUrl: string, identityPublicId: string): string {
  return `${baseUrl}/api/v1/service/portal/identities/${identityPublicId}/context`;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("GET /api/v1/service/portal/identities/:identityPublicId/context", () => {
  let server: Server;
  let baseUrl: string;
  let authorizeService: FakeAuthorizeApplicationAccessService;
  let contextService: FakeGetPortalContextService;

  beforeEach(async () => {
    authorizeService = new FakeAuthorizeApplicationAccessService();
    contextService = new FakeGetPortalContextService();
    ({ server, baseUrl } = await startTestServer({ authorizeApplicationAccessService: authorizeService, getPortalContextService: contextService }));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  // A. sem service credential → 401
  it("A. sem header X-Portal-Service-Credential → 401 SERVICE_CREDENTIAL_INVALID", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    expect(authorizeService.calls).toHaveLength(0);
    expect(contextService.calls).toHaveLength(0);
  });

  // B. credential inválida → 401
  it("B. credential inválida → 401, indistinguível de ausente", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "credential-errada" }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    expect(authorizeService.calls).toHaveLength(0);
    expect(contextService.calls).toHaveLength(0);
  });

  // C. credential válida + Identity sem ApplicationAccess → 403
  it("C. credential válida + Identity sem ApplicationAccess → 403 APPLICATION_ACCESS_DENIED", async () => {
    authorizeService.shouldGrant = false;
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("APPLICATION_ACCESS_DENIED");
    expect(contextService.calls).toHaveLength(0); // GetPortalContextService nunca chamado
  });

  // D. AuthorizeApplicationAccessService recebe exatamente identityPublicId, PCTEC_PORTAL, USER
  it("D. AuthorizeApplicationAccessService chamado com { identityPublicId, PCTEC_PORTAL, USER }", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    expect(res.status).toBe(200);
    expect(authorizeService.calls).toHaveLength(1);
    expect(authorizeService.calls[0]).toEqual({
      identityPublicId: VALID_IDENTITY_PUBLIC_ID,
      applicationCode: "PCTEC_PORTAL",
      requiredProfile: "USER"
    });
  });

  // E. GetPortalContextService não chamado se ApplicationAccess negado
  it("E. GetPortalContextService nunca chamado quando ApplicationAccess é negado", async () => {
    authorizeService.shouldGrant = false;
    await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    expect(contextService.calls).toHaveLength(0);
  });

  // F. ApplicationAccess permitido → chama GetPortalContextService
  it("F. ApplicationAccess permitido → GetPortalContextService chamado com identityPublicId correto", async () => {
    await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    expect(contextService.calls).toHaveLength(1);
    expect(contextService.calls[0]).toBe(VALID_IDENTITY_PUBLIC_ID);
  });

  // G. contexto com BUSINESS_GROUP + descendentes → resposta preservada
  it("G. BUSINESS_GROUP e COMPANY (descendente) preservados na resposta", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    const orgs = body["organizations"] as Array<Record<string, unknown>>;
    const bg = orgs.find((o) => o["type"] === "BUSINESS_GROUP");
    const company = orgs.find((o) => o["type"] === "COMPANY");
    expect(bg).toBeDefined();
    expect(company).toBeDefined();
    expect(bg?.["tradeName"]).toBe("AFIP");
    expect(company?.["tradeName"]).toBe("AFIP - BOSQUE");
  });

  // H. resposta contém somente os quatro campos públicos aprovados
  it("H. cada organização tem exatamente: publicId, type, legalName, tradeName", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    const orgs = body["organizations"] as Array<Record<string, unknown>>;
    for (const org of orgs) {
      expect(Object.keys(org).sort()).toEqual(["legalName", "publicId", "tradeName", "type"]);
    }
  });

  // I. não retorna identityPublicId
  it("I. resposta não contém identityPublicId no nível raiz nem dentro das organizations", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("identityPublicId");
    expect(body).not.toHaveProperty("identity");
    const raw = JSON.stringify(body);
    // identityPublicId do piloto não deve aparecer como campo de resposta
    expect(raw).not.toContain(`"identityPublicId"`);
  });

  // J. não retorna Membership/profile/scope
  it("J. resposta não contém membershipPublicId, profile nem scope", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const raw = await res.text();
    expect(raw).not.toContain("membershipPublicId");
    expect(raw).not.toContain("profile");
    expect(raw).not.toContain("scope");
  });

  // K. não retorna legacyId/cliente_id
  it("K. resposta não contém legacyId nem cliente_id", async () => {
    const res = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const raw = await res.text();
    expect(raw.toLowerCase()).not.toContain("legacyid");
    expect(raw.toLowerCase()).not.toContain("clienteid");
    expect(raw.toLowerCase()).not.toContain("cliente_id");
  });

  // L. prova estrutural: não reimplementa regra de descendência
  it("L. rota não implementa lógica de descendência — delega integralmente a GetPortalContextService", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../servicePortalIdentityContextRoutes.ts", import.meta.url)
    );
    const source = readFileSync(sourcePath, "utf-8");
    // Remove comentários (block e inline) — a documentação pode mencionar
    // esses conceitos para explicar que a rota NÃO os implementa, mas o
    // código executável não pode conter nenhuma implementação deles.
    const sourceWithoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(sourceWithoutComments).not.toContain("BUSINESS_GROUP");
    expect(sourceWithoutComments).not.toContain("ORGANIZATION_AND_DESCENDANTS");
    expect(sourceWithoutComments).not.toContain("findChildren");
    expect(sourceWithoutComments).not.toContain("MembershipRepository");
    expect(sourceWithoutComments).not.toContain("includesDescendants");
  });

  // N. rota Fatia 4 continua intacta
  it("N. rota Fatia 4 (portal_acesso/:legacyId) continua respondendo 401 sem credential (não afetada)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/33`
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
  });
});

// M. rota P1A.1 anterior continua intacta
describe("M. rota P1A.1 (organization external references) continua intacta", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    ({ server, baseUrl } = await startTestServer());
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("M. GET de organization external reference sem credential → 401 (rota P1A.1 intacta)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/organizations/971ec096-e7de-4cc1-be06-2b4709565757/external-references/PCTEC_PORTAL`
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
  });
});

// fail-closed: credential vazia → rota indisponível, /health OK
describe("fail-closed: serviceCredential vazio → nova rota 401, /health 200", () => {
  it("com credential='', nova rota retorna 401 e /health continua 200", async () => {
    const { server, baseUrl } = await startTestServer({ serviceCredential: "" });
    try {
      const routeRes = await fetch(contextUrl(baseUrl, VALID_IDENTITY_PUBLIC_ID), {
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
