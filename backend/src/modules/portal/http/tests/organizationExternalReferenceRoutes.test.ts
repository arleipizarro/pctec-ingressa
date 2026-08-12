import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import type { AuthenticatedPrincipal, ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type {
  AuthorizeApplicationAccessService,
  AuthorizedApplicationAccess
} from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { GetPortalContextService } from "../../application/GetPortalContextService.js";
import { RequireOrganizationAccessService } from "../../application/RequireOrganizationAccessService.js";
import { OrganizationExternalReferenceNotFoundError } from "../../../organization/domain/errors/OrganizationExternalReferenceErrors.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { OrganizationExternalReference } from "../../../organization/domain/OrganizationExternalReference.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";

const VALID_PRINCIPAL: AuthenticatedPrincipal = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  sessionPublicId: "22222222-2222-2222-2222-222222222222"
};

const VALID_PORTAL_AUTHORIZATION: AuthorizedApplicationAccess = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  applicationPublicId: "3f9c1a2e-7d4b-4e5a-9c3f-000000000001",
  applicationCode: "PCTEC_PORTAL",
  accessProfile: "USER"
};

const BOSQUE_ORGANIZATION_PUBLIC_ID = "971ec096-e7de-4cc1-be06-2b4709565757";
const OUTSIDER_ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000009999";

interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly correlation_id: string | null;
  readonly details: readonly unknown[];
}

function extractError(body: Record<string, unknown>): ErrorEnvelope {
  return body["error"] as ErrorEnvelope;
}

class FakeValidateSessionService {
  public shouldFail = false;
  public async execute(): Promise<AuthenticatedPrincipal> {
    if (this.shouldFail) {
      const { SessionValidationFailedError } = await import("../../../security/domain/errors/SessionValidationErrors.js");
      throw new SessionValidationFailedError("COOKIE_ABSENT");
    }
    return VALID_PRINCIPAL;
  }
}

/** Mesmo fake fiel já usado em portalContextRoutes.test.ts — só concede quando applicationCode é EXATAMENTE PCTEC_PORTAL. */
class FakePortalAuthorizeApplicationAccessService {
  public portalAccessGranted = true;
  public calls: Array<{ applicationCode: string; requiredProfile: string }> = [];

  public async execute(request: {
    identityPublicId: string;
    applicationCode: string;
    requiredProfile: string;
  }): Promise<AuthorizedApplicationAccess> {
    this.calls.push({ applicationCode: request.applicationCode, requiredProfile: request.requiredProfile });
    if (request.applicationCode !== "PCTEC_PORTAL" || !this.portalAccessGranted) {
      throw new ApplicationAccessDeniedError("ACCESS_NOT_FOUND");
    }
    return VALID_PORTAL_AUTHORIZATION;
  }
}

/** Simula fielmente RequireOrganizationAccessService real: só permite a Organization BOSQUE, nunca outra. */
class FakeRequireOrganizationAccessService {
  public calls: Array<{ identityPublicId: string; organizationPublicId: string }> = [];

