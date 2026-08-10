import type { Pool } from "mysql2/promise";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { createApp } from "../../../app/http/createApp.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbSessionRepository } from "../../security/infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbApplicationRepository } from "../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { ValidateSessionService } from "../../security/application/ValidateSessionService.js";
import { AuthorizeApplicationAccessService } from "../application/AuthorizeApplicationAccessService.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { Session } from "../../security/domain/session/Session.js";
import { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import { PCTEC_INGRESSA_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";
import { CryptoSessionTokenGenerator } from "../../security/infrastructure/token/SessionTokenGenerator.js";
import { hashSessionToken } from "../../security/infrastructure/token/hashSessionToken.js";
import { SESSION_COOKIE_NAME } from "../../security/http/sessionCookie.js";

/**
 * Teste de integração real do fluxo completo de autorização —
 * v0.6.x, Fase F. Prova a cadeia completa contra um MariaDB de verdade e
 * um servidor HTTP efêmero real: `GET /api/v1/admin/whoami` com cookie
 * válido + `ApplicationAccess` ADMIN GRANTED -> 200; sem access -> 403.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, mesmo padrão de `SessionValidation.integration.test.ts`
 * (v0.6.x, Fase E).
 *
 * **`Application`: usa a `PCTEC_INGRESSA` REAL, justificado.**
 * `Application` não tem NENHUM comando de criação no domínio atual —
 * `Application.ts` só expõe `reconstitute()`; a única linha existente é
 * o seed técnico da migration `0007`. Não há como criar uma `Application`
 * fixture própria sem uma migration nova (fora de escopo desta fatia,
 * task seção 29: "Preferência: nenhuma migration nova"). Por isso, este
 * teste resolve a aplicação real por CÓDIGO
 * (`PCTEC_INGRESSA_APPLICATION_CODE`, nunca UUID hardcoded) —
 * **somente leitura, nunca modifica/revoga o seed real** (nenhum
 * `UPDATE`/`DELETE` em `applications` em nenhum momento deste arquivo).
 *
 * **`Identity`/`Session`/`ApplicationAccess`: fixtures próprias.** Nunca
 * usa a Identity/Session/ApplicationAccess reais do Product Owner —
 * cria as suas, vinculadas à aplicação real (só leitura) acima. Cleanup
 * específico, por `public_id` — nunca `DELETE` genérico.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)(
  "ApplicationAccessEnforcement (integração - requer MariaDB real, autorização)",
  () => {
    let pool: Pool;
    let server: Server;
    let baseUrl: string;
    let fixtureIdentityPublicId: string | undefined;
    let fixtureSessionPublicId: string | undefined;
    let fixtureApplicationAccessPublicId: string | undefined;
    let realPctecIngressaApplicationPublicId: string;
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

      const applicationRepository = new MariaDbApplicationRepository(pool);
      const realApplication = await applicationRepository.findByCode(
        ApplicationCode.create(PCTEC_INGRESSA_APPLICATION_CODE)
      );
      if (realApplication === undefined) {
        throw new Error(
          "PCTEC_INGRESSA não encontrada — seed técnico (migration 0007) precisa já ter rodado neste banco."
        );
      }
      realPctecIngressaApplicationPublicId = realApplication.getPublicId().toString();

      const identityRepository = new MariaDbIdentityRepository(pool);
      const systemActor = ActorPublicId.system();
      const fixtureIdentity = Identity.create({
        type: "HUMAN",
        fullName: "Fixture de Integracao - Application Access Enforcement v0.6.x",
        email: `app-access-enforcement-integration-${Date.now()}@example.invalid`,
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

      const applicationAccessRepository = new MariaDbApplicationAccessRepository(pool);
      const fixtureApplicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
        identityPublicId: fixtureIdentityPublicId,
        applicationPublicId: realPctecIngressaApplicationPublicId,
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      fixtureApplicationAccess.pullDomainEvents();
      await applicationAccessRepository.insert(fixtureApplicationAccess);
      fixtureApplicationAccessPublicId = fixtureApplicationAccess.getPublicId().toString();

      const validateSessionService = new ValidateSessionService(
        new MariaDbSessionRepository(pool),
        new MariaDbIdentityRepository(pool)
      );
      const authorizeApplicationAccessService = new AuthorizeApplicationAccessService(
        new MariaDbApplicationRepository(pool),
        new MariaDbApplicationAccessRepository(pool)
      );
      const app = createApp({
        validateSessionService,
        authorizeApplicationAccessService,
        sessionCookieConfig: { secure: false }
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

      if (fixtureApplicationAccessPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
          fixtureApplicationAccessPublicId
        ]);
        await pool.execute(`DELETE FROM application_accesses WHERE public_id = ?`, [
          fixtureApplicationAccessPublicId
        ]);
      }
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

    it("GET /api/v1/admin/whoami com cookie de sessao fixture + ApplicationAccess ADMIN GRANTED -> 200, body correto", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/whoami`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` }
      });
      const body = (await res.json()) as {
        identity: { publicId: string };
        application: { code: string };
        access: { profile: string };
      };

      expect(res.status).toBe(200);
      expect(body.identity.publicId).toBe(fixtureIdentityPublicId);
      expect(body.application.code).toBe(PCTEC_INGRESSA_APPLICATION_CODE);
      expect(body.access.profile).toBe("ADMIN");
    });

    it("GET /api/v1/admin/whoami sem cookie -> 401 SESSION_INVALID (nunca 403)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/whoami`);
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status).toBe(401);
      expect(body.error.code).toBe("SESSION_INVALID");
    });

    it("GET /api/v1/me continua 200 para a mesma sessao, sem exigir ADMIN adicional", async () => {
      const res = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` }
      });
      expect(res.status).toBe(200);
    });
  }
);
