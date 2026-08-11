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
  public async execute(): Promise<AuthenticatedPrincipal> {
    return VALID_PRINCIPAL;
  }
}

/**
 * Simula fielmente `AuthorizeApplicationAccessService` real: só concede
 * quando `applicationCode` é EXATAMENTE `PCTEC_PORTAL` — mesmo um
 * ADMIN de `PCTEC_INGRESSA` (`adminOfIngressaWithoutPortalAccess=true`)
 * é negado aqui, provando que os dois eixos são independentes (task G3,
 * seção 6).
 */
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

class FakeGetPortalContextService {
  public calls: string[] = [];
  public organizations: Array<{ publicId: string; type: string; legalName: string; tradeName?: string }> = [];

  public async execute(identityPublicId: string) {
    this.calls.push(identityPublicId);
    return { identityPublicId, organizations: this.organizations };
  }
}

async function startTestServer(
  validateSessionService: FakeValidateSessionService,
  authorizeApplicationAccessService: FakePortalAuthorizeApplicationAccessService,
  getPortalContextService: FakeGetPortalContextService
) {
  const app = createApp({
    validateSessionService: validateSessionService as unknown as ValidateSessionService,
    authorizeApplicationAccessService:
      authorizeApplicationAccessService as unknown as AuthorizeApplicationAccessService,
    getPortalContextService: getPortalContextService as unknown as GetPortalContextService
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("GET /api/v1/portal/context", () => {
  let server: Server;
  let baseUrl: string;
  let validateSessionService: FakeValidateSessionService;
  let authorizeApplicationAccessService: FakePortalAuthorizeApplicationAccessService;
  let getPortalContextService: FakeGetPortalContextService;

  beforeEach(async () => {
    validateSessionService = new FakeValidateSessionService();
    authorizeApplicationAccessService = new FakePortalAuthorizeApplicationAccessService();
    getPortalContextService = new FakeGetPortalContextService();
    ({ server, baseUrl } = await startTestServer(
      validateSessionService,
      authorizeApplicationAccessService,
      getPortalContextService
    ));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("sem sessão -> 401 SESSION_INVALID (nunca chega a AuthorizeApplicationAccessService)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/portal/context`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SESSION_INVALID");
    expect(authorizeApplicationAccessService.calls).toHaveLength(0);
    expect(getPortalContextService.calls).toHaveLength(0);
  });

  it("PCTEC_INGRESSA ADMIN sem PCTEC_PORTAL access -> 403 APPLICATION_ACCESS_DENIED (mesmo sendo ADMIN de outra aplicação)", async () => {
    authorizeApplicationAccessService.portalAccessGranted = false;
    const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-admin-ingressa-sem-portal` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("APPLICATION_ACCESS_DENIED");
    expect(getPortalContextService.calls).toHaveLength(0);
  });

  it("requireApplicationAccess é chamado com applicationCode=PCTEC_PORTAL e profile=USER (nunca ADMIN, nunca PCTEC_INGRESSA)", async () => {
    await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });

    expect(authorizeApplicationAccessService.calls).toEqual([
      { applicationCode: "PCTEC_PORTAL", requiredProfile: "USER" }
    ]);
  });

  it("PCTEC_PORTAL access GRANTED -> chega ao PortalContext, 200", async () => {
    getPortalContextService.organizations = [
      { publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001", type: "COMPANY", legalName: "Empresa X" }
    ];
    const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      identity: { publicId: VALID_PRINCIPAL.identityPublicId },
      organizations: [
        { publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001", type: "COMPANY", legalName: "Empresa X", tradeName: null }
      ]
    });
  });

  it("ADR-032, revisão pré-commit de G3: ApplicationAccess(PCTEC_PORTAL, ADMIN) SEM USER -> 403, ADMIN não implica USER automaticamente", async () => {
    // Simula fielmente AuthorizeApplicationAccessService real: a
    // identidade tem ApplicationAccess(PCTEC_PORTAL, ADMIN, GRANTED),
    // mas a rota exige exatamente USER — sem hierarquia implícita.
    authorizeApplicationAccessService.execute = async (request) => {
      authorizeApplicationAccessService.calls.push({
        applicationCode: request.applicationCode,
        requiredProfile: request.requiredProfile
      });
      throw new ApplicationAccessDeniedError("PROFILE_INSUFFICIENT");
    };
    const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-portal-admin-sem-user` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("APPLICATION_ACCESS_DENIED");
    expect(getPortalContextService.calls).toHaveLength(0);
  });

  it("PCTEC_PORTAL access REVOKED -> 403", async () => {
    authorizeApplicationAccessService.portalAccessGranted = false;
    const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-portal-revogado` }
    });

    expect(res.status).toBe(403);
  });

  it("payload nunca contém legacyId/internalId/documentNumber/Credential/Session token/ApplicationAccess cru", async () => {
    getPortalContextService.organizations = [
      { publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001", type: "COMPANY", legalName: "Empresa X" }
    ];
    const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });
    const body = (await res.json()) as Record<string, unknown>;
    const raw = JSON.stringify(body).toLowerCase();

    expect(raw).not.toContain("legacyid");
    expect(raw).not.toContain("internalid");
    expect(raw).not.toContain("documentnumber");
    expect(raw).not.toContain("credential");
    expect(raw).not.toContain("token");
  });

  it("organizations: [] quando o PortalContext está vazio (não é erro)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ identity: { publicId: VALID_PRINCIPAL.identityPublicId }, organizations: [] });
  });
});
