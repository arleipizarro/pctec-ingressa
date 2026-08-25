import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { podeExecutarDdl } from "../../../shared/types/integration-preconditions.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { loadMigrationDefinitions } from "../../../shared/database/loadMigrationDefinitions.js";
import { MigrationRunner } from "../../../shared/database/MigrationRunner.js";
import { MariaDbIdentityRepository } from "../infrastructure/persistence/MariaDbIdentityRepository.js";
import { Identity } from "../domain/Identity.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import type { Pool } from "mysql2/promise";

/**
 * Teste de integração real contra MariaDB.
 *
 * NÃO roda como parte de `npm test`. Só executa via
 * `npm run test:integration`, e mesmo assim apenas se
 * RUN_INTEGRATION_TESTS=true estiver definido — do contrário, todo o
 * describe é pulado (`describe.skipIf`).
 *
 * Nunca aponta automaticamente para o ambiente DEV: as variáveis DB_* são
 * lidas de `process.env` (ver `.env.example`), e cabe a quem rodar
 * explicitamente apontá-las para um MariaDB local/descartável — este
 * arquivo nunca embute nenhuma credencial.
 *
 * Aplica as migrations (via MigrationRunner) contra o banco de destino
 * antes de testar o repository, e reverte com os arquivos `.down.sql` ao
 * final (best-effort).
 */
const CONFIG_DA_SONDA = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? ""
};

/**
 * Esta suíte aplica migrations por conta própria, então precisa de DDL.
 * O principal de runtime não tem — e isso é uma propriedade do ambiente,
 * não um defeito do código.
 */
const shouldRun = shouldRunIntegrationTests() && (await podeExecutarDdl(CONFIG_DA_SONDA));

describe.skipIf(!shouldRun)("MariaDbIdentityRepository (integração — requer MariaDB real)", () => {
  let pool: Pool;

  beforeAll(async () => {
    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });
    const runner = new MigrationRunner(pool);
    await runner.applyPending(loadMigrationDefinitions());
  });

  afterAll(async () => {
    const migrations = loadMigrationDefinitions();
    for (const migration of [...migrations].reverse()) {
      // eslint-disable-next-line no-await-in-loop
      await pool.execute(migration.down);
    }
    await pool.end();
  });

  it("insere e recupera uma Identity real via INSERT/SELECT no MariaDB", async () => {
    const repository = new MariaDbIdentityRepository(pool);
    const identity = Identity.create({
      type: "HUMAN",
      fullName: "Pessoa Integração",
      email: `integracao-${Date.now()}@example.com`,
      actor: ActorPublicId.system(),
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000099"
    });

    await repository.insert(identity);
    const found = await repository.findByPublicId(identity.getPublicId());

    expect(found?.getPublicId().toString()).toBe(identity.getPublicId().toString());
  });
});
