import { describe, it, expect } from "vitest";
import {
  createRequireOrganizationAccess,
  OrganizationAccessRouteParamMissingError,
  OrganizationAccessRequiresApplicationAccessError
} from "../requireOrganizationAccess.js";
import { AuthenticationContextMissingError, type RequestWithAuthorization } from "../../../authorization/http/requireApplicationAccess.js";
import type { AuthorizedApplicationAccess } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import { OrganizationAccessDeniedError } from "../../domain/errors/PortalErrors.js";

const VALID_PORTAL_AUTHORIZATION: AuthorizedApplicationAccess = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  applicationPublicId: "3f9c1a2e-7d4b-4e5a-9c3f-000000000001",
  applicationCode: "PCTEC_PORTAL",
  accessProfile: "USER"
};

class FakeRequireOrganizationAccessService {
  public calls: Array<{ identityPublicId: string; organizationPublicId: string }> = [];
  public shouldFail = false;

  public async execute(identityPublicId: string, organizationPublicId: string): Promise<void> {
    this.calls.push({ identityPublicId, organizationPublicId });
    if (this.shouldFail) {
      throw new OrganizationAccessDeniedError();
    }
  }
}

function fakeRequest(
  auth: { identityPublicId: string; sessionPublicId: string } | undefined,
  params: Record<string, string> = {},
  authorization?: AuthorizedApplicationAccess
): RequestWithAuthorization {
  return { auth, params, authorization } as unknown as RequestWithAuthorization;
}

describe("requireOrganizationAccess", () => {
  it("req.auth ausente -> falha controlada (AuthenticationContextMissingError), NUNCA chama RequireOrganizationAccessService", () => {
    const service = new FakeRequireOrganizationAccessService();
    const middleware = createRequireOrganizationAccess(service as never, { paramName: "organizationPublicId" });
    const req = fakeRequest(undefined, { organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001" });
    let receivedError: unknown;

    middleware(req, {} as never, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(AuthenticationContextMissingError);
    expect(service.calls).toHaveLength(0);
  });

  it("PONTO 4 DA REVISÃO (crítico para segurança): req.auth presente mas req.authorization AUSENTE (requireApplicationAccess não rodou antes) -> OrganizationAccessRequiresApplicationAccessError, NUNCA chama RequireOrganizationAccessService — impede o bypass de PCTEC_PORTAL via wiring incorreto (requireAuthenticatedSession -> requireOrganizationAccess, pulando requireApplicationAccess)", () => {
    const service = new FakeRequireOrganizationAccessService();
    const middleware = createRequireOrganizationAccess(service as never, { paramName: "organizationPublicId" });
    // req.auth presente (autenticado), mas SEM req.authorization — exatamente
    // o wiring incorreto que este teste existe para impedir.
    const req = fakeRequest(
      { identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec", sessionPublicId: "s" },
      { organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001" },
      undefined
    );
    let receivedError: unknown;

    middleware(req, {} as never, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(OrganizationAccessRequiresApplicationAccessError);
    // Nunca chega a consultar Membership/Organization — mesmo que a
    // Identity TIVESSE um Membership válido, ela nunca alcança o service.
    expect(service.calls).toHaveLength(0);
  });

  it("req.auth + req.authorization presentes, mas parâmetro de rota ausente -> OrganizationAccessRouteParamMissingError, nunca chama o service", () => {
    const service = new FakeRequireOrganizationAccessService();
    const middleware = createRequireOrganizationAccess(service as never, { paramName: "organizationPublicId" });
    const req = fakeRequest(
      { identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec", sessionPublicId: "s" },
      {},
      VALID_PORTAL_AUTHORIZATION
    );
    let receivedError: unknown;

    middleware(req, {} as never, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(OrganizationAccessRouteParamMissingError);
    expect(service.calls).toHaveLength(0);
  });

  it("req.auth + req.authorization presentes + organizationPublicId fora do scope -> next(error) 403 OrganizationAccessDeniedError", async () => {
    const service = new FakeRequireOrganizationAccessService();
    service.shouldFail = true;
    const middleware = createRequireOrganizationAccess(service as never, { paramName: "organizationPublicId" });
    const req = fakeRequest(
      { identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec", sessionPublicId: "s" },
      { organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099" },
      VALID_PORTAL_AUTHORIZATION
    );
    const receivedError = await new Promise<unknown>((resolve) => {
      middleware(req, {} as never, (error?: unknown) => resolve(error));
    });

    expect(receivedError).toBeInstanceOf(OrganizationAccessDeniedError);
  });

  it("req.auth + req.authorization presentes + organizationPublicId dentro do scope -> next() sem erro", async () => {
    const service = new FakeRequireOrganizationAccessService();
    const middleware = createRequireOrganizationAccess(service as never, { paramName: "organizationPublicId" });
    const req = fakeRequest(
      { identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec", sessionPublicId: "s" },
      { organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001" },
      VALID_PORTAL_AUTHORIZATION
    );
    const receivedError = await new Promise<unknown>((resolve) => {
      middleware(req, {} as never, (error?: unknown) => resolve(error));
    });

    expect(receivedError).toBeUndefined();
    expect(service.calls).toEqual([
      { identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec", organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001" }
    ]);
  });
});
