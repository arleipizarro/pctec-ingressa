import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import { LogoutService } from "../../application/LogoutService.js";
import { ValidateSessionService } from "../../application/ValidateSessionService.js";
import { MariaDbSessionRepository } from "../../infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbIdentityRepository } from "../../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { SESSION_COOKIE_NAME } from "../sessionCookie.js";
import { FakeLogoutConnection, FakeLogoutConnectionPool } from "../../tests/FakeLogoutConnection.js";

const ALLOWED_ORIGIN = "https://ingressa-dev.pctec.com.br";

interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly correlation_id: string | null;
  readonly details: readonly unknown[];
}

function extractError(body: Record<string, unknown>): ErrorEnvelope {
  return body["error"] as ErrorEnvelope;
}

async function startTestServer(connection: FakeLogoutConnection) {
  const pool = new FakeLogoutConnectionPool(() => connection);
  const logoutService = new LogoutService(
    pool,
    (conn) => new MariaDbSessionRepository(conn),
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn)
  );
  const validateSessionService = new ValidateSessionService(
    new MariaDbSessionRepository(connection),
    new MariaDbIdentityRepository(connection)
  );

  const app = createApp({
    logoutService,
    validateSessionService,
    sessionCookieConfig: { secure: false },
    allowedOrigins: [ALLOWED_ORIGIN]
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("DELETE /api/v1/sessions/current - logout", () => {
  let server: Server;
  let baseUrl: string;
  let connection: FakeLogoutConnection;

  beforeEach(async () => {
    connection = new FakeLogoutConnection();
    ({ server, baseUrl } = await startTestServer(connection));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("24. sem cookie -> 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { origin: ALLOWED_ORIGIN }
    });
    expect(res.status).toBe(401);
  });

  it("25. logout valido (cookie + Origin confiavel) -> 204", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`, origin: ALLOWED_ORIGIN }
    });
    expect(res.status).toBe(204);
  });

  it("204 nao tem corpo", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`, origin: ALLOWED_ORIGIN }
    });
    const bodyText = await res.text();
    expect(bodyText).toBe("");
  });

  it("31. Set-Cookie de limpeza presente (Max-Age=0/Expires no passado)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`, origin: ALLOWED_ORIGIN }
    });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie?.toLowerCase()).toMatch(/max-age=0|expires=/);
  });

  it("32. mesmo token DEPOIS do logout: GET /api/v1/me com o mesmo cookie -> 401", async () => {
    const cookie = `${SESSION_COOKIE_NAME}=token-de-teste-123`;

    const logoutRes = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { cookie, origin: ALLOWED_ORIGIN }
    });
    expect(logoutRes.status).toBe(204);

    const meRes = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie } });
    expect(meRes.status).toBe(401);
  });

  it("33. Origin valido (confiavel) -> passa (nao e bloqueado por CSRF)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`, origin: ALLOWED_ORIGIN }
    });
    expect(res.status).not.toBe(403);
  });

  it("34. Origin invalido (nao confiavel) -> 403, rejeitado por CSRF", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`,
        origin: "https://site-malicioso.example.com"
      }
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(extractError(body).code).toBe("CSRF_ORIGIN_REJECTED");
  });

  it("Origin invalido: sessao NAO e revogada (a rejeicao de CSRF acontece antes de qualquer chamada ao LogoutService)", async () => {
    await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`,
        origin: "https://site-malicioso.example.com"
      }
    });

    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE SESSIONS"))).toBe(false);
  });

  it("35. Referer como fallback valido (sem Origin) -> passa", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`,
        referer: `${ALLOWED_ORIGIN}/pagina-qualquer`
      }
    });
    expect(res.status).not.toBe(403);
  });

  it("nem Origin nem Referer presentes -> 403 (nunca assume 'ausencia e segura')", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123` }
    });
    expect(res.status).toBe(403);
  });

  it("correlation-id preservado na resposta de sucesso (204)", async () => {
    const correlationId = "8f14e45f-ceea-467e-a1a3-000000000210";
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=token-de-teste-123`,
        origin: ALLOWED_ORIGIN,
        "x-correlation-id": correlationId
      }
    });
    expect(res.headers.get("x-correlation-id")).toBe(correlationId);
  });

  it("token bruto nunca aparece na resposta HTTP (nem sucesso nem erro)", async () => {
    const token = "token-secreto-nao-deveria-vazar-999";
    const res = await fetch(`${baseUrl}/api/v1/sessions/current`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, origin: ALLOWED_ORIGIN }
    });
    const bodyText = await res.text();
    expect(bodyText).not.toContain(token);
  });
});
