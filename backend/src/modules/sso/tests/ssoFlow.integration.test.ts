import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createApp } from "../../../app/http/createApp.js";
import { createPool } from "../../../shared/database/Pool.js";
import { loadEnv } from "../../../app/config/env.js";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { fixtureRunId } from "../../../shared/types/integration-database-guard.js";
import { SESSION_COOKIE_NAME } from "../../security/http/sessionCookie.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../../portal/http/requireServiceCredential.js";
import { PCTEC_PORTAL_APPLICATION_PUBLIC_ID } from "../../application/domain/value-objects/ApplicationCodes.js";
import { deriveCodeChallengeS256 } from "../infrastructure/token/pkce.js";

/**
 * Fatia vertical do SSO contra MariaDB REAL, atravessando as duas
 * fronteiras HTTP do Ingressa num servidor efêmero:
 *
 *   cookie de sessão → GET /api/v1/sso/authorize → 302 com code+state
 *   → POST /api/v1/service/sso/token (credencial de serviço) → identidade
 *
 * Nenhum serviço é injetado: `createApp()` monta as implementações reais
 * sobre o pool real. O que este teste prova, e o unitário não pode: que
 * a emissão consulta ApplicationAccess e Membership de verdade, que o
 * código sobrevive a um round-trip pelo banco, e que o replay morre no
 * `UPDATE` condicional.
 *
 * Isolamento garantido por `shouldRunIntegrationTests()` (banco `_test`
 * obrigatório) e fixtures com prefixo único, removidas no teardown.
 */
const executar = shouldRunIntegrationTests();

const REDIRECT_URI = "https://portal.example.invalid/api/auth/ingressa/callback";
const CREDENCIAL = "credencial-de-servico-de-integracao";
const VERIFIER = randomBytes(32).toString("base64url");
const ESTADO = randomBytes(16).toString("base64url").replace(/[^A-Za-z0-9\-._~]/g, "x");

