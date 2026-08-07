import type { Server } from "node:http";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../../app/config/env.js";
import { createPool } from "../../../../shared/database/Pool.js";
import { loadMigrationDefinitions } from "../../../../shared/database/loadMigrationDefinitions.js";
import { MigrationRunner } from "../../../../shared/database/MigrationRunner.js";
import { MariaDbIdentityRepository } from "../../infrastructure/persistence/MariaDbIdentityRepository.js";
import { createApp } from "../../../../app/http/createApp.js";
import { Identity } from "../../domain/Identity.js";
import { ActorPublicId } from "../../domain/value-objects/ActorPublicId.js";

/**
 * Teste de integração ponta a ponta REAL: HTTP → Application →
 * Domain → Repository → MariaDB.
 *
 * NÃO roda como parte de `npm test`. Só executa via
 * `npm run test:integration`, e mesmo assim apenas se
 * RUN_INTEGRATION_TESTS=true estiver definido (`describe.skipIf`).
 * Nunca aponta automaticamente para DEV — as variáveis DB_* vêm de
 * `process.env`, preenchidas por quem rodar o comando.
 *
 * PREPARADO NESTA ENTREGA, MAS NÃO EXECUTADO — conforme instrução da
 * v0.5.0 Slice 1: nenhuma fixture foi inserida no MariaDB DEV real.
 *
 * Desvio deliberado do padrão "insere em transação, faz rollback ao
 * final": um teste que sobe o `createApp()` completo passa pela camada
 * HTTP até o `Pool` — a leitura (`GET`) abre sua PRÓPRIA conexão do
 * pool, diferente da conexão que faria o INSERT dentro de uma
 * transação ainda não commitada. Sob REPEATABLE READ (padrão do
 * InnoDB), a conexão de leitura nunca enxergaria uma linha inserida e
 * ainda não commitada em outra conexão — então "inserir em transação e
 * nunca commitar" simplesmente não funcionaria para provar o fluxo
 * ponta a ponta de verdade. Em vez disso: insere a fixture com um
 * `INSERT` normal (commitado), roda os testes, e remove a fixture
 * explicitamente no `afterAll` (mesmo padrão de limpeza já usado em
 * `MariaDbIdentityRepository.integration.test.ts`).
 *
 * Nenhum CPF real. E-mail fictício, deliberadamente inválido como
 * domínio real (`@example.invalid`, RFC 2606), como instruído.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("GET /api/v1/identities/:publicId (integração — requer MariaDB real, ponta a ponta)", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;
  let fixtureIdentity: Identity;

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

    const repository = new MariaDbIdentityRepository(pool);
    fixtureIdentity = Identity.create({
      type: "HUMAN",
      fullName: "Fixture de Integração v0.5.0",
      email: `identity-test-${Date.now()}@example.invalid`,
      actor: ActorPublicId.system(),
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000098"
    });
    await repository.insert(fixtureIdentity);

    const app = createApp({ identityRepository: repository });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado do servidor de teste de integração");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    // Limpeza explícita da fixture — nunca deixa dado de teste no banco.
    await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentity.getPublicId().toString()]);

    const migrations = loadMigrationDefinitions();
    for (const migration of [...migrations].reverse()) {
      // eslint-disable-next-line no-await-in-loop
      await pool.execute(migration.down);
    }
    await pool.end();
  });

  it("encontra, via HTTP real, a fixture inserida de verdade no MariaDB", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identities/${fixtureIdentity.getPublicId().toString()}`);
    const body = (await res.json()) as { publicId: string; email: string };

    expect(res.status).toBe(200);
    expect(body.publicId).toBe(fixtureIdentity.getPublicId().toString());
    expect(body.email).toContain("@example.invalid");
  });

  it("retorna 404 real (não fake) para um publicId válido mas inexistente no banco", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identities/22222222-2222-2222-2222-222222222222`);
    expect(res.status).toBe(404);
  });
});
