import type { Server } from "node:http";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../../app/config/env.js";
import { createPool } from "../../../../shared/database/Pool.js";
import { MariaDbIdentityRepository } from "../../infrastructure/persistence/MariaDbIdentityRepository.js";
import { createApp } from "../../../../app/http/createApp.js";
import { Identity } from "../../domain/Identity.js";
import { assertIntegrationSchemaReady, cleanupIntegrationTest, type IntegrationTestState } from "./integrationTestSupport.js";

/**
 * Teste de integração ponta a ponta: HTTP → Application → Domain →
 * Repository → MariaDB.
 *
 * CORREÇÃO DE BUG REAL (encontrado em DEV): a versão anterior deste
 * arquivo instanciava `MigrationRunner`/`applyPending` no `beforeAll`,
 * tentando criar/alterar schema — isso falha (corretamente!) com o
 * usuário runtime (`pctec_ingressa_dev_app`, só
 * SELECT/INSERT/UPDATE/DELETE, sem CREATE) e é um erro categórico deste
 * teste, não do código funcional da API: migration é responsabilidade
 * exclusiva do usuário `pctec_ingressa_dev_migrator`, executada
 * separadamente (`npm run migrate:up`), NUNCA como preparação implícita
 * de um teste de API.
 *
 * Este arquivo agora:
 * - NUNCA importa/usa `MigrationRunner`, `applyPending`, ou qualquer
 *   `CREATE`/`ALTER`/`DROP`;
 * - trata o schema (tabelas `identities`, `audit_events`) como
 *   PRÉ-CONDIÇÃO, verificada de forma read-only
 *   (`assertIntegrationSchemaReady`) — falha com mensagem clara se
 *   ausente, nunca tenta prepará-lo;
 * - usa exclusivamente as credenciais runtime (`DB_USER` de `loadEnv()`
 *   — em DEV, `pctec_ingressa_dev_app`; nunca hardcoded, nunca o usuário
 *   migrator);
 * - usa limpeza tolerante a setup parcial (`cleanupIntegrationTest`) —
 *   nunca assume que `server`/`pool` chegaram a existir.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. Nunca aponta automaticamente para
 * DEV — as variáveis `DB_*` vêm de `process.env`, preenchidas por quem
 * rodar o comando.
 */
const shouldRun = shouldRunIntegrationTests();

// Chave FIXA e reservada exclusivamente a este teste — nunca aleatória
// por execução, para que o cleanup (antes E depois do teste) consiga
// localizar e remover uma fixture residual de uma execução anterior que
// tenha falhado no meio, tornando a suíte recuperável. Nunca reutilizar
// este publicId para nenhuma outra fixture/fatia.
const FIXTURE_PUBLIC_ID = "a0000000-0000-4000-8000-000000000001";
const FIXTURE_EMAIL = "identity-query-integration@example.invalid";
const NONEXISTENT_PUBLIC_ID = "a0000000-0000-4000-8000-000000000099";

describe.skipIf(!shouldRun)("GET /api/v1/identities/:publicId (integração — usuário runtime, schema como pré-condição)", () => {
  const state: IntegrationTestState = {};

  beforeAll(async () => {
    const env = loadEnv();
    const pool: Pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER, // usuário runtime (DEV: pctec_ingressa_dev_app) — NUNCA o migrator
      password: env.DB_PASSWORD
    });
    state.pool = pool;

    // Pré-condição, verificada de forma read-only — nunca prepara schema aqui.
    await assertIntegrationSchemaReady(pool);

    // Remove eventual fixture residual de uma execução anterior que
    // tenha falhado antes do cleanup — pela chave FIXA e específica
    // deste teste, nunca um DELETE genérico.
    await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [FIXTURE_PUBLIC_ID]);

    const now = new Date();
    const fixture = Identity.reconstitute({
      internalId: 0, // ignorado pelo insert() — o banco atribui o id real via AUTO_INCREMENT
      publicId: FIXTURE_PUBLIC_ID,
      type: "HUMAN",
      fullName: "Fixture Identity Query Integration (dado fictício, nunca real)",
      email: FIXTURE_EMAIL,
      emailNormalized: FIXTURE_EMAIL.toLowerCase(),
      status: "PENDING",
      loginEnabled: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    const repository = new MariaDbIdentityRepository(pool);
    await repository.insert(fixture);
    state.fixturePublicId = FIXTURE_PUBLIC_ID;

    const app = createApp({ identityRepository: repository });
    const server: Server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    state.server = server;
  });

  afterAll(async () => {
    await cleanupIntegrationTest(state);
  });

  function baseUrl(): string {
    const address = state.server?.address();
    if (address === null || address === undefined || typeof address === "string") {
      throw new Error("servidor de teste de integração não está com um endereço válido");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it("encontra, via HTTP real, a fixture inserida de verdade no MariaDB (usuário runtime)", async () => {
    const res = await fetch(`${baseUrl()}/api/v1/identities/${FIXTURE_PUBLIC_ID}`);
    const body = (await res.json()) as { publicId: string; email: string };

    expect(res.status).toBe(200);
    expect(body.publicId).toBe(FIXTURE_PUBLIC_ID);
    expect(body.email).toBe(FIXTURE_EMAIL);
  });

  it("retorna 404 real (não fake) para um publicId válido mas inexistente no banco", async () => {
    const res = await fetch(`${baseUrl()}/api/v1/identities/${NONEXISTENT_PUBLIC_ID}`);
    expect(res.status).toBe(404);
  });
});
