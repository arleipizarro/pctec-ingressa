import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import type { AuthorizeApplicationAccessService, AuthorizedApplicationAccess } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../application/GetPortalContextService.js";
import { OrganizationAccessDeniedError } from "../../domain/errors/PortalErrors.js";
import { OrganizationExternalReferenceNotFoundError } from "../../../organization/domain/errors/OrganizationExternalReferenceErrors.js";
import type { RequireOrganizationAccessService } from "../../application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { OrganizationExternalReference } from "../../../organization/domain/OrganizationExternalReference.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../requireServiceCredential.js";

const VALID_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const BOSQUE_ORGANIZATION_PUBLIC_ID = "971ec096-e7de-4cc1-be06-2b4709565757";
const OUTSIDER_ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000009999";
const REAL_SERVICE_CREDENTIAL = "segredo-de-teste-p1a1";

interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly correlation_id: string | null;
  readonly details: readonly unknown[];
}

function extractError(body: Record<string, unknown>): ErrorEnvelope {
  return body["error"] as ErrorEnvelope;
}

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

  public async execute(identityPublicId: string, organizationPublicId: string): Promise<void> {
    this.calls.push({ identityPublicId, organizationPublicId });
    if (organizationPublicId !== BOSQUE_ORGANIZATION_PUBLIC_ID) {
      throw new OrganizationAccessDeniedError();
    }
  }
}

class FakeGetActiveOrganizationExternalReferenceService {
  public calls: Array<{ organizationPublicId: string; systemCode: string; entityType: string }> = [];
  public shouldFindReference = true;

