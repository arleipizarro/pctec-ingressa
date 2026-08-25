import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../../shared/types/integration-test-guard.js";
import { tabelaEstaVazia } from "../../../../shared/types/integration-preconditions.js";
import { loadEnv } from "../../../../app/config/env.js";
import { createPool } from "../../../../shared/database/Pool.js";
import { MariaDbIdentityRepository } from "../../infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { BootstrapFirstIdentityService } from "../BootstrapFirstIdentityService.js";
import { BootstrapAlreadyCompletedError } from "../errors/BootstrapErrors.js";

/**
 * Teste de integração real do bootstrap — HTTP não se aplica aqui (é
 * CLI/serviço puro), mas prova a cadeia completa: named lock real →
 * transação real → INSERT Identity real → INSERT AuditEvent real →
 * COMMIT → RELEASE_LOCK, contra um MariaDB de verdade.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, conforme instruído (seção 18 do prompt de
 * implementação).
 *
 * Mesmo padrão de precondição/limpeza já estabelecido em
 * `identityRoutes.integration.test.ts`: NUNCA usa `MigrationRunner`,
 * NUNCA executa `CREATE`/`ALTER`/`DROP`, usa exclusivamente as
 * credenciais runtime (`env.DB_USER`), e a limpeza é SEMPRE por chave
 * específica — nunca um `DELETE` genérico.
 *
 * Pré-condição desta suíte especificamente: o banco de teste precisa
 * começar com `COUNT(identities) = 0` (não apenas as tabelas existirem)
 * — diferente do teste de leitura da v0.5.0 Slice 1, o bootstrap É a
 * primeira escrita possível em `identities`. Por isso, ao final, a
 * limpeza remove a fixture criada, restaurando o banco a
 * `COUNT(identities) = 0` para a suíte poder ser executada de novo.
 */
const CONFIG_DA_SONDA = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? ""
};

/**
 * Esta suíte exige schema PRISTINO (`COUNT(identities) = 0`): ela prova o
 * comportamento do primeiro bootstrap. Compartilhar o schema com outras
 * suítes a faria falhar por contaminação, não por defeito — então pula
 * com motivo explícito quando o schema já tem gente.
 */
const shouldRun = shouldRunIntegrationTests() && (await tabelaEstaVazia(CONFIG_DA_SONDA, "identities"));

describe.skipIf(!shouldRun)("BootstrapFirstIdentityService (integração — requer MariaDB real, banco começando vazio)", () => {
  let pool: Pool;
  let createdPublicId: string | undefined;

  beforeAll(async () => {
    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER, // usuário runtime — NUNCA migrator
      password: env.DB_PASSWORD
    });

    const [rows] = await pool.execute(`SELECT COUNT(*) AS total FROM identities`);
    const total = Number((rows as Array<Record<string, unknown>>)[0]?.["total"] ?? 0);
    if (total > 0) {
      throw new Error(
        "Integration schema is not empty; this suite requires COUNT(identities) = 0 to start. " +
          "Nunca limpa a tabela automaticamente (evita apagar dado real por engano)."
      );
    }
  });

  afterAll(async () => {
    if (createdPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [createdPublicId]);
      await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [createdPublicId]);
    }
    await pool.end();
  });

  it("banco começa com 0 identities; bootstrap cria 1; audit_events recebe 1", async () => {
    const service = new BootstrapFirstIdentityService(
      pool,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    const result = await service.execute({
      fullName: "Fixture de Integração — Bootstrap v0.5.0",
      email: `bootstrap-integration-${Date.now()}@example.invalid`
    });
    createdPublicId = result.publicId;

    expect(result.status).toBe("PENDING");
    expect(result.loginEnabled).toBe(false);

    const [identityRows] = await pool.execute(`SELECT created_by_identity_public_id FROM identities WHERE public_id = ?`, [
      result.publicId
    ]);
    expect((identityRows as Array<Record<string, unknown>>)[0]?.["created_by_identity_public_id"]).toBeNull();

    const [auditRows] = await pool.execute(
      `SELECT actor_public_id, event_type FROM audit_events WHERE aggregate_public_id = ?`,
      [result.publicId]
    );
    const auditRow = (auditRows as Array<Record<string, unknown>>)[0];
    expect(auditRow?.["actor_public_id"]).toBe("BOOTSTRAP");
    expect(auditRow?.["event_type"]).toBe("identity.created");
  });

  it("segunda execução bloqueia com BootstrapAlreadyCompletedError — banco real, não fake", async () => {
    const service = new BootstrapFirstIdentityService(
      pool,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    await expect(
      service.execute({ fullName: "Segunda Tentativa", email: "segunda@example.invalid" })
    ).rejects.toThrow(BootstrapAlreadyCompletedError);
  });
});
