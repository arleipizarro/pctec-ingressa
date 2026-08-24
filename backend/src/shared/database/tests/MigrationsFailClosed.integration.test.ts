/**
 * Integração: as migrations de importação são fail-closed contra tabela
 * homônima pré-existente — MariaDB real.
 *
 * ATENÇÃO: exige `RUN_INTEGRATION_TESTS=true` e credenciais com
 * permissão de CREATE/DROP DATABASE. Excluído de `npm test`.
 *
 * Este arquivo NUNCA toca o banco de DEV nem qualquer banco pré-
 * existente: cada cenário cria o SEU PRÓPRIO banco descartável
 * (`pctec_ingressa_failclosed_<pid>_<cenário>`), roda inteiramente
 * dentro dele e o derruba no `finally` — inclusive quando o cenário
 * falha. O `afterAll` faz uma varredura final por qualquer banco com o
 * prefixo desta suíte e comprova que nenhum sobreviveu.
 *
 * O que está sendo fixado aqui é a correção do preflight de ativação
 * (v0.8.x): 0020 e 0021 perderam o `CREATE TABLE IF NOT EXISTS`. Com a
 * cláusula, uma tabela homônima divergente virava NO-OP silencioso e a
 * migration era registrada em `schema_migrations` mesmo assim — schema
 * divergente sem sinal algum. Sem ela, o `up` aborta com
 * ER_TABLE_EXISTS_ERROR (errno 1050) e nada é registrado.
 *
 * Este é um teste de BANCO, não de string: a asserção equivalente sobre
 * o texto do SQL vive em `importFoundationMigrations.test.ts`. As duas
 * são necessárias — a de string impede a regressão no diff, esta prova
 * que o MariaDB de fato se comporta como esperado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool as createMysqlPool, type Pool } from "mysql2/promise";
import { shouldRunIntegrationTests } from "../../types/integration-test-guard.js";
import { loadMigrationDefinitions } from "../loadMigrationDefinitions.js";
import { MigrationExecutionError, MigrationRunner, type MigrationDefinition } from "../MigrationRunner.js";

const ADMIN_CONFIG = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "root",
  password: process.env["DB_PASSWORD"] ?? "",
  charset: "utf8mb4",
  connectionLimit: 4,
  multipleStatements: false
};

/** Prefixo exclusivo desta suíte — a varredura de limpeza final depende dele. */
const PREFIXO = `pctec_ingressa_failclosed_${process.pid}`;

const ID_0019 = "0019_add_match_method_created_from_source";
const ID_0020 = "0020_create_import_batches";
const ID_0021 = "0021_create_import_batch_items";

const TODAS = loadMigrationDefinitions();

/**
 * Prefixo de `TODAS` terminando na migration indicada (inclusive).
 * Calculado por id, nunca por índice literal, para não quebrar
 * silenciosamente quando uma migration nova for acrescentada.
 */
function ate(id: string): readonly MigrationDefinition[] {
  const indice = TODAS.findIndex((m) => m.id === id);
  if (indice < 0) {
    throw new Error(`migration "${id}" não encontrada`);
  }
  return TODAS.slice(0, indice + 1);
}

async function idsAplicados(pool: Pool): Promise<string[]> {
  const [linhas] = await pool.query(`SELECT id FROM schema_migrations ORDER BY id`);
  return (linhas as Array<{ id: string }>).map((linha) => linha.id);
}

