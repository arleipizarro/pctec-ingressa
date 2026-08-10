import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import { AuthenticationFailedError } from "../../domain/errors/AuthenticationErrors.js";
import { LoginService } from "../../application/LoginService.js";
import { SESSION_COOKIE_NAME } from "../sessionCookie.js";
import { MariaDbIdentityRepository } from "../../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbCredentialRepository } from "../../infrastructure/persistence/MariaDbCredentialRepository.js";
import { MariaDbSessionRepository } from "../../infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbAuditEventRepository } from "../../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { FakeLoginConnection, FakeLoginConnectionPool } from "../../tests/FakeLoginConnection.js";

const VALID_RESULT = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  sessionPublicId: "22222222-2222-2222-2222-222222222222",
  rawToken: "token-bruto-nunca-deveria-aparecer-no-json",
  expiresAt: new Date("2026-01-01T08:00:00.000Z")
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

class FakeLoginService {
  public lastRequest: { email: string; password: string; correlationId?: string } | undefined;
  public shouldFail = false;

  public async execute(request: {
    email: string;
    password: string;
    correlationId?: string;
  }): Promise<typeof VALID_RESULT> {
    this.lastRequest = request;
    if (this.shouldFail) {
      throw new AuthenticationFailedError("INVALID_PASSWORD");
    }
    return VALID_RESULT;
  }
}

class BrokenLoginService {
  public async execute(): Promise<never> {
    throw new Error("ECONNREFUSED 127.0.0.1:3306 (mensagem de driver simulada, nunca deveria vazar)");
  }
}

