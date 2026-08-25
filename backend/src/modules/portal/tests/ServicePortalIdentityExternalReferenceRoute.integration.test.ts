/**
 * Teste de integração real da rota service-to-service
 * `GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId`
 * — P1B.0 Fatia 4 (v0.7.x).
 *
 * NÃO roda como parte de `npm test`. Só via `RUN_INTEGRATION_TESTS=true`.
 * **NÃO EXECUTADO nesta entrega** — preparado apenas.
 *
 * Fixtures sintéticas: legacyId=999997 (nunca colide com dado real).
 * NÃO usa portal_acesso.id=33 nem o Identity real de arlei.pizarro.
 * NÃO toca organization_external_references, pctec-portal nem migration
 * 0016 (esta só pode ser aplicada quando autorizado pelo PO).
 */
import type { Pool } from "mysql2/promise";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureRunId } from "../../../shared/types/integration-database-guard.js";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { createApp } from "../../../app/http/createApp.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityExternalReferenceRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { GetActiveIdentityExternalReferenceService } from "../../identity/application/GetActiveIdentityExternalReferenceService.js";
import { CreateIdentityExternalReferenceService } from "../../identity/application/CreateIdentityExternalReferenceService.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../http/requireServiceCredential.js";

const shouldRun = shouldRunIntegrationTests();
const SYNTHETIC_LEGACY_ID = 999997;
/**
 * E-mail único por execução: fixo, ele sobrevivia ao teardown parcial e
 * a rodada seguinte colidia na UNIQUE KEY de e-mail.
 */
const EMAIL_SINTETICO = `synthetic.p1b0.${fixtureRunId()}@example.invalid`;
const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";
const TEST_SERVICE_CREDENTIAL = "integracao-test-p1b0-fatia4-segredo";

describe.skipIf(!shouldRun)(
  "GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId (integração MariaDB real)",
  () => {
    let pool: Pool;
    let server: Server;
    let baseUrl: string;
    let syntheticIdentityPublicId: string;

    beforeAll(async () => {
      const env = loadEnv();
      pool = createPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD
      });

      await limparFixtures();

      // Cria Identity sintética como FK para a referência
      const unitOfWork = new MariaDbUnitOfWork(pool);
      const identity = Identity.create({
        type: "HUMAN",
        fullName: "Synthetic Integration Test P1B0 Fatia4",
        email: EMAIL_SINTETICO,
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      const connection = await (pool as ReturnType<typeof createPool>).getConnection();
      try {
        await new MariaDbIdentityRepository(connection).insert(identity);
      } finally {
        connection.release();
      }
      syntheticIdentityPublicId = identity.getPublicId().toString();

      // Cria o vínculo via CreateIdentityExternalReferenceService
      const createService = new CreateIdentityExternalReferenceService(
        unitOfWork,
        (conn) => new MariaDbIdentityRepository(conn),
        (conn) => new MariaDbIdentityExternalReferenceRepository(conn),
        (conn) => new MariaDbAuditEventRepository(conn)
      );
      await createService.execute({
        identityPublicId: syntheticIdentityPublicId,
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: SYNTHETIC_LEGACY_ID,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: syntheticIdentityPublicId
      });

      // Sobe o servidor com o serviço real
      const getActiveService = new GetActiveIdentityExternalReferenceService(
        new MariaDbIdentityExternalReferenceRepository(pool as ReturnType<typeof createPool>)
      );
      const app = createApp({
        getActiveIdentityExternalReferenceService: getActiveService,
        serviceCredential: TEST_SERVICE_CREDENTIAL
      });
      server = app.listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Endereço inesperado");
      baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
    });

    // Teardown em `finally`: o servidor precisa fechar mesmo que a
    // limpeza falhe, e a limpeza precisa acontecer mesmo que o
    // fechamento falhe — senão a Identity sintética fica no banco, que
    // foi como resíduo de teste acabou aparecendo na tela do DEV.
    afterAll(async () => {
      try {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      } finally {
        try {
          await limparFixtures();
        } finally {
          await pool.end();
        }
      }
    });

    /** Remove a referência E a Identity criada como FK dela. */
    async function limparFixtures(): Promise<void> {
      await pool.execute(`DELETE FROM identity_external_references WHERE legacy_id = ?`, [SYNTHETIC_LEGACY_ID]);
      await pool.execute(`DELETE FROM identities WHERE email_normalized = ?`, [EMAIL_SINTETICO]);
    }

    it("resolve legacyId=999997 → identityPublicId correto via banco real", async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/${SYNTHETIC_LEGACY_ID}`,
        { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: TEST_SERVICE_CREDENTIAL } }
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body).toEqual({ identityPublicId: syntheticIdentityPublicId });
    });

    it("legacyId inexistente → 404 IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND", async () => {
      const res = await fetch(
        `${baseUrl}/api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/999998`,
        { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: TEST_SERVICE_CREDENTIAL } }
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(404);
      expect((body["error"] as Record<string, unknown>)["code"]).toBe("IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND");
    });
  }
);