describe.skipIf(!executar)("SSO ponta a ponta com banco real (integração)", () => {
  const execucao = fixtureRunId();
  const identityPublicId = randomUUID();
  const organizationPublicId = randomUUID();
  const membershipPublicId = randomUUID();
  const accessPublicId = randomUUID();
  const sessionPublicId = randomUUID();
  const tokenDeSessao = randomBytes(32).toString("base64url");

  let pool: ReturnType<typeof createPool>;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env["SSO_PORTAL_REDIRECT_URIS"] = REDIRECT_URI;
    process.env["INGRESSA_PORTAL_SERVICE_CREDENTIAL"] = CREDENCIAL;

    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });

    await pool.execute(
      `INSERT INTO identities
         (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', 1, 1, NOW(3), NOW(3))`,
      [identityPublicId, `Piloto TUV ${execucao}`, `piloto-${execucao}@example.invalid`, `piloto-${execucao}@example.invalid`]
    );
    await pool.execute(
      `INSERT INTO organizations (public_id, type, legal_name, status, version, created_at, updated_at)
       VALUES (?, 'COMPANY', ?, 'ACTIVE', 1, NOW(3), NOW(3))`,
      [organizationPublicId, `Empresa Piloto ${execucao}`]
    );
    await pool.execute(
      `INSERT INTO memberships
         (public_id, identity_public_id, organization_public_id, profile, scope, status, started_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'CUSTOMER', 'ORGANIZATION_ONLY', 'ACTIVE', NOW(3), 1, NOW(3), NOW(3))`,
      [membershipPublicId, identityPublicId, organizationPublicId]
    );
    await pool.execute(
      `INSERT INTO application_accesses
         (public_id, identity_public_id, application_public_id, access_profile, status, granted_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', 'GRANTED', NOW(3), 1, NOW(3), NOW(3))`,
      [accessPublicId, identityPublicId, PCTEC_PORTAL_APPLICATION_PUBLIC_ID]
    );
    await pool.execute(
      `INSERT INTO sessions
         (public_id, identity_public_id, token_hash, status, created_at, expires_at, version)
       VALUES (?, ?, ?, 'ACTIVE', NOW(3), DATE_ADD(NOW(3), INTERVAL 1 HOUR), 1)`,
      [sessionPublicId, identityPublicId, createHash("sha256").update(tokenDeSessao, "utf8").digest("hex")]
    );

    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const endereco = server.address();
    if (endereco === null || typeof endereco === "string") {
      throw new Error("endereço inesperado do servidor de teste");
    }
    baseUrl = `http://127.0.0.1:${endereco.port}`;
  });

  afterAll(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool !== undefined) {
      for (const sql of [
        "DELETE FROM sso_authorization_codes WHERE identity_public_id = ?",
        "DELETE FROM sessions WHERE identity_public_id = ?",
        "DELETE FROM application_accesses WHERE identity_public_id = ?",
        "DELETE FROM memberships WHERE identity_public_id = ?",
        "DELETE FROM audit_events WHERE actor_public_id = ?",
        "DELETE FROM identities WHERE public_id = ?"
      ]) {
        await pool.execute(sql, [identityPublicId]).catch(() => undefined);
      }
      await pool.execute("DELETE FROM organizations WHERE public_id = ?", [organizationPublicId]).catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
    delete process.env["SSO_PORTAL_REDIRECT_URIS"];
    delete process.env["INGRESSA_PORTAL_SERVICE_CREDENTIAL"];
  });

  function urlDeAutorizacao(): string {
    const query = new URLSearchParams({
      client_id: "PCTEC_PORTAL",
      redirect_uri: REDIRECT_URI,
      state: ESTADO,
      code_challenge: deriveCodeChallengeS256(VERIFIER),
      code_challenge_method: "S256"
    });
    return `${baseUrl}/api/v1/sso/authorize?${query.toString()}`;
  }

  async function autorizar(): Promise<URL> {
    const res = await fetch(urlDeAutorizacao(), {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenDeSessao}` }
    });
    expect(res.status).toBe(302);
    return new URL(res.headers.get("location") ?? "");
  }

  async function trocar(code: string, verifier = VERIFIER): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/service/sso/token`, {
      method: "POST",
      headers: { "content-type": "application/json", [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL },
      body: JSON.stringify({
        client_id: "PCTEC_PORTAL",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI
      })
    });
  }

  it("emite o código e troca por identidade — fluxo completo contra o banco", async () => {
    const destino = await autorizar();
    expect(destino.searchParams.get("state")).toBe(ESTADO);
    const code = destino.searchParams.get("code");
    expect(code).toEqual(expect.any(String));

    const troca = await trocar(code as string);
    expect(troca.status).toBe(200);
    const corpo = (await troca.json()) as Record<string, any>;
    expect(corpo["identity"]["publicId"]).toBe(identityPublicId);
    expect(corpo["identity"]["fullName"]).toBe(`Piloto TUV ${execucao}`);
    expect(corpo["access"]["profile"]).toBe("USER");
  });

  it("REPLAY do mesmo código falha na segunda tentativa", async () => {
    const destino = await autorizar();
    const code = destino.searchParams.get("code") as string;

    expect((await trocar(code)).status).toBe(200);
    expect((await trocar(code)).status).toBe(401);
  });

  it("code_verifier errado falha e QUEIMA o código", async () => {
    const destino = await autorizar();
    const code = destino.searchParams.get("code") as string;

    expect((await trocar(code, randomBytes(32).toString("base64url"))).status).toBe(401);
    // Mesmo com o verifier correto, o código já foi gasto pela tentativa.
    expect((await trocar(code)).status).toBe(401);
  });

  it("redirect_uri diferente na troca falha", async () => {
    const destino = await autorizar();
    const code = destino.searchParams.get("code") as string;

    const res = await fetch(`${baseUrl}/api/v1/service/sso/token`, {
      method: "POST",
      headers: { "content-type": "application/json", [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL },
      body: JSON.stringify({
        client_id: "PCTEC_PORTAL",
        code,
        code_verifier: VERIFIER,
        redirect_uri: "https://portal.example.invalid/outro"
      })
    });
    expect(res.status).toBe(401);
  });

  it("o código emitido está no banco apenas como hash", async () => {
    const destino = await autorizar();
    const code = destino.searchParams.get("code") as string;

    const [linhas] = await pool.execute(
      `SELECT * FROM sso_authorization_codes WHERE identity_public_id = ? AND code_hash = ?`,
      [identityPublicId, createHash("sha256").update(code, "utf8").digest("hex")]
    );
    expect((linhas as unknown[]).length).toBe(1);
    expect(JSON.stringify(linhas)).not.toContain(code);
  });

  it("a emissão é auditada", async () => {
    await autorizar();
    const [linhas] = await pool.execute(
      `SELECT event_type FROM audit_events WHERE actor_public_id = ? AND event_type = 'sso.authorization-code.issued'`,
      [identityPublicId]
    );
    expect((linhas as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("ACESSO REVOGADO impede novo SSO — e a revogação vale na próxima tentativa", async () => {
    await pool.execute(
      `UPDATE application_accesses SET status = 'REVOKED', revoked_at = NOW(3), version = version + 1 WHERE public_id = ?`,
      [accessPublicId]
    );

    const res = await fetch(urlDeAutorizacao(), {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tokenDeSessao}` }
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    // Volta ao launcher, NUNCA ao redirect_uri do cliente.
    expect(location.startsWith("/apps?")).toBe(true);
    expect(location).not.toContain("portal.example.invalid");
  });
});
