import { describe, it, expect } from "vitest";
import {
  createRequireApplicationAccess,
  AuthenticationContextMissingError,
  type RequestWithAuthorization
} from "../http/requireApplicationAccess.js";
import { ApplicationAccessDeniedError } from "../domain/errors/AuthorizationErrors.js";
import type { AuthorizedApplicationAccess } from "../application/AuthorizeApplicationAccessService.js";

const VALID_AUTHORIZATION: AuthorizedApplicationAccess = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
  applicationCode: "PCTEC_INGRESSA",
  accessProfile: "ADMIN"
};

class FakeAuthorizeApplicationAccessService {
  public calls: Array<{ identityPublicId: string; applicationCode: string; requiredProfile: string }> = [];
  public shouldFail = false;

  public async execute(request: {
    identityPublicId: string;
    applicationCode: string;
    requiredProfile: string;
  }): Promise<AuthorizedApplicationAccess> {
    this.calls.push(request);
    if (this.shouldFail) {
      throw new ApplicationAccessDeniedError("ACCESS_NOT_FOUND");
    }
    return VALID_AUTHORIZATION;
  }
}

function fakeRequest(auth: { identityPublicId: string; sessionPublicId: string } | undefined): RequestWithAuthorization {
  return { auth } as unknown as RequestWithAuthorization;
}

describe("requireApplicationAccess", () => {
  it("11. req.auth ausente -> falha controlada (AuthenticationContextMissingError), NUNCA chama AuthorizeApplicationAccessService", () => {
    const authorizeService = new FakeAuthorizeApplicationAccessService();
    const middleware = createRequireApplicationAccess(authorizeService as never, {
      applicationCode: "PCTEC_INGRESSA",
      profile: "ADMIN"
    });
    const req = fakeRequest(undefined);
    let receivedError: unknown;

    middleware(req, {} as never, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(AuthenticationContextMissingError);
    expect(authorizeService.calls).toHaveLength(0);
  });

  it("12. req.auth presente + acesso negado -> next(error) 403 ApplicationAccessDeniedError", async () => {
    const authorizeService = new FakeAuthorizeApplicationAccessService();
    authorizeService.shouldFail = true;
    const middleware = createRequireApplicationAccess(authorizeService as never, {
      applicationCode: "PCTEC_INGRESSA",
      profile: "ADMIN"
    });
    const req = fakeRequest({ identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec", sessionPublicId: "s1" });
    let receivedError: unknown;

    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (error?: unknown) => {
        receivedError = error;
        resolve();
      });
    });

    expect(receivedError).toBeInstanceOf(ApplicationAccessDeniedError);
    expect(req.authorization).toBeUndefined();
  });

  it("13. req.auth presente + ADMIN -> next() sem erro, req.authorization anexado", async () => {
    const authorizeService = new FakeAuthorizeApplicationAccessService();
    const middleware = createRequireApplicationAccess(authorizeService as never, {
      applicationCode: "PCTEC_INGRESSA",
      profile: "ADMIN"
    });
    const req = fakeRequest({ identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec", sessionPublicId: "s1" });
    let nextCalledWith: unknown = "not-called";

    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (error?: unknown) => {
        nextCalledWith = error;
        resolve();
      });
    });

    expect(nextCalledWith).toBeUndefined();
    expect(req.authorization).toEqual(VALID_AUTHORIZATION);
  });

  it("passa identityPublicId de req.auth (nunca de outro lugar) para AuthorizeApplicationAccessService", async () => {
    const authorizeService = new FakeAuthorizeApplicationAccessService();
    const middleware = createRequireApplicationAccess(authorizeService as never, {
      applicationCode: "PCTEC_INGRESSA",
      profile: "ADMIN"
    });
    const req = fakeRequest({ identityPublicId: "identidade-especifica-999", sessionPublicId: "s1" });

    await new Promise<void>((resolve) => {
      middleware(req, {} as never, () => resolve());
    });

    expect(authorizeService.calls).toEqual([
      { identityPublicId: "identidade-especifica-999", applicationCode: "PCTEC_INGRESSA", requiredProfile: "ADMIN" }
    ]);
  });

  it("14/15/16. o middleware nunca importa cookie parser/SessionRepository/ValidateSessionService — prova estrutural de que não toca cookie/Session/AuthenticatedPrincipal", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../http/requireApplicationAccess.ts", import.meta.url), "utf-8");

    expect(source).not.toContain("sessionCookieParser");
    expect(source).not.toContain("extractSessionTokenFromCookieHeader");
    expect(source).not.toContain("import { MariaDbSessionRepository");
    expect(source).not.toContain("import type { SessionRepository");
    expect(source).not.toContain("import { ValidateSessionService");
    expect(source).not.toContain("import type { ValidateSessionService");
    expect(source).not.toContain("new AuthenticatedPrincipal");
  });
});
