import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { tabelaEstaVazia } from "../../../shared/types/integration-preconditions.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { MariaDbApplicationRepository } from "../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import { PCTEC_INGRESSA_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";
import { MariaDbCredentialRepository } from "../infrastructure/persistence/MariaDbCredentialRepository.js";
import { Argon2PasswordHasher } from "../infrastructure/hashing/Argon2PasswordHasher.js";
import { BootstrapFirstCredentialService } from "../application/BootstrapFirstCredentialService.js";
import { CredentialBootstrapAlreadyCompletedError } from "../application/errors/CredentialBootstrapErrors.js";
import { CredentialType } from "../domain/value-objects/CredentialType.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";

/**
 * Teste de integração real do bootstrap da primeira Credential — prova a
 * cadeia completa: named lock real → transação real → INSERT Credential
 * real → UPDATE Identity real (activate + enableLogin) → INSERT
 * AuditEvent × 3 real → COMMIT → RELEASE_LOCK, contra um MariaDB de
 * verdade.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, mesmo padrão de
 * `BootstrapFirstApplicationAccessService.integration.test.ts` (v0.5.0).
 *
 * Diferenças deliberadas:
 *
 * - **Cria sua PRÓPRIA Identity fixture** (`PENDING`, `loginEnabled =
 *   false`) via `Identity.create()` + `MariaDbIdentityRepository.insert()`
 *   diretamente — NUNCA usa a Identity fundacional real (que já pode
 *   estar `ACTIVE`/`loginEnabled = true` em um DEV real onde a Fase C já
 *   foi executada para ela, o que quebraria as asserções de estado
 *   inicial deste teste).
 * - **Confirma explicitamente, antes de tudo, que não existe nenhuma
 *   `Credential LOCAL_PASSWORD`** na base de integração — pré-condição
 *   que precisa ser verdadeira para o guard global se comportar como
 *   esperado; se já existir alguma (de uma execução anterior mal limpa,
 *   ou de um bootstrap real), este teste falha rápido com mensagem
 *   clara, em vez de mascarar o problema.
 * - **Cleanup específico**, por `public_id` — nunca `DELETE` genérico,
 *   nunca a Identity fundacional real, nunca uma migration automática
 *   (usa exclusivamente `env.DB_USER`, o usuário runtime, nunca o
 *   migrator).
 */
const CONFIG_DA_SONDA = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? ""
};

/**
 * Mesmo caso do bootstrap de Identity: só faz sentido contra schema sem
 * nenhuma Credential. Com uma já existente, o guard global do serviço
 * recusa — o que é o comportamento correto, e não um defeito a reportar.
 */
const shouldRun = shouldRunIntegrationTests() && (await tabelaEstaVazia(CONFIG_DA_SONDA, "credentials"));