async function startTestServer(loginService: FakeLoginService | BrokenLoginService, secure = false) {
  const app = createApp({
    loginService: loginService as unknown as LoginService,
    sessionCookieConfig: { secure }
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("POST /api/v1/sessions", () => {
  let server: Server;
  let baseUrl: string;
  let loginService: FakeLoginService;

  beforeEach(async () => {
    loginService = new FakeLoginService();
    ({ server, baseUrl } = await startTestServer(loginService));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("32. sucesso retorna 201", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });

    expect(res.status).toBe(201);
  });

  it("33. body exato: { session: { publicId, expiresAt }, identity: { publicId } }", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toEqual({
      session: { publicId: VALID_RESULT.sessionPublicId, expiresAt: VALID_RESULT.expiresAt.toISOString() },
      identity: { publicId: VALID_RESULT.identityPublicId }
    });
    expect(Object.keys(body)).toEqual(["session", "identity"]);
  });

  it("[revisão crítica, item 14] Location aponta para /api/v1/sessions/{publicId} do recurso criado", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });

    expect(res.headers.get("location")).toBe(`/api/v1/sessions/${VALID_RESULT.sessionPublicId}`);
  });

  it("nunca inclui ADMIN/roles/permissions/applicationAccesses no corpo", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });
    const bodyText = await res.text();

    expect(bodyText.toLowerCase()).not.toContain("admin");
    expect(bodyText.toLowerCase()).not.toContain("role");
    expect(bodyText.toLowerCase()).not.toContain("permission");
    expect(bodyText.toLowerCase()).not.toContain("applicationaccess");
  });

  it("34/35/36. Set-Cookie presente, com HttpOnly", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie?.toLowerCase()).toContain("httponly");
    expect(setCookie?.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
  });

  it("38. rawToken NUNCA aparece no corpo JSON", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });
    const bodyText = await res.text();

    expect(bodyText).not.toContain(VALID_RESULT.rawToken);
  });

  it("o cookie CONTÉM o rawToken (é o transporte correto para ele)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(VALID_RESULT.rawToken);
  });

  it("[PROVA EXAUSTIVA — revisão crítica, item 8] o Set-Cookie completo NÃO contém password/email/identityPublicId/sessionPublicId — apenas o token opaco é conteúdo sensível", async () => {
    const submittedEmail = "pessoa-especifica-para-o-teste@example.com";
    const submittedPassword = "senha-que-nunca-deveria-aparecer-no-cookie-999";
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: submittedEmail, password: submittedPassword })
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).not.toContain(submittedPassword);
    expect(setCookie).not.toContain(submittedEmail);
    expect(setCookie).not.toContain(VALID_RESULT.identityPublicId);
    expect(setCookie).not.toContain(VALID_RESULT.sessionPublicId);
    // O único valor sensível esperado no cookie é o rawToken.
    expect(setCookie).toContain(VALID_RESULT.rawToken);
  });

  it("39. AUTHENTICATION_FAILED = 401", async () => {
    loginService.shouldFail = true;
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-errada" })
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("AUTHENTICATION_FAILED");
  });

  it("40. correlation-id presente na resposta de erro", async () => {
    loginService.shouldFail = true;
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-errada" })
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(extractError(body).correlation_id).toBeDefined();
    expect(extractError(body).correlation_id).not.toBeNull();
  });

  it("mensagem de erro nunca ecoa o e-mail submetido nem a senha", async () => {
    loginService.shouldFail = true;
    const submittedEmail = "pessoa-especifica@example.com";
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: submittedEmail, password: "senha-secreta-999" })
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(extractError(body).message).not.toContain(submittedEmail);
    expect(extractError(body).message).not.toContain("senha-secreta-999");
  });

  it("42. corpo malformado (email/password ausentes) não gera erro distinto de AUTHENTICATION_FAILED", async () => {
    loginService.shouldFail = true; // simula que email/password vazios nunca autenticam
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("AUTHENTICATION_FAILED");
    expect(loginService.lastRequest?.email).toBe("");
    expect(loginService.lastRequest?.password).toBe("");
  });

  it("43. rota desconhecida continua 404", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rota-que-nao-existe`);
    expect(res.status).toBe(404);
  });

  it("44. /health continua 200", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("preserva correlation-id — X-Correlation-Id enviado é refletido", async () => {
    const correlationId = "8f14e45f-ceea-467e-a1a3-000000000099";
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": correlationId },
      body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
    });

    expect(res.headers.get("x-correlation-id")).toBe(correlationId);
  });
});

describe("POST /api/v1/sessions — [revisão crítica, item 15 — Fase D] CSRF helper não acoplado ao LOGIN", () => {
  it("createApp.ts nunca importa csrfGuard diretamente — o helper fica encapsulado em sessionRoutes.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../../../app/http/createApp.ts", import.meta.url), "utf-8");

    expect(source).not.toContain("csrfGuard");
    expect(source).not.toContain("isCsrfSafeRequest");
  });

  it("sessionRoutes.ts IMPORTA csrfGuard (Fase E, logout) — mas comprovadamente não é aplicado ao POST / (login), só ao DELETE /current", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../sessionRoutes.ts", import.meta.url), "utf-8");

    // Fase E: csrfGuard passou a ser usado — para o logout, não para o
    // login. A prova comportamental de que o login continua sem exigir
    // Origin/Referer está nos dois testes HTTP abaixo.
    expect(source).toContain("isCsrfSafeRequest");
    // A chamada de CSRF ocorre dentro do handler DELETE, nunca dentro do
    // handler POST — checagem estrutural: o texto entre 'router.post(\"/\"'
    // e o próximo 'router.' não contém a chamada de CSRF.
    const postHandlerStart = source.indexOf('router.post("/"');
    const deleteHandlerStart = source.indexOf('router.delete("/current"');
    expect(postHandlerStart).toBeGreaterThanOrEqual(0);
    expect(deleteHandlerStart).toBeGreaterThan(postHandlerStart);
    const postHandlerSource = source.slice(postHandlerStart, deleteHandlerStart);
    expect(postHandlerSource).not.toContain("isCsrfSafeRequest");
  });

  it("login funciona normalmente SEM os headers Origin/Referer — não quebra CLI/API clients futuros sem decisão explícita", async () => {
    const loginService = new FakeLoginService();
    const { server, baseUrl } = await startTestServer(loginService);
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" }, // deliberadamente sem Origin/Referer
        body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
      });

      expect(res.status).toBe(201);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("login funciona normalmente mesmo com Origin de uma origem não relacionada — nenhuma validação de Origin ocorre no login", async () => {
    const loginService = new FakeLoginService();
    const { server, baseUrl } = await startTestServer(loginService);
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://qualquer-origem-nao-relacionada.example.com" },
        body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
      });

      expect(res.status).toBe(201);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("POST /api/v1/sessions — Secure conforme config", () => {
  it("37. Secure=true quando configurado", async () => {
    const loginService = new FakeLoginService();
    const { server, baseUrl } = await startTestServer(loginService, true);
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
      });
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie?.toLowerCase()).toContain("secure");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("Secure=false quando configurado explicitamente (ex.: development local)", async () => {
    const loginService = new FakeLoginService();
    const { server, baseUrl } = await startTestServer(loginService, false);
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
      });
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie?.toLowerCase()).not.toContain("secure");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("POST /api/v1/sessions — 500 sanitizado", () => {
  it("erro inesperado (bug/driver) nunca vaza detalhe interno", async () => {
    const { server, baseUrl } = await startTestServer(new BrokenLoginService());
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@example.com", password: "senha-correta-123456" })
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

describe("POST /api/v1/sessions — [PROVA END-TO-END, revisão crítica, item 12] senha curta -> 401 AUTHENTICATION_FAILED, NUNCA 422 de política de senha", () => {
  /**
   * Diferente dos outros testes deste arquivo (que usam `FakeLoginService`,
   * um duplo de teste que não exercita `PlainPassword` de verdade), este
   * bloco usa o `LoginService` REAL (com `FakeLoginConnection` no lugar
   * do MariaDB real) — prova de ponta a ponta, através da rota HTTP
   * real, que o caminho de login usa
   * `PlainPassword.forVerification()` (sem política), nunca
   * `PlainPassword.create()` (com política de comprimento mínimo/
   * blacklist). Se um erro de implementação futuro trocasse
   * acidentalmente para `create()`, este teste pegaria a regressão: uma
   * senha curta lançaria `CredentialPasswordPolicyViolationError`
   * (`VALIDATION`, 422) em vez de `AuthenticationFailedError`
   * (`AUTHENTICATION`, 401) — exatamente o tipo de vazamento de
   * enumeração que a revisão crítica identificou como risco.
   */
  async function startRealLoginServer() {
    const connection = new FakeLoginConnection();
    const pool = new FakeLoginConnectionPool(() => connection);
    const loginService = new LoginService(
      pool,
      (conn) => new MariaDbIdentityRepository(conn),
      (conn) => new MariaDbCredentialRepository(conn),
      (conn) => new MariaDbSessionRepository(conn),
      (conn) => new MariaDbAuditEventRepository(conn),
      { verify: async () => false }, // senha nunca confere — força o caminho de falha
      { generate: () => "token-nao-deveria-ser-usado" },
      3600
    );
    const app = createApp({ loginService, sessionCookieConfig: { secure: false } });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado do servidor de teste");
    }
    return { server, baseUrl: `http://127.0.0.1:${address.port}` };
  }

  it("senha com 5 caracteres (abaixo de MIN_PASSWORD_LENGTH=12): 401 AUTHENTICATION_FAILED, nunca 422", async () => {
    const { server, baseUrl } = await startRealLoginServer();
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@example.com", password: "curta" })
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("AUTHENTICATION_FAILED");
      expect(res.status).not.toBe(422);
      expect(extractError(body).code).not.toBe("CREDENTIAL_PASSWORD_POLICY_VIOLATION");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("senha que está na blacklist de senhas comprometidas (ex.: 'password123456'): ainda 401, nunca 422 — blacklist é regra de CRIAÇÃO de senha, não de verificação", async () => {
    const { server, baseUrl } = await startRealLoginServer();
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@example.com", password: "password123456" })
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("AUTHENTICATION_FAILED");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("string vazia como senha: ainda 401 genérico, nunca 422", async () => {
    const { server, baseUrl } = await startRealLoginServer();
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@example.com", password: "" })
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(401);
      expect(extractError(body).code).toBe("AUTHENTICATION_FAILED");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