  public async execute(
    organizationPublicId: string,
    systemCode: string,
    entityType: string
  ): Promise<OrganizationExternalReference> {
    this.calls.push({ organizationPublicId, systemCode, entityType });
    if (!this.shouldFindReference) {
      throw new OrganizationExternalReferenceNotFoundError(organizationPublicId, systemCode, entityType);
    }
    return OrganizationExternalReference.create({
      organizationPublicId,
      systemCode,
      entityType,
      legacyId: 75,
      actorPublicId: VALID_IDENTITY_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
  }
}

async function startTestServer(
  authorizeApplicationAccessService: FakeAuthorizeApplicationAccessService,
  requireOrganizationAccessService: FakeRequireOrganizationAccessService,
  getActiveOrganizationExternalReferenceService: FakeGetActiveOrganizationExternalReferenceService,
  serviceCredential: string = REAL_SERVICE_CREDENTIAL
) {
  const app = createApp({
    // validateSessionService/getPortalContextService não são
    // exercitados por esta rota — mas createApp() exige algo quando
    // injetado parcialmente; fakes vazios bastam (nunca chamados).
    validateSessionService: { execute: async () => ({ identityPublicId: "", sessionPublicId: "" }) } as unknown as ValidateSessionService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    authorizeApplicationAccessService: authorizeApplicationAccessService as unknown as AuthorizeApplicationAccessService,
    requireOrganizationAccessService: requireOrganizationAccessService as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService:
      getActiveOrganizationExternalReferenceService as unknown as GetActiveOrganizationExternalReferenceService,
    serviceCredential
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/external-references/PCTEC_PORTAL", () => {
  let server: Server;
  let baseUrl: string;
  let authorizeApplicationAccessService: FakeAuthorizeApplicationAccessService;
  let requireOrganizationAccessService: FakeRequireOrganizationAccessService;
  let getActiveOrganizationExternalReferenceService: FakeGetActiveOrganizationExternalReferenceService;

  beforeEach(async () => {
    authorizeApplicationAccessService = new FakeAuthorizeApplicationAccessService();
    requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    ({ server, baseUrl } = await startTestServer(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService
    ));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function url(identityPublicId: string, organizationPublicId: string): string {
    return `${baseUrl}/api/v1/service/portal/identities/${identityPublicId}/organizations/${organizationPublicId}/external-references/PCTEC_PORTAL`;
  }

  it("credencial ausente -> 401 SERVICE_CREDENTIAL_INVALID, nunca chega a nenhum service", async () => {
    const res = await fetch(url(VALID_IDENTITY_PUBLIC_ID, BOSQUE_ORGANIZATION_PUBLIC_ID));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    expect(authorizeApplicationAccessService.calls).toHaveLength(0);
  });

  it("credencial inválida -> 401 SERVICE_CREDENTIAL_INVALID — mesmo código de credencial ausente, indistinguível externamente", async () => {
    const res = await fetch(url(VALID_IDENTITY_PUBLIC_ID, BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "credencial-errada" }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
  });

  it("configuração indisponível (serviceCredential vazio no servidor) -> 401 SERVICE_CREDENTIAL_INVALID, mesmo código — mesmo com um header presente", async () => {
    const { server: otherServer, baseUrl: otherBaseUrl } = await startTestServer(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService,
      ""
    );
    try {
      const res = await fetch(
        `${otherBaseUrl}/api/v1/service/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/organizations/${BOSQUE_ORGANIZATION_PUBLIC_ID}/external-references/PCTEC_PORTAL`,
        { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "qualquer-coisa" } }
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    } finally {
      await new Promise<void>((resolve, reject) => otherServer.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("credencial válida, Identity sem PCTEC_PORTAL/USER -> 403 APPLICATION_ACCESS_DENIED", async () => {
    authorizeApplicationAccessService.shouldGrant = false;

    const res = await fetch(url(VALID_IDENTITY_PUBLIC_ID, BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("APPLICATION_ACCESS_DENIED");
    expect(requireOrganizationAccessService.calls).toHaveLength(0);
  });

  it("credencial válida + PCTEC_PORTAL/USER, mas Organization fora do PortalContext -> 403 ORGANIZATION_ACCESS_DENIED", async () => {
    const res = await fetch(url(VALID_IDENTITY_PUBLIC_ID, OUTSIDER_ORGANIZATION_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("ORGANIZATION_ACCESS_DENIED");
    expect(getActiveOrganizationExternalReferenceService.calls).toHaveLength(0);
  });

  it("Organization inexistente/não referenciada -> 404 ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND", async () => {
    getActiveOrganizationExternalReferenceService.shouldFindReference = false;

    const res = await fetch(url(VALID_IDENTITY_PUBLIC_ID, BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(extractError(body).code).toBe("ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  it("tudo válido -> 200, payload MÍNIMO só com legacyId (nunca identityPublicId/organizationPublicId/Membership/CNPJ)", async () => {
    const res = await fetch(url(VALID_IDENTITY_PUBLIC_ID, BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ legacyId: 75 });
  });

  it("payload nunca contém identityPublicId/organizationPublicId/documentNumber/CNPJ/Membership/token — verificação textual do corpo bruto", async () => {
    const res = await fetch(url(VALID_IDENTITY_PUBLIC_ID, BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const rawBody = await res.text();
    const lower = rawBody.toLowerCase();

    for (const forbidden of ["identitypublicid", "organizationpublicid", "documentnumber", "cnpj", "membership", "token"]) {
      expect(lower).not.toContain(forbidden);
    }
  });

  it("os 3 services são chamados NA ORDEM CORRETA, com identityPublicId/organizationPublicId reais do path, e AuthorizeApplicationAccessService usa PCTEC_PORTAL/USER", async () => {
    await fetch(url(VALID_IDENTITY_PUBLIC_ID, BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });

    expect(authorizeApplicationAccessService.calls).toEqual([
      { identityPublicId: VALID_IDENTITY_PUBLIC_ID, applicationCode: "PCTEC_PORTAL", requiredProfile: "USER" }
    ]);
    expect(requireOrganizationAccessService.calls).toEqual([
      { identityPublicId: VALID_IDENTITY_PUBLIC_ID, organizationPublicId: BOSQUE_ORGANIZATION_PUBLIC_ID }
    ]);
    expect(getActiveOrganizationExternalReferenceService.calls).toEqual([
      { organizationPublicId: BOSQUE_ORGANIZATION_PUBLIC_ID, systemCode: "PCTEC_PORTAL", entityType: "clientes" }
    ]);
  });

  it("nunca alcançável sob o prefixo browser-facing /api/v1/portal/... — namespaces completamente separados", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/organizations/${BOSQUE_ORGANIZATION_PUBLIC_ID}/external-references/PCTEC_PORTAL`
    );
    // Sem sessão, sem credencial de serviço aplicável a este prefixo —
    // cai no requireAuthenticatedSession do /api/v1/portal (401), nunca
    // na lógica de credencial de serviço.
    expect(res.status).not.toBe(200);
  });
});

describe("Revisão pré-commit: fail-closed DA ROTA, nunca fail-stop DA APLICAÇÃO inteira", () => {
  it("2/3) app sobe normalmente e GET /health responde mesmo com serviceCredential='' (variável ausente/vazia)", async () => {
    const authorizeApplicationAccessService = new FakeAuthorizeApplicationAccessService();
    const requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    const getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    const { server, baseUrl } = await startTestServer(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService,
      ""
    );

    try {
      const res = await fetch(`${baseUrl}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body["status"]).toBe("ok");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("4) rota service-to-service rejeita (401 SERVICE_CREDENTIAL_INVALID) quando a variável está AUSENTE (sem header algum, credencial='')", async () => {
    const authorizeApplicationAccessService = new FakeAuthorizeApplicationAccessService();
    const requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    const getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    const { server, baseUrl } = await startTestServer(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService,
      ""
    );

    try {
      const res = await fetch(
        `${baseUrl}/api/v1/service/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/organizations/${BOSQUE_ORGANIZATION_PUBLIC_ID}/external-references/PCTEC_PORTAL`
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("5) rota rejeita (401 SERVICE_CREDENTIAL_INVALID) quando a variável está configurada como só espaços em branco", async () => {
    const authorizeApplicationAccessService = new FakeAuthorizeApplicationAccessService();
    const requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    const getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    const { server, baseUrl } = await startTestServer(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService,
      "   "
    );

    try {
      const res = await fetch(
        `${baseUrl}/api/v1/service/portal/identities/${VALID_IDENTITY_PUBLIC_ID}/organizations/${BOSQUE_ORGANIZATION_PUBLIC_ID}/external-references/PCTEC_PORTAL`,
        { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "   " } }
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("6) nenhuma outra rota é afetada — GET /api/v1/me continua acessível (com sua própria auth, aqui sem sessão -> 401 SESSION_INVALID, NUNCA 401 SERVICE_CREDENTIAL_INVALID) mesmo com serviceCredential=''", async () => {
    const authorizeApplicationAccessService = new FakeAuthorizeApplicationAccessService();
    const requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    const getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    const { server, baseUrl } = await startTestServer(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService,
      ""
    );

    try {
      const res = await fetch(`${baseUrl}/api/v1/me`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("SESSION_INVALID");
      expect(extractError(body).code).not.toBe("SERVICE_CREDENTIAL_INVALID");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
