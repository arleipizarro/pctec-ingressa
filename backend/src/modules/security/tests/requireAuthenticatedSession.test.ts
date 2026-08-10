import { describe, it, expect } from "vitest";
import { createRequireAuthenticatedSession, type RequestWithAuth } from "../http/requireAuthenticatedSession.js";
import { SessionValidationFailedError } from "../domain/errors/SessionValidationErrors.js";
import { SESSION_COOKIE_NAME } from "../http/sessionCookie.js";
import type { AuthenticatedPrincipal } from "../application/ValidateSessionService.js";

const VALID_PRINCIPAL: AuthenticatedPrincipal = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  sessionPublicId: "22222222-2222-2222-2222-222222222222"
};

class FakeValidateSessionService {
  public calls: string[] = [];
  public shouldFail = false;

  public async execute(request: { rawSessionToken: string }): Promise<AuthenticatedPrincipal> {
    this.calls.push(request.rawSessionToken);
    if (this.shouldFail) {
      throw new SessionValidationFailedError("SESSION_NOT_FOUND");
    }
    return VALID_PRINCIPAL;
  }
}

function fakeRequest(cookieHeader: string | undefined): RequestWithAuth {
  return {
    header: (name: string) => (name.toLowerCase() === "cookie" ? cookieHeader : undefined)
  } as unknown as RequestWithAuth;
}

describe("requireAuthenticatedSession", () => {
  it("cookie ausente: next(error) com SessionValidationFailedError, nunca chama ValidateSessionService", () => {
    const validateSessionService = new FakeValidateSessionService();
    const middleware = createRequireAuthenticatedSession(validateSessionService as never);
    const req = fakeRequest(undefined);
    let receivedError: unknown;

    middleware(req, {} as never, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(SessionValidationFailedError);
    expect(validateSessionService.calls).toHaveLength(0);
  });

  it("cookie presente e válido: anexa req.auth com o principal, chama next() sem erro", async () => {
    const validateSessionService = new FakeValidateSessionService();
    const middleware = createRequireAuthenticatedSession(validateSessionService as never);
    const req = fakeRequest(`${SESSION_COOKIE_NAME}=token-valido-123`);
    let nextCalledWith: unknown = "not-called";

    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (error?: unknown) => {
        nextCalledWith = error;
        resolve();
      });
    });

    expect(nextCalledWith).toBeUndefined();
    expect(req.auth).toEqual(VALID_PRINCIPAL);
  });

  it("cookie presente mas ValidateSessionService rejeita: next(error), req.auth nunca é preenchido", async () => {
    const validateSessionService = new FakeValidateSessionService();
    validateSessionService.shouldFail = true;
    const middleware = createRequireAuthenticatedSession(validateSessionService as never);
    const req = fakeRequest(`${SESSION_COOKIE_NAME}=token-qualquer`);
    let receivedError: unknown;

    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (error?: unknown) => {
        receivedError = error;
        resolve();
      });
    });

    expect(receivedError).toBeInstanceOf(SessionValidationFailedError);
    expect(req.auth).toBeUndefined();
  });

  it("nunca resolve autorização — o middleware não importa/usa ApplicationAccess/roles/permissions como código real", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../http/requireAuthenticatedSession.ts", import.meta.url), "utf-8");

    expect(source).not.toContain("import { ApplicationAccess");
    expect(source).not.toContain("import type { ApplicationAccess");
    expect(source).not.toContain("new ApplicationAccess");
    expect(source).not.toContain("ApplicationAccessRepository");
    expect(source).not.toContain("req.auth.roles");
    expect(source).not.toContain("req.auth.permissions");
  });

  it("passa o token bruto correto extraído do cookie para ValidateSessionService", async () => {
    const validateSessionService = new FakeValidateSessionService();
    const middleware = createRequireAuthenticatedSession(validateSessionService as never);
    const req = fakeRequest(`outro=x; ${SESSION_COOKIE_NAME}=token-especifico-999; mais=y`);

    await new Promise<void>((resolve) => {
      middleware(req, {} as never, () => resolve());
    });

    expect(validateSessionService.calls).toEqual(["token-especifico-999"]);
  });

  it("[REVISÃO CRÍTICA, item 3/4-C] cookie duplicado no middleware -> next(error) SessionValidationFailedError, NUNCA chama ValidateSessionService", () => {
    const validateSessionService = new FakeValidateSessionService();
    const middleware = createRequireAuthenticatedSession(validateSessionService as never);
    const req = fakeRequest(`${SESSION_COOKIE_NAME}=valor-A; ${SESSION_COOKIE_NAME}=valor-B`);
    let receivedError: unknown;

    middleware(req, {} as never, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(SessionValidationFailedError);
    // Fail closed acontece já no parsing do cookie (extractSessionTokenFromCookieHeader
    // retorna undefined para duplicado) — o middleware trata isso
    // exatamente como "cookie ausente", nunca chega a consultar
    // ValidateSessionService.
    expect(validateSessionService.calls).toHaveLength(0);
  });
});