describe.skipIf(!shouldRun)(
  "BootstrapFirstCredentialService (integração — requer MariaDB real, nenhuma Credential LOCAL_PASSWORD pré-existente)",
  () => {
    let pool: Pool;
    let fixtureIdentityPublicId: string | undefined;
  let fixtureAccessPublicId: string | undefined;
    let createdCredentialPublicId: string | undefined;

    beforeAll(async () => {
      const env = loadEnv();
      pool = createPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER, // usuário runtime — NUNCA migrator
        password: env.DB_PASSWORD
      });

      // Precondição: nenhuma Credential LOCAL_PASSWORD já existe — do
      // contrário, o guard global do próprio serviço bloquearia o teste,
      // e não queremos mascarar isso com limpeza automática (poderia
      // apagar uma credencial real).
      const credentialRepository = new MariaDbCredentialRepository(pool);
      const alreadyExists = await credentialRepository.existsAnyByType(CredentialType.localPassword());
      if (alreadyExists) {
        throw new Error(
          "Já existe uma Credential LOCAL_PASSWORD na base de integração. " +
            "Esta suíte não limpa esse estado automaticamente (poderia ser uma credencial real). " +
            "Rode em um banco de integração dedicado, sem bootstrap de credencial já executado."
        );
      }

      // Cria a Identity fixture própria deste teste — NUNCA a Identity
      // fundacional real.
      const identityRepository = new MariaDbIdentityRepository(pool);
      const fixtureIdentity = Identity.create({
        type: "HUMAN",
        fullName: "Fixture de Integração — Credential Bootstrap v0.5.x",
        email: `credential-integration-${Date.now()}@example.invalid`,
        actor: ActorPublicId.system(),
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      await identityRepository.insert(fixtureIdentity);
      fixtureIdentityPublicId = fixtureIdentity.getPublicId().toString();

      // v1.0 (ADR-027, emenda): a primeira Credential só pode ser criada
      // para a Identity que possui o ADMIN fundacional de PCTEC_INGRESSA.
      // A fixture precisa, portanto, receber esse acesso — não é um
      // detalhe do teste, é a pré-condição que o serviço passou a exigir.
      const applicationRepository = new MariaDbApplicationRepository(pool);
      const applicationAccessRepository = new MariaDbApplicationAccessRepository(pool);
      const ingressaApplication = await applicationRepository.findByCode(
        ApplicationCode.create(PCTEC_INGRESSA_APPLICATION_CODE)
      );
      if (ingressaApplication === undefined) {
        throw new Error("Seed 0007 ausente no banco de teste — PCTEC_INGRESSA precisa existir.");
      }
      const fixtureAccess = ApplicationAccess.grantFoundationalAdminAccess({
        identityPublicId: fixtureIdentityPublicId,
        applicationPublicId: ingressaApplication.getPublicId().toString(),
        correlationId: "00000000-0000-0000-0000-000000000000"
      });
      await applicationAccessRepository.insert(fixtureAccess);
      fixtureAccessPublicId = fixtureAccess.getPublicId().toString();
    });

    afterAll(async () => {
      if (createdCredentialPublicId !== undefined) {
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [createdCredentialPublicId]);
        await pool.execute(`DELETE FROM credentials WHERE public_id = ?`, [createdCredentialPublicId]);
      }
      if (fixtureAccessPublicId !== undefined) {
        // Só a linha criada por esta fixture — nunca um DELETE amplo em
        // application_accesses.
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureAccessPublicId]);
        await pool.execute(`DELETE FROM application_accesses WHERE public_id = ?`, [fixtureAccessPublicId]);
      }
      if (fixtureIdentityPublicId !== undefined) {
        // Remove exclusivamente a Identity fixture criada por este
        // teste — nunca a Identity fundacional real.
        await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureIdentityPublicId]);
        await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentityPublicId]);
      }
      await pool.end();
    });

    it("bootstrap cria 1 Credential ACTIVE, ativa a Identity fixture, habilita login; 3 AuditEvents gravados", async () => {
      const service = new BootstrapFirstCredentialService(
        pool,
        (connection) => new MariaDbCredentialRepository(connection),
        (connection) => new MariaDbIdentityRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection),
        new Argon2PasswordHasher(),
        (connection) => new MariaDbApplicationRepository(connection),
        (connection) => new MariaDbApplicationAccessRepository(connection)
      );

      const result = await service.execute({
        identityPublicId: fixtureIdentityPublicId!,
        plainPassword: "senha-de-integracao-123456",
        plainPasswordConfirmation: "senha-de-integracao-123456"
      });
      createdCredentialPublicId = result.credentialPublicId;

      expect(result.credentialType).toBe("LOCAL_PASSWORD");
      expect(result.identityStatus).toBe("ACTIVE");
      expect(result.loginEnabled).toBe(true);

      const [credentialRows] = await pool.execute(
        `SELECT status, password_hash FROM credentials WHERE public_id = ?`,
        [result.credentialPublicId]
      );
      const credentialRow = (credentialRows as Array<Record<string, unknown>>)[0];
      expect(credentialRow?.["status"]).toBe("ACTIVE");
      expect(String(credentialRow?.["password_hash"])).toMatch(/^\$argon2id\$/);
      expect(String(credentialRow?.["password_hash"])).not.toContain("senha-de-integracao-123456");

      const [identityRows] = await pool.execute(`SELECT status, login_enabled, version FROM identities WHERE public_id = ?`, [
        fixtureIdentityPublicId
      ]);
      const identityRow = (identityRows as Array<Record<string, unknown>>)[0];
      expect(identityRow?.["status"]).toBe("ACTIVE");
      expect(Number(identityRow?.["login_enabled"])).toBe(1);
      expect(Number(identityRow?.["version"])).toBe(3); // 1 (criação) + 1 (activate) + 1 (enableLogin)

      const [auditRows] = await pool.execute(
        `SELECT event_type, actor_public_id FROM audit_events WHERE aggregate_public_id IN (?, ?) ORDER BY event_type`,
        [result.credentialPublicId, fixtureIdentityPublicId]
      );
      const auditEvents = auditRows as Array<Record<string, unknown>>;
      expect(auditEvents).toHaveLength(3);
      const eventTypes = auditEvents.map((row) => row["event_type"]).sort();
      expect(eventTypes).toEqual(["credential.created", "identity.activated", "identity.login-enabled"]);
      for (const row of auditEvents) {
        expect(row["actor_public_id"]).toBe("BOOTSTRAP");
      }
    });

    it("segunda tentativa (mesma ou outra Identity) bloqueia com CredentialBootstrapAlreadyCompletedError — banco real, não fake", async () => {
      const service = new BootstrapFirstCredentialService(
        pool,
        (connection) => new MariaDbCredentialRepository(connection),
        (connection) => new MariaDbIdentityRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection),
        new Argon2PasswordHasher(),
        (connection) => new MariaDbApplicationRepository(connection),
        (connection) => new MariaDbApplicationAccessRepository(connection)
      );

      await expect(
        service.execute({
          identityPublicId: fixtureIdentityPublicId!,
          plainPassword: "outra-senha-123456789",
          plainPasswordConfirmation: "outra-senha-123456789"
        })
      ).rejects.toThrow(CredentialBootstrapAlreadyCompletedError);
    });
  }
);