async function tabelaExiste(pool: Pool, tabela: string): Promise<boolean> {
  const [linhas] = await pool.query(
    `SELECT COUNT(*) AS total FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [tabela]
  );
  return (linhas as Array<{ total: number }>)[0]?.total === 1;
}

async function colunasDe(pool: Pool, tabela: string): Promise<string[]> {
  const [linhas] = await pool.query(
    `SELECT column_name AS nome FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position`,
    [tabela]
  );
  return (linhas as Array<{ nome: string }>).map((linha) => linha.nome);
}

const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("migrations de importação — fail-closed contra tabela homônima", () => {
  let admin: Pool;

  beforeAll(() => {
    admin = createMysqlPool(ADMIN_CONFIG);
  });

  afterAll(async () => {
    // Varredura final: nenhum banco desta suíte pode sobreviver, nem os
    // de um cenário que tenha falhado no meio.
    const [linhas] = await admin.query(
      `SELECT schema_name AS nome FROM information_schema.schemata WHERE schema_name LIKE ?`,
      [`${PREFIXO}%`]
    );
    const remanescentes = (linhas as Array<{ nome: string }>).map((linha) => linha.nome);
    for (const nome of remanescentes) {
      await admin.query(`DROP DATABASE IF EXISTS \`${nome}\``);
    }
    const [conferencia] = await admin.query(
      `SELECT COUNT(*) AS total FROM information_schema.schemata WHERE schema_name LIKE ?`,
      [`${PREFIXO}%`]
    );
    const total = (conferencia as Array<{ total: number }>)[0]?.total ?? -1;
    await admin.end();
    expect(remanescentes, "cenário deixou banco isolado para trás").toEqual([]);
    expect(total, "limpeza final não removeu todos os bancos desta suíte").toBe(0);
  });

  /**
   * Cria um banco descartável, entrega um Pool ligado a ele e o derruba
   * no `finally` — mesmo quando `corpo` lança.
   */
  async function comBancoIsolado(cenario: string, corpo: (pool: Pool) => Promise<void>): Promise<void> {
    // O nome nunca vem de fora: é montado a partir do PID e de um
    // literal do próprio teste, e ainda assim é validado antes de entrar
    // numa instrução DDL (que não aceita placeholder para identificador).
    const nome = `${PREFIXO}_${cenario}`;
    expect(nome).toMatch(/^[a-z0-9_]+$/);

    await admin.query(`DROP DATABASE IF EXISTS \`${nome}\``);
    await admin.query(`CREATE DATABASE \`${nome}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`);
    const pool = createMysqlPool({ ...ADMIN_CONFIG, database: nome });
    try {
      await corpo(pool);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${nome}\``);
    }
  }

  it(
    "banco limpo: 0020 e 0021 aplicam normalmente, com FK e chaves declaradas",
    async () => {
      await comBancoIsolado("limpo", async (pool) => {
        const runner = new MigrationRunner(pool);
        const relatorio = await runner.applyPending(TODAS);

        expect(relatorio.appliedIds).toEqual(TODAS.map((m) => m.id));
        expect(relatorio.appliedIds).toHaveLength(21);
        expect(await idsAplicados(pool)).toContain(ID_0020);
        expect(await idsAplicados(pool)).toContain(ID_0021);

        expect(await tabelaExiste(pool, "import_batches")).toBe(true);
        expect(await tabelaExiste(pool, "import_batch_items")).toBe(true);

        // Estrutura real, não só existência: se o CREATE tivesse virado
        // no-op sobre outra tabela, estas asserções cairiam.
        expect(await colunasDe(pool, "import_batches")).toContain("scope_fingerprint");
        expect(await colunasDe(pool, "import_batch_items")).toContain("reason_code");

        const [fks] = await pool.query(
          `SELECT constraint_name AS nome FROM information_schema.referential_constraints
            WHERE constraint_schema = DATABASE()`
        );
        expect((fks as Array<{ nome: string }>).map((f) => f.nome)).toContain("fk_ibi_batch");

        const [engines] = await pool.query(
          `SELECT engine, table_collation AS collation FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name IN ('import_batches','import_batch_items')`
        );
        for (const linha of engines as Array<{ engine: string; collation: string }>) {
          expect(linha.engine).toBe("InnoDB");
          expect(linha.collation).toBe("utf8mb4_unicode_520_ci");
        }
      });
    },
    60_000
  );

  it(
    "import_batches homônima pré-existente: 0020 falha e NÃO é registrada como aplicada",
    async () => {
      await comBancoIsolado("batches_homonima", async (pool) => {
        const runner = new MigrationRunner(pool);
        await runner.applyPending(ate(ID_0019));
        expect(await idsAplicados(pool)).not.toContain(ID_0020);

        // Tabela homônima DIVERGENTE — nada a ver com o contrato de 0020.
        await pool.query(
          `CREATE TABLE import_batches (
             coluna_intrusa BIGINT UNSIGNED NOT NULL,
             PRIMARY KEY (coluna_intrusa)
           ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_520_ci`
        );

        const erro = await runner.applyPending(TODAS).then(
          () => null,
          (causa: unknown) => causa
        );

        expect(erro, "0020 deveria ter abortado — CREATE TABLE virou no-op?").toBeInstanceOf(
          MigrationExecutionError
        );
        const execucao = erro as MigrationExecutionError;
        expect(execucao.migrationId).toBe(ID_0020);
        expect(execucao.phase).toBe("up");
        const causa = execucao.cause as { errno?: number; code?: string };
        expect(causa.errno === 1050 || causa.code === "ER_TABLE_EXISTS_ERROR").toBe(true);

        // Nada registrado: nem 0020, nem a seguinte.
        const registradas = await idsAplicados(pool);
        expect(registradas).not.toContain(ID_0020);
        expect(registradas).not.toContain(ID_0021);
        expect(registradas).toContain(ID_0019);

        // A estrutura divergente permanece EXATAMENTE como estava — não
        // foi alterada, mesclada nem silenciosamente aceita.
        expect(await colunasDe(pool, "import_batches")).toEqual(["coluna_intrusa"]);
        expect(await tabelaExiste(pool, "import_batch_items")).toBe(false);
      });
    },
    60_000
  );

  it(
    "import_batch_items homônima pré-existente: 0021 falha e NÃO é registrada como aplicada",
    async () => {
      await comBancoIsolado("items_homonima", async (pool) => {
        const runner = new MigrationRunner(pool);
        await runner.applyPending(ate(ID_0020));
        expect(await idsAplicados(pool)).toContain(ID_0020);
        expect(await idsAplicados(pool)).not.toContain(ID_0021);

        await pool.query(
          `CREATE TABLE import_batch_items (
             coluna_intrusa BIGINT UNSIGNED NOT NULL,
             PRIMARY KEY (coluna_intrusa)
           ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_520_ci`
        );

        const erro = await runner.applyPending(TODAS).then(
          () => null,
          (causa: unknown) => causa
        );

        expect(erro, "0021 deveria ter abortado — CREATE TABLE virou no-op?").toBeInstanceOf(
          MigrationExecutionError
        );
        const execucao = erro as MigrationExecutionError;
        expect(execucao.migrationId).toBe(ID_0021);
        expect(execucao.phase).toBe("up");
        const causa = execucao.cause as { errno?: number; code?: string };
        expect(causa.errno === 1050 || causa.code === "ER_TABLE_EXISTS_ERROR").toBe(true);

        const registradas = await idsAplicados(pool);
        expect(registradas).not.toContain(ID_0021);
        expect(registradas).toContain(ID_0020);

        expect(await colunasDe(pool, "import_batch_items")).toEqual(["coluna_intrusa"]);

        // A tabela legítima criada por 0020 continua íntegra, e sem a FK
        // que só 0021 traria.
        expect(await colunasDe(pool, "import_batches")).toContain("scope_fingerprint");
        const [fks] = await pool.query(
          `SELECT constraint_name AS nome FROM information_schema.referential_constraints
            WHERE constraint_schema = DATABASE()`
        );
        expect((fks as Array<{ nome: string }>).map((f) => f.nome)).not.toContain("fk_ibi_batch");
      });
    },
    60_000
  );
});
