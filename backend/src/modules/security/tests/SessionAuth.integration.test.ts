import type { Pool } from "mysql2/promise";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { createApp } from "../../../app/http/createApp.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbCredentialRepository } from "../infrastructure/persistence/MariaDbCredentialRepository.js";
import { Argon2PasswordHasher } from "../infrastructure/hashing/Argon2PasswordHasher.js";
import { LoginService } from "../application/LoginService.js";
import { MariaDbSessionRepository } from "../infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { CryptoSessionTokenGenerator } from "../infrastructure/token/SessionTokenGenerator.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { Credential } from "../domain/Credential.js";
import { SESSION_COOKIE_NAME } from "../http/sessionCookie.js";

/**
 * Teste de integração real do fluxo completo de login — v0.6.0, Fase D.
 * Prova a cadeia completa: `POST /api/v1/sessions` real → autenticação
 * real (Argon2id real) → transação real → `UPDATE credentials`
 * (`last_authenticated_at`) → `INSERT sessions` → `INSERT audit_events`
 * (`session.created`) → `COMMIT`, contra um MariaDB de verdade e um
 * servidor HTTP efêmero real.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, mesmo padrão de
 * `BootstrapFirstCredentialService.integration.test.ts` (v0.5.x).
 *
 * **Nunca usa a Identity/Credential/ApplicationAccess reais** — cria sua
 * PRÓPRIA Identity fixture (`ACTIVE`, `loginEnabled=true`) e sua própria
 * `Credential LOCAL_PASSWORD` fixture (hash Argon2id real), via
 * repositórios diretamente — nunca via `BootstrapFirstCredentialService`
 * (que tem seu próprio guard global one-shot, incompatível com uma base
 * onde a Credential fundacional real já existe). Cleanup específico, por
 * `public_id` — nunca `DELETE` genérico, nunca a Identity/Credential
 * fundacionais reais.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)(
  "SessionAuth (integração — requer MariaDB real, fluxo completo de login)",
  () => {
    let pool: Pool;
    let server: Server;
    let baseUrl: string;
    let fixtureIdentityPublicId: string | undefined;
    let fixtureCredentialPublicId: string | undefined;
    let createdSessionPublicId: string | undefined;

    const FIXTURE_PASSWORD = "senha-de-integracao-para-login-123456";

    beforeAll(async () => {
      const env = loadEnv();
      pool = createPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER, // usuário runtime — NUNCA migrator
        password: env.DB_PASSWORD
      });

      // Cria a Identity fixture própria — ACTIVE + loginEnabled=true
      // diretamente (nunca via bootstrap real).
      const identityRepository = new MariaDbIdentityRepository(pool);
      const systemActor = ActorPublicId.system();
      const fixtureIdentity = Identity.create({
        type: "HUMAN",
        fullName: "Fixture de Integração — Session Auth v0.6.0",
        email: `session-auth-integration-${Date.now()}@example.invalid`,
        actor: systemActor,
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      await identityRepository.insert(fixtureIdentity);
      fixtureIdentity.activate({
        actor: systemActor,
        expectedVersion: fixtureIdentity.getVersion(),
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      fixtureIdentity.enableLogin({
        actor: systemActor,
        expectedVersion: fixtureIdentity.getVersion(),
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      await identityRepository.update(fixtureIdentity, 1);
      fixtureIdentityPublicId = fixtureIdentity.getPublicId().toString();

      // Cria a Credential fixture própria (Argon2id real) — diretamente
      // via o Aggregate + repository, nunca via
      // BootstrapFirstCredentialService (guard global incompatível).
      const credentialRepository = new MariaDbCredentialRepository(pool);
      const hasher = new Argon2PasswordHasher();
      const passwordHash = await hasher.hash({
        revealForHashing: () => FIXTURE_PASSWORD
      } as Parameters<typeof hasher.hash>[0]);
      const fixtureCredential = Credential.createFoundational({
        identityPublicId: fixtureIdentityPublicId,
        passwordHash,
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      await credentialRepository.insert(fixtureCredential);
      fixtureCredentialPublicId = fixtureCredential.getPublicId().toString();

      // Servidor HTTP efêmero real, apontando para o MariaDB real —
      // mesmo padrão de createApp.test.ts, porta 0 (SO escolhe).
      const loginService = new LoginService(
        pool,
        (connection) => new MariaDbIdentityRepository(connection),
        (connection) => new MariaDbCredentialRepository(connection),
        (connection) => new MariaDbSessionRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection),
        new Argon2PasswordHasher(),
        new CryptoSessionTokenGenerator(),
        env.SESSION_TTL_SECONDS
      );
      const app = createApp({ loginService, sessionCookieConfig: { secure: false } });
      server = app.listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("endereço inesperado do servidor de teste");
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });

      if (createdSessionPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [createdSessionPublicId]);
        await pool.execute(`DELETE FROM sessions WHERE public_id = ?`, [createdSessionPublicId]);
      }
      if (fixtureCredentialPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureCredentialPublicId]);
        await pool.execute(`DELETE FROM credentials WHERE public_id = ?`, [fixtureCredentialPublicId]);
      }
      if (fixtureIdentityPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureIdentityPublicId]);
        await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentityPublicId]);
      }
      await pool.end();
    });

    it("login com senha correta: 201, cookie, Session no banco, lastAuthenticatedAt, session.created", async () => {
      const [identityRows] = await pool.execute(`SELECT email FROM identities WHERE public_id = ?`, [
        fixtureIdentityPublicId
      ]);
      const email = (identityRows as Array<Record<string, unknown>>)[0]?.["email"];

      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: FIXTURE_PASSWORD })
      });
      const body = (await res.json()) as { session: { publicId: string; expiresAt: string }; identity: { publicId: string } };

      expect(res.status).toBe(201);
      expect(body.identity.publicId).toBe(fixtureIdentityPublicId);
      createdSessionPublicId = body.session.publicId;

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain(SESSION_COOKIE_NAME);

      const [sessionRows] = await pool.execute(`SELECT status, identity_public_id FROM sessions WHERE public_id = ?`, [
        createdSessionPublicId
      ]);
      const sessionRow = (sessionRows as Array<Record<string, unknown>>)[0];
      expect(sessionRow?.["status"]).toBe("ACTIVE");
      expect(sessionRow?.["identity_public_id"]).toBe(fixtureIdentityPublicId);

      const [credentialRows] = await pool.execute(`SELECT last_authenticated_at FROM credentials WHERE public_id = ?`, [
        fixtureCredentialPublicId
      ]);
      expect((credentialRows as Array<Record<string, unknown>>)[0]?.["last_authenticated_at"]).not.toBeNull();

      const [auditRows] = await pool.execute(
        `SELECT event_type, actor_public_id FROM audit_events WHERE aggregate_public_id = ?`,
        [createdSessionPublicId]
      );
      const auditEvents = auditRows as Array<Record<string, unknown>>;
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]?.["event_type"]).toBe("session.created");
      expect(auditEvents[0]?.["actor_public_id"]).toBe(fixtureIdentityPublicId);
    });

    it("senha errada: 401 genérico (AUTHENTICATION_FAILED), nenhuma Session criada", async () => {
      const [identityRows] = await pool.execute(`SELECT email FROM identities WHERE public_id = ?`, [
        fixtureIdentityPublicId
      ]);
      const email = (identityRows as Array<Record<string, unknown>>)[0]?.["email"];

      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "senha-errada-de-proposito-123" })
      });
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status).toBe(401);
      expect(body.error.code).toBe("AUTHENTICATION_FAILED");
    });
  }
);
