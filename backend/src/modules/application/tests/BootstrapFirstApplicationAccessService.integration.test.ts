import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { MariaDbApplicationRepository } from "../infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { BootstrapFirstApplicationAccessService } from "../application/BootstrapFirstApplicationAccessService.js";
import { ApplicationAccessBootstrapAlreadyCompletedError } from "../application/errors/ApplicationAccessBootstrapErrors.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { ApplicationCode } from "../domain/value-objects/ApplicationCode.js";
import { PCTEC_INGRESSA_APPLICATION_CODE } from "../domain/value-objects/ApplicationCodes.js";

/**
 * Teste de integração real do bootstrap administrativo — prova a cadeia
 * completa: named lock real → transação real → INSERT ApplicationAccess
 * real → INSERT AuditEvent real → COMMIT → RELEASE_LOCK, contra um
 * MariaDB de verdade.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas (task v0.5.0, seção 21).
 *
 * Diferenças deliberadas em relação a
 * `BootstrapFirstIdentityService.integration.test.ts`:
 *
 * - **Não depende de `identities` vazia.** Diferente do bootstrap de
 *   Identity (cuja invariante é `COUNT(identities) = 0`), este teste
 *   pressupõe que a Identity fundacional real PODE já existir — e não a
 *   usa. Cria sua PRÓPRIA Identity fixture (via `Identity.create()` +
 *   `MariaDbIdentityRepository.insert()` diretamente, sem passar pelo
 *   serviço de bootstrap de Identity, que tem seu próprio guard de
 *   `COUNT=0` incompatível com um banco onde a fundacional já existe).
 * - **Nunca apaga a Identity fundacional real** — só cria e depois
 *   remove sua própria fixture, identificada pelo `public_id` gerado
 *   nesta execução, nunca por um critério amplo.
 * - **Nunca cria nem apaga a `Application PCTEC_INGRESSA`** — ela é
 *   seed técnico de migration (`0007`); este teste apenas verifica que
 *   já existe (precondição), nunca a insere/remove.
 * - **Cleanup específico ao `ApplicationAccess` criado pelo teste** —
 *   por `public_id`, nunca um `DELETE` genérico por `application_id`
 *   (que atingiria qualquer concessão real pré-existente).
 * - **Nunca executa migrations** — usa exclusivamente as credenciais
 *   runtime (`env.DB_USER`), nunca o usuário migrator; nenhum
 *   `CREATE`/`ALTER`/`DROP` é executado por este arquivo.
 *
 * Pré-condição desta suíte: a `Application PCTEC_INGRESSA` precisa
 * existir (seed da migration 0007) e não pode já haver um
 * `ApplicationAccess ADMIN` ativo para ela — do contrário, o guard
 * one-shot do próprio serviço bloquearia a primeira concessão do teste
 * também, o que é o comportamento correto do serviço, mas incompatível
 * com esta suíte rodar mais de uma vez sem limpeza adequada. Falha
 * rápido com mensagem clara se essa pré-condição não for atendida —
 * nunca tenta "resolver" o estado automaticamente.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)(
  "BootstrapFirstApplicationAccessService (integração — requer MariaDB real, Application PCTEC_INGRESSA já seedada)",
  () => {
    let pool: Pool;
    let fixtureIdentityPublicId: string | undefined;
    let createdApplicationAccessPublicId: string | undefined;

    beforeAll(async () => {
      const env = loadEnv();
      pool = createPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER, // usuário runtime — NUNCA migrator
        password: env.DB_PASSWORD
      });

      // Precondição 1: Application PCTEC_INGRESSA existe (seed 0007).
      const applicationRepository = new MariaDbApplicationRepository(pool);
      const application = await applicationRepository.findByCode(
        ApplicationCode.create(PCTEC_INGRESSA_APPLICATION_CODE)
      );
      if (application === undefined) {
        throw new Error(
          `Application ${PCTEC_INGRESSA_APPLICATION_CODE} não encontrada — a migration 0007 (seed) precisa ` +
            "ter sido aplicada antes de rodar esta suíte de integração."
        );
      }

      // Precondição 2: nenhum ApplicationAccess ADMIN já ativo para essa
      // Application — do contrário, o próprio guard one-shot do serviço
      // bloquearia o teste, e não queremos mascarar isso com limpeza
      // automática (poderia apagar uma concessão administrativa real).
      const applicationAccessRepository = new MariaDbApplicationAccessRepository(pool);
      const alreadyGranted = await applicationAccessRepository.existsGrantedByApplicationAndProfile(
        application.getPublicId().toString(),
        "ADMIN"
      );
      if (alreadyGranted) {
        throw new Error(
          `Já existe um ApplicationAccess ADMIN ativo para ${PCTEC_INGRESSA_APPLICATION_CODE}. ` +
            "Esta suíte não limpa esse estado automaticamente (poderia ser uma concessão real). " +
            "Rode em um banco de integração dedicado, sem concessões administrativas reais."
        );
      }

      // Cria a Identity fixture própria deste teste — NUNCA a Identity
      // fundacional real.
      const identityRepository = new MariaDbIdentityRepository(pool);
      const fixtureIdentity = Identity.create({
        type: "HUMAN",
        fullName: "Fixture de Integração — ApplicationAccess Bootstrap v0.5.0",
        email: `app-access-integration-${Date.now()}@example.invalid`,
        actor: ActorPublicId.system(),
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      await identityRepository.insert(fixtureIdentity);
      fixtureIdentityPublicId = fixtureIdentity.getPublicId().toString();
    });

    afterAll(async () => {
      if (createdApplicationAccessPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
          createdApplicationAccessPublicId
        ]);
        await pool.execute(`DELETE FROM application_accesses WHERE public_id = ?`, [
          createdApplicationAccessPublicId
        ]);
      }
      if (fixtureIdentityPublicId !== undefined) {
        // Remove exclusivamente a Identity fixture criada por este
        // teste — nunca a Identity fundacional real (identificada por
        // um public_id totalmente diferente, gerado nesta execução).
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureIdentityPublicId]);
        await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentityPublicId]);
      }
      await pool.end();
    });

    it("bootstrap cria 1 ApplicationAccess ADMIN para a Identity fixture; audit_events recebe 1 evento", async () => {
      const service = new BootstrapFirstApplicationAccessService(
        pool,
        (connection) => new MariaDbApplicationRepository(connection),
        (connection) => new MariaDbIdentityRepository(connection),
        (connection) => new MariaDbApplicationAccessRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection)
      );

      const result = await service.execute({ identityPublicId: fixtureIdentityPublicId! });
      createdApplicationAccessPublicId = result.applicationAccessPublicId;

      expect(result.accessProfile).toBe("ADMIN");

      const [accessRows] = await pool.execute(
        `SELECT granted_by_identity_public_id, status FROM application_accesses WHERE public_id = ?`,
        [result.applicationAccessPublicId]
      );
      const accessRow = (accessRows as Array<Record<string, unknown>>)[0];
      expect(accessRow?.["granted_by_identity_public_id"]).toBeNull();
      expect(accessRow?.["status"]).toBe("GRANTED");

      const [auditRows] = await pool.execute(
        `SELECT actor_public_id, event_type FROM audit_events WHERE aggregate_public_id = ?`,
        [result.applicationAccessPublicId]
      );
      const auditRow = (auditRows as Array<Record<string, unknown>>)[0];
      expect(auditRow?.["actor_public_id"]).toBe("BOOTSTRAP");
      expect(auditRow?.["event_type"]).toBe("application-access.granted");

      // A Identity fixture permanece intocada por esta operação.
      const [identityRows] = await pool.execute(`SELECT status, login_enabled FROM identities WHERE public_id = ?`, [
        fixtureIdentityPublicId
      ]);
      const identityRow = (identityRows as Array<Record<string, unknown>>)[0];
      expect(identityRow?.["status"]).toBe("PENDING");
      expect(Number(identityRow?.["login_enabled"])).toBe(0);
    });

    it("segunda tentativa (mesma ou outra Identity) bloqueia com ApplicationAccessBootstrapAlreadyCompletedError — banco real, não fake", async () => {
      const service = new BootstrapFirstApplicationAccessService(
        pool,
        (connection) => new MariaDbApplicationRepository(connection),
        (connection) => new MariaDbIdentityRepository(connection),
        (connection) => new MariaDbApplicationAccessRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection)
      );

      await expect(service.execute({ identityPublicId: fixtureIdentityPublicId! })).rejects.toThrow(
        ApplicationAccessBootstrapAlreadyCompletedError
      );
    });
  }
);
