import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import { SessionValidationFailedError } from "../../../security/domain/errors/SessionValidationErrors.js";
import { ApplicationAccessDeniedError } from "../../domain/errors/AuthorizationErrors.js";
import type { AuthenticatedPrincipal, ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type {
  AuthorizeApplicationAccessService,
  AuthorizedApplicationAccess
} from "../../application/AuthorizeApplicationAccessService.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";

const VALID_PRINCIPAL: AuthenticatedPrincipal = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  sessionPublicId: "22222222-2222-2222-2222-222222222222"
};

const VALID_AUTHORIZATION: AuthorizedApplicationAccess = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
  applicationCode: "PCTEC_INGRESSA",
  accessProfile: "ADMIN"
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
  public shouldFail = false;
  public calls: string[] = [];

  public async execute(request: { rawSessionToken: string }): Promise<AuthenticatedPrincipal> {
    this.calls.push(request.rawSessionToken);
    if (this.shouldFail) {
      throw new SessionValidationFailedError("SESSION_NOT_FOUND");
    }
    return VALID_PRINCIPAL;
  }
}

class FakeAuthorizeApplicationAccessService {
  public shouldFail = false;
  public calls: Array<{ identityPublicId: string; applicationCode: string; requiredProfile: string }> = [];

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

class BrokenAuthorizeApplicationAccessService {
  public async execute(): Promise<never> {
    throw new Error("ECONNREFUSED 127.0.0.1:3306 (mensagem de driver simulada, nunca deveria vazar)");
  }
}

async function startTestServer(
  validateSessionService: FakeValidateSessionService,
  authorizeApplicationAccessService: FakeAuthorizeApplicationAccessService | BrokenAuthorizeApplicationAccessService
) {
  const app = createApp({
    validateSessionService: validateSessionService as unknown as ValidateSessionService,
    authorizeApplicationAccessService: authorizeApplicationAccessService as unknown as AuthorizeApplicationAccessService
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("GET /api/v1/admin/whoami", () => {
  let server: Server;
  let baseUrl: string;
  let validateSessionService: FakeValidateSessionService;
  let authorizeApplicationAccessService: FakeAuthorizeApplicationAccessService;

  beforeEach(async () => {
    validateSessionService = new FakeValidateSessionService();
    authorizeApplicationAccessService = new FakeAuthorizeApplicationAccessService();
    ({ server, baseUrl } = await startTestServer(validateSessionService, authorizeApplicationAccessService));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("17. sem cookie -> 401 SESSION_INVALID (nunca chega a AuthorizeApplicationAccessService)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SESSION_INVALID");
    expect(authorizeApplicationAccessService.calls).toHaveLength(0);
  });

  it("18. cookie válido sem access -> 403 APPLICATION_ACCESS_DENIED", async () => {
    authorizeApplicationAccessService.shouldFail = true;
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-sem-access` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(extractError(body).code).toBe("APPLICATION_ACCESS_DENIED");
  });

  it("19. cookie válido + access REVOKED -> 403", async () => {
    authorizeApplicationAccessService.shouldFail = true; // simula ACCESS_NOT_GRANTED internamente
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-access-revoked` }
    });

    expect(res.status).toBe(403);
  });

  it("20. cookie válido + ADMIN GRANTED -> 200", async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-admin` }
    });
    expect(res.status).toBe(200);
  });

  it("21. body mínimo correto: { identity: { publicId }, application: { code }, access: { profile } }", async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-admin` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toEqual({
      identity: { publicId: VALID_AUTHORIZATION.identityPublicId },
      application: { code: VALID_AUTHORIZATION.applicationCode },
      access: { profile: VALID_AUTHORIZATION.accessProfile }
    });
    expect(Object.keys(body)).toEqual(["identity", "application", "access"]);
  });

  it("body nunca contém senha/Credential/token/dados pessoais desnecessários", async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-admin` }
    });
    const bodyText = await res.text();

    expect(bodyText.toLowerCase()).not.toContain("password");
    expect(bodyText.toLowerCase()).not.toContain("credential");
    expect(bodyText.toLowerCase()).not.toContain("token");
    expect(bodyText.toLowerCase()).not.toContain("email");
    expect(bodyText.toLowerCase()).not.toContain("fullname");
  });

  it("23. correlation-id preservado", async () => {
    const correlationId = "8f14e45f-ceea-467e-a1a3-000000000300";
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=token-valido-admin`,
        "x-correlation-id": correlationId
      }
    });
    expect(res.headers.get("x-correlation-id")).toBe(correlationId);
  });

  it("correlation-id preservado também em resposta 403", async () => {
    authorizeApplicationAccessService.shouldFail = true;
    const correlationId = "8f14e45f-ceea-467e-a1a3-000000000301";
    const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=token-valido-sem-access`,
        "x-correlation-id": correlationId
      }
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(extractError(body).correlation_id).toBe(correlationId);
  });

  it("25. /health continua 200", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("rota desconhecida (fora do namespace /admin) continua 404", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rota-que-nao-existe`);
    expect(res.status).toBe(404);
  });

  it("[SEGURANÇA] subpath desconhecido DENTRO de /api/v1/admin, sem cookie, retorna 401 (nunca 404) — mesmo padrão já estabelecido para /api/v1/me na Fase E: nunca revelar quais rotas existem sob um namespace protegido para quem não está autenticado", async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/rota-inexistente-qualquer`);
    expect(res.status).toBe(401);
  });

  it("[ORDEM DOS MIDDLEWARES] requireAuthenticatedSession roda ANTES de requireApplicationAccess — sem cookie, AuthorizeApplicationAccessService nunca é chamado", async () => {
    await fetch(`${baseUrl}/api/v1/admin/whoami`);
    expect(authorizeApplicationAccessService.calls).toHaveLength(0);
  });

  it("passa identityPublicId correto (do req.auth já autenticado) para AuthorizeApplicationAccessService", async () => {
    await fetch(`${baseUrl}/api/v1/admin/whoami`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-admin` }
    });

    expect(authorizeApplicationAccessService.calls).toEqual([
      { identityPublicId: VALID_PRINCIPAL.identityPublicId, applicationCode: "PCTEC_INGRESSA", requiredProfile: "ADMIN" }
    ]);
  });
});

describe("GET /api/v1/admin/whoami — 24. 500 sanitizado", () => {
  it("erro inesperado (bug/driver) nunca vaza detalhe interno", async () => {
    const validateSessionService = new FakeValidateSessionService();
    const { server, baseUrl } = await startTestServer(
      validateSessionService,
      new BrokenAuthorizeApplicationAccessService()
    );
    try {
      const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-qualquer` }
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(500);
      expect(extractError(body).code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(body)).not.toContain("3306");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("22. GET /api/v1/me continua só autenticação — nunca exige ADMIN", () => {
  it("cookie válido (sem qualquer ApplicationAccess) -> /me ainda retorna 200", async () => {
    const validateSessionService = new FakeValidateSessionService();
    const authorizeApplicationAccessService = new FakeAuthorizeApplicationAccessService();
    authorizeApplicationAccessService.shouldFail = true; // simula identidade SEM nenhum acesso administrativo
    const { server, baseUrl } = await startTestServer(validateSessionService, authorizeApplicationAccessService);
    try {
      const res = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-sem-admin` }
      });

      expect(res.status).toBe(200);
      // Confirma que AuthorizeApplicationAccessService nunca foi
      // consultado para /me — /me nunca avalia ApplicationAccess.
      expect(authorizeApplicationAccessService.calls).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
