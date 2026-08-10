import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import { SessionValidationFailedError } from "../../domain/errors/SessionValidationErrors.js";
import type { ValidateSessionService, AuthenticatedPrincipal } from "../../application/ValidateSessionService.js";
import { SESSION_COOKIE_NAME } from "../sessionCookie.js";

const VALID_PRINCIPAL: AuthenticatedPrincipal = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  sessionPublicId: "22222222-2222-2222-2222-222222222222"
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
  public lastRawToken: string | undefined;
  public shouldFail = false;

  public async execute(request: { rawSessionToken: string }): Promise<AuthenticatedPrincipal> {
    this.lastRawToken = request.rawSessionToken;
    if (this.shouldFail) {
      throw new SessionValidationFailedError("SESSION_NOT_FOUND");
    }
    return VALID_PRINCIPAL;
  }
}

class BrokenValidateSessionService {
  public async execute(): Promise<never> {
    throw new Error("ECONNREFUSED 127.0.0.1:3306 (mensagem de driver simulada, nunca deveria vazar)");
  }
}

async function startTestServer(validateSessionService: FakeValidateSessionService | BrokenValidateSessionService) {
  const app = createApp({
    validateSessionService: validateSessionService as unknown as ValidateSessionService
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("GET /api/v1/me", () => {
  let server: Server;
  let baseUrl: string;
  let validateSessionService: FakeValidateSessionService;

  beforeEach(async () => {
    validateSessionService = new FakeValidateSessionService();
    ({ server, baseUrl } = await startTestServer(validateSessionService));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("16. sem cookie -> 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`);
    expect(res.status).toBe(401);
  });

  it("sem cookie -> code SESSION_INVALID", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(extractError(body).code).toBe("SESSION_INVALID");
  });

  it("17. cookie inválido (ValidateSessionService rejeita) -> 401", async () => {
    validateSessionService.shouldFail = true;
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-qualquer` }
    });
    expect(res.status).toBe(401);
  });

  it("[REVISÃO CRÍTICA, item 3] cookie duplicado -> 401 SESSION_INVALID (fail closed, HTTP real)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=valor-A; ${SESSION_COOKIE_NAME}=valor-B` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SESSION_INVALID");
    expect(validateSessionService.lastRawToken).toBeUndefined(); // nunca chegou a consultar
  });

  it("18. cookie válido -> 200", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-123` }
    });
    expect(res.status).toBe(200);
  });

  it("19. body exato: { identity: { publicId }, session: { publicId } }", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-123` }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toEqual({
      identity: { publicId: VALID_PRINCIPAL.identityPublicId },
      session: { publicId: VALID_PRINCIPAL.sessionPublicId }
    });
    expect(Object.keys(body)).toEqual(["identity", "session"]);
  });

  it("body nunca contém email/fullName/ADMIN/roles/permissions/applicationAccesses", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-123` }
    });
    const bodyText = await res.text();

    expect(bodyText.toLowerCase()).not.toContain("email");
    expect(bodyText.toLowerCase()).not.toContain("fullname");
    expect(bodyText.toLowerCase()).not.toContain("admin");
    expect(bodyText.toLowerCase()).not.toContain("role");
    expect(bodyText.toLowerCase()).not.toContain("permission");
    expect(bodyText.toLowerCase()).not.toContain("access");
  });

  it("20. correlation-id preservado", async () => {
    const correlationId = "8f14e45f-ceea-467e-a1a3-000000000201";
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido-123`, "x-correlation-id": correlationId }
    });

    expect(res.headers.get("x-correlation-id")).toBe(correlationId);
  });

  it("correlation-id presente também em resposta de erro (401)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(extractError(body).correlation_id).toBeDefined();
    expect(extractError(body).correlation_id).not.toBeNull();
  });

  it("22. /health continua 200", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("23. rota desconhecida continua 404", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rota-que-nao-existe`);
    expect(res.status).toBe(404);
  });

  it("o token bruto do cookie é passado ao ValidateSessionService corretamente", async () => {
    await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=meu-token-especifico-123` }
    });

    expect(validateSessionService.lastRawToken).toBe("meu-token-especifico-123");
  });
});

describe("GET /api/v1/me — 21. 500 sanitizado", () => {
  it("erro inesperado (bug/driver) nunca vaza detalhe interno", async () => {
    const { server, baseUrl } = await startTestServer(new BrokenValidateSessionService());
    try {
      const res = await fetch(`${baseUrl}/api/v1/me`, {
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
