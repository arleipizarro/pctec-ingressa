import type { Pool } from "mysql2/promise";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { createApp } from "../../../app/http/createApp.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbSessionRepository } from "../infrastructure/persistence/MariaDbSessionRepository.js";
import { LogoutService } from "../application/LogoutService.js";
import { ValidateSessionService } from "../application/ValidateSessionService.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { Session } from "../domain/session/Session.js";
import { CryptoSessionTokenGenerator } from "../infrastructure/token/SessionTokenGenerator.js";
import { hashSessionToken } from "../infrastructure/token/hashSessionToken.js";
import { SESSION_COOKIE_NAME } from "../http/sessionCookie.js";

/**
 * Teste de integração real do fluxo completo de validação de sessão e
 * logout — v0.6.x, Fase E. Prova a cadeia completa contra um MariaDB de
 * verdade e um servidor HTTP efêmero real: `GET /api/v1/me` com cookie
 * válido -> 200; `DELETE /api/v1/sessions/current` -> 204 -> mesmo
 * cookie depois -> 401.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, mesmo padrão de `SessionAuth.integration.test.ts`
 * (v0.6.0, Fase D).
 *
 * **Nunca usa a Identity/Credential/Session/ApplicationAccess reais** —
 * cria sua PRÓPRIA Identity fixture (`ACTIVE`, `loginEnabled=true`) e
 * sua própria `Session` fixture (via `Session.create()` +
 * `SessionRepository.insert()` diretamente — não precisa de login real
 * nem de Argon2id/Credential, já que o objetivo aqui é testar VALIDAÇÃO
 * de sessão, não autenticação). Cleanup específico, por `public_id` —
 * nunca `DELETE` genérico, nunca a Identity/Session fundacionais reais.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)(
  "SessionValidation (integração - requer MariaDB real, validação de sessão e logout)",
  () => {
    let pool: Pool;
    let server: Server;
    let baseUrl: string;
    let fixtureIdentityPublicId: string | undefined;
    let fixtureSessionPublicId: string | undefined;
    let fixtureRawToken: string;

    beforeAll(async () => {
      const env = loadEnv();
      pool = createPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD
      });

      const identityRepository = new MariaDbIdentityRepository(pool);
      const systemActor = ActorPublicId.system();
      const fixtureIdentity = Identity.create({
        type: "HUMAN",
        fullName: "Fixture de Integracao - Session Validation v0.6.x",
        email: `session-validation-integration-${Date.now()}@example.invalid`,
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

      const sessionRepository = new MariaDbSessionRepository(pool);
      const tokenGenerator = new CryptoSessionTokenGenerator();
      fixtureRawToken = tokenGenerator.generate();
      const fixtureSession = Session.create({
        identityPublicId: fixtureIdentityPublicId,
        tokenHash: hashSessionToken(fixtureRawToken),
        ttlSeconds: 3600,
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      fixtureSession.pullDomainEvents();
      await sessionRepository.insert(fixtureSession);
      fixtureSessionPublicId = fixtureSession.getPublicId().toString();

      const validateSessionService = new ValidateSessionService(
        new MariaDbSessionRepository(pool),
        new MariaDbIdentityRepository(pool)
      );
      const logoutService = new LogoutService(
        pool,
        (connection) => new MariaDbSessionRepository(connection),
        (connection) => new MariaDbIdentityRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection)
      );
      const app = createApp({
        validateSessionService,
        logoutService,
        sessionCookieConfig: { secure: false },
        allowedOrigins: [`http://127.0.0.1:${env.PORT}`]
      });
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

      if (fixtureSessionPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureSessionPublicId]);
        await pool.execute(`DELETE FROM sessions WHERE public_id = ?`, [fixtureSessionPublicId]);
      }
      if (fixtureIdentityPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureIdentityPublicId]);
        await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentityPublicId]);
      }
      await pool.end();
    });

    it("GET /api/v1/me com cookie de sessao fixture valida -> 200, body correto", async () => {
      const res = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` }
      });
      const body = (await res.json()) as { identity: { publicId: string }; session: { publicId: string } };

      expect(res.status).toBe(200);
      expect(body.identity.publicId).toBe(fixtureIdentityPublicId);
      expect(body.session.publicId).toBe(fixtureSessionPublicId);
    });

    it("DELETE /api/v1/sessions/current (logout) -> 204, e o MESMO cookie depois -> 401", async () => {
      const cookie = `${SESSION_COOKIE_NAME}=${fixtureRawToken}`;
      const env = loadEnv();

      const logoutRes = await fetch(`${baseUrl}/api/v1/sessions/current`, {
        method: "DELETE",
        headers: { cookie, origin: `http://127.0.0.1:${env.PORT}` }
      });
      expect(logoutRes.status).toBe(204);

      const [sessionRows] = await pool.execute(`SELECT status, revocation_reason FROM sessions WHERE public_id = ?`, [
        fixtureSessionPublicId
      ]);
      const sessionRow = (sessionRows as Array<Record<string, unknown>>)[0];
      expect(sessionRow?.["status"]).toBe("REVOKED");
      expect(sessionRow?.["revocation_reason"]).toBe("LOGOUT");

      const meRes = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie } });
      expect(meRes.status).toBe(401);

      const [auditRows] = await pool.execute(
        `SELECT event_type FROM audit_events WHERE aggregate_public_id = ? AND event_type = 'session.revoked'`,
        [fixtureSessionPublicId]
      );
      expect((auditRows as unknown[]).length).toBe(1);
    });

    it("GET /api/v1/me sem cookie -> 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/me`);
      expect(res.status).toBe(401);
    });
  }
);