  public async execute(identityPublicId: string, organizationPublicId: string): Promise<void> {
    this.calls.push({ identityPublicId, organizationPublicId });
    if (organizationPublicId !== BOSQUE_ORGANIZATION_PUBLIC_ID) {
      const { OrganizationAccessDeniedError } = await import("../../domain/errors/PortalErrors.js");
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
      actorPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
  }
}

async function startTestServer(
  validateSessionService: FakeValidateSessionService,
  authorizeApplicationAccessService: FakePortalAuthorizeApplicationAccessService,
  requireOrganizationAccessService: FakeRequireOrganizationAccessService,
  getActiveOrganizationExternalReferenceService: FakeGetActiveOrganizationExternalReferenceService
) {
  const app = createApp({
    validateSessionService: validateSessionService as unknown as ValidateSessionService,
    authorizeApplicationAccessService:
      authorizeApplicationAccessService as unknown as AuthorizeApplicationAccessService,
    getPortalContextService: {} as unknown as GetPortalContextService, // não exercitado nesta rota
    requireOrganizationAccessService:
      requireOrganizationAccessService as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService:
      getActiveOrganizationExternalReferenceService as unknown as GetActiveOrganizationExternalReferenceService
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("GET /api/v1/portal/organizations/:organizationPublicId/external-references/PCTEC_PORTAL", () => {
  let server: Server;
  let baseUrl: string;
  let validateSessionService: FakeValidateSessionService;
  let authorizeApplicationAccessService: FakePortalAuthorizeApplicationAccessService;
  let requireOrganizationAccessService: FakeRequireOrganizationAccessService;
  let getActiveOrganizationExternalReferenceService: FakeGetActiveOrganizationExternalReferenceService;

  beforeEach(async () => {
    validateSessionService = new FakeValidateSessionService();
    authorizeApplicationAccessService = new FakePortalAuthorizeApplicationAccessService();
    requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    ({ server, baseUrl } = await startTestServer(
      validateSessionService,
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

  function url(organizationPublicId: string): string {
    return `${baseUrl}/api/v1/portal/organizations/${organizationPublicId}/external-references/PCTEC_PORTAL`;
  }

  it("A) sessão ausente -> 401 SESSION_INVALID, nunca chega a nenhum service seguinte", async () => {
    validateSessionService.shouldFail = true;

    const res = await fetch(url(BOSQUE_ORGANIZATION_PUBLIC_ID));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SESSION_INVALID");
    expect(authorizeApplicationAccessService.calls).toHaveLength(0);
    expect(requireOrganizationAccessService.calls).toHaveLength(0);
    expect(getActiveOrganizationExternalReferenceService.calls).toHaveLength(0);
  });

  it("B) PCTEC_INGRESSA ADMIN mas sem PCTEC_PORTAL/USER -> 403 APPLICATION_ACCESS_DENIED, nunca chega a requireOrganizationAccess", async () => {
    authorizeApplicationAccessService.portalAccessGranted = false;

    const res = await fetch(url(BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-admin-sem-portal` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("APPLICATION_ACCESS_DENIED");
    expect(requireOrganizationAccessService.calls).toHaveLength(0);
    expect(getActiveOrganizationExternalReferenceService.calls).toHaveLength(0);
  });

  it("C) PCTEC_PORTAL/USER válido, mas Organization fora do PortalContext -> 403 ORGANIZATION_ACCESS_DENIED", async () => {
    const res = await fetch(url(OUTSIDER_ORGANIZATION_PUBLIC_ID), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("ORGANIZATION_ACCESS_DENIED");
    expect(getActiveOrganizationExternalReferenceService.calls).toHaveLength(0);
  });

  it("D/E) Organization autorizada + referência ACTIVE existente -> 200, payload com legacyId correto", async () => {
    const res = await fetch(url(BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      organization: { publicId: BOSQUE_ORGANIZATION_PUBLIC_ID },
      externalReference: { systemCode: "PCTEC_PORTAL", entityType: "clientes", legacyId: 75 }
    });
  });

  it("F) payload NUNCA contém internalId/documentNumber/Membership/Credential/token/audit/clientes_grupo", async () => {
    const res = await fetch(url(BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });
    const body = (await res.json()) as Record<string, unknown>;
    const raw = JSON.stringify(body).toLowerCase();

    for (const forbidden of [
      "internalid",
      "documentnumber",
      "membership",
      "credential",
      "token",
      "audit",
      "clientes_grupo",
      "clientesgrupo"
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("G) Organization autorizada, mas sem referência ACTIVE PCTEC_PORTAL/clientes -> 404, nunca 403", async () => {
    getActiveOrganizationExternalReferenceService.shouldFindReference = false;

    const res = await fetch(url(BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(extractError(body).code).toBe("ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  it("J) requireOrganizationAccess está REALMENTE no pipeline — é chamado com identityPublicId e organizationPublicId reais antes do service de referência", async () => {
    await fetch(url(BOSQUE_ORGANIZATION_PUBLIC_ID), {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });

    expect(requireOrganizationAccessService.calls).toEqual([
      { identityPublicId: VALID_PRINCIPAL.identityPublicId, organizationPublicId: BOSQUE_ORGANIZATION_PUBLIC_ID }
    ]);
    expect(getActiveOrganizationExternalReferenceService.calls).toEqual([
      { organizationPublicId: BOSQUE_ORGANIZATION_PUBLIC_ID, systemCode: "PCTEC_PORTAL", entityType: "clientes" }
    ]);
  });

  it("systemCode diferente de PCTEC_PORTAL no path -> 404 de rota (Express nem tenta autenticar) — segmento literal, nunca um parâmetro", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/portal/organizations/${BOSQUE_ORGANIZATION_PUBLIC_ID}/external-references/OUTRO_SISTEMA`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` } }
    );

    expect(res.status).toBe(404);
  });
});

describe("K/L/M — demais rotas do Portal/admin continuam intactas após montar a rota nova", () => {
  it("K) GET /api/v1/me continua funcionando, sem depender de requireOrganizationAccess/ExternalReference", async () => {
    const validateSessionService = new FakeValidateSessionService();
    const authorizeApplicationAccessService = new FakePortalAuthorizeApplicationAccessService();
    const requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    const getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    const { server, baseUrl } = await startTestServer(
      validateSessionService,
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService
    );

    try {
      const res = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });
      expect(res.status).toBe(200);
      expect(requireOrganizationAccessService.calls).toHaveLength(0);
      expect(getActiveOrganizationExternalReferenceService.calls).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("L) GET /api/v1/portal/context continua funcionando (rota irmã, mesmo prefixo)", async () => {
    const validateSessionService = new FakeValidateSessionService();
    const authorizeApplicationAccessService = new FakePortalAuthorizeApplicationAccessService();
    const requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    const getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();
    const fakePortalContext = {
      execute: async () => ({ identityPublicId: VALID_PRINCIPAL.identityPublicId, organizations: [] })
    } as unknown as GetPortalContextService;

    const app = createApp({
      validateSessionService: validateSessionService as unknown as ValidateSessionService,
      authorizeApplicationAccessService:
        authorizeApplicationAccessService as unknown as AuthorizeApplicationAccessService,
      getPortalContextService: fakePortalContext,
      requireOrganizationAccessService:
        requireOrganizationAccessService as unknown as RequireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService:
        getActiveOrganizationExternalReferenceService as unknown as GetActiveOrganizationExternalReferenceService
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body).toEqual({ identity: { publicId: VALID_PRINCIPAL.identityPublicId }, organizations: [] });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("M) GET /api/v1/admin/whoami continua exigindo PCTEC_INGRESSA/ADMIN, independente da rota nova", async () => {
    const validateSessionService = new FakeValidateSessionService();
    class FakeAdminOnlyAuthorize {
      public async execute(request: {
        applicationCode: string;
        requiredProfile: string;
      }): Promise<AuthorizedApplicationAccess> {
        if (request.applicationCode !== "PCTEC_INGRESSA" || request.requiredProfile !== "ADMIN") {
          throw new ApplicationAccessDeniedError("ACCESS_NOT_FOUND");
        }
        return {
          identityPublicId: VALID_PRINCIPAL.identityPublicId,
          applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
          applicationCode: "PCTEC_INGRESSA",
          accessProfile: "ADMIN"
        };
      }
    }
    const requireOrganizationAccessService = new FakeRequireOrganizationAccessService();
    const getActiveOrganizationExternalReferenceService = new FakeGetActiveOrganizationExternalReferenceService();

    const app = createApp({
      validateSessionService: validateSessionService as unknown as ValidateSessionService,
      authorizeApplicationAccessService: new FakeAdminOnlyAuthorize() as unknown as AuthorizeApplicationAccessService,
      getPortalContextService: {} as unknown as GetPortalContextService,
      requireOrganizationAccessService:
        requireOrganizationAccessService as unknown as RequireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService:
        getActiveOrganizationExternalReferenceService as unknown as GetActiveOrganizationExternalReferenceService
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-admin-real` }
      });
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
