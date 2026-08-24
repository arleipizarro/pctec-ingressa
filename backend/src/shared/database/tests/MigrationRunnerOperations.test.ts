import { describe, it, expect } from "vitest";
import {
  MigrationRunner,
  MigrationChecksumMismatchError,
  MigrationLockUnavailableError,
  MigrationExecutionError,
  MigrationMultipleStatementsError,
  assertSingleStatement,
  type MigrationDefinition
} from "../MigrationRunner.js";
import { FakeQueryable } from "./FakeQueryable.js";

const MIGRATIONS: MigrationDefinition[] = [
  { id: "0001_create_schema_migrations", description: "a", up: "CREATE TABLE a (id INT)", down: "DROP TABLE a" },
  { id: "0002_create_identities", description: "b", up: "CREATE TABLE identities (id INT)", down: "DROP TABLE identities" },
  { id: "0003_create_audit_events", description: "c", up: "CREATE TABLE audit_events (id INT)", down: "DROP TABLE audit_events" },
  {
    id: "0004_add_checksum_and_timing_to_schema_migrations",
    description: "d",
    up: "ALTER TABLE schema_migrations ADD COLUMN checksum CHAR(64) NULL, ADD COLUMN execution_time_ms INT UNSIGNED NULL",
    down: "ALTER TABLE schema_migrations DROP COLUMN checksum, DROP COLUMN execution_time_ms"
  }
];

describe("MigrationRunner — lock (GET_LOCK/RELEASE_LOCK)", () => {
  it("adquire o lock antes de aplicar e libera ao final, mesmo em caso de sucesso", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);

    expect(fake.getLockCallCount).toBe(1);
    expect(fake.releaseLockCallCount).toBe(1);
  });

  it("libera o lock mesmo quando a aplicação falha no meio (checksum divergente)", async () => {
    const fake = new FakeQueryable();
    fake.seedAppliedMigration("0001_create_schema_migrations", { checksum: "checksum-antigo-diferente" });
    const runner = new MigrationRunner(fake);

    await expect(runner.applyPending(MIGRATIONS)).rejects.toThrow(MigrationChecksumMismatchError);
    expect(fake.releaseLockCallCount).toBe(1);
  });

  it("lança MigrationLockUnavailableError quando o lock não pode ser adquirido, sem aplicar nada", async () => {
    const fake = new FakeQueryable();
    fake.lockAcquisitionResult = 0;
    const runner = new MigrationRunner(fake);

    await expect(runner.applyPending(MIGRATIONS)).rejects.toThrow(MigrationLockUnavailableError);
    // Como o lock nunca foi adquirido, RELEASE_LOCK não deveria ser chamado.
    expect(fake.releaseLockCallCount).toBe(0);
  });

  it("rollbackLast e rollbackAll também usam o lock", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    fake.getLockCallCount = 0;
    fake.releaseLockCallCount = 0;

    await runner.rollbackLast(MIGRATIONS);
    expect(fake.getLockCallCount).toBe(1);
    expect(fake.releaseLockCallCount).toBe(1);
  });
});

describe("MigrationRunner — checksum", () => {
  it("registra o checksum SHA-256 do .up.sql ao aplicar uma migration nova", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);
    const status = await runner.status(MIGRATIONS);

    for (const entry of status) {
      expect(entry.state).toBe("applied");
      expect(entry.storedChecksum).toBe(entry.currentChecksum);
      expect(entry.storedChecksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("migration já aplicada com checksum idêntico ao arquivo atual: aplica normalmente (idempotente)", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);
    const secondReport = await runner.applyPending(MIGRATIONS);

    expect(secondReport.appliedIds).toEqual([]);
    expect(secondReport.alreadyAppliedIds).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it("migration já aplicada com checksum divergente do arquivo atual: lança MigrationChecksumMismatchError", async () => {
    const fake = new FakeQueryable();
    fake.seedAppliedMigration("0002_create_identities", { checksum: "0".repeat(64) });
    const runner = new MigrationRunner(fake);

    await expect(runner.applyPending(MIGRATIONS)).rejects.toThrow(MigrationChecksumMismatchError);
  });

  it("migration já aplicada SEM checksum armazenado (legado, antes da coluna existir): nunca lança, trata como desconhecido", async () => {
    const fake = new FakeQueryable();
    fake.seedAppliedMigration("0001_create_schema_migrations", {});
    // Força a existência da coluna (aplicada por uma versão anterior sem
    // preencher, ex.: migração feita fora deste runner).
    await fake.execute("ALTER TABLE schema_migrations ADD COLUMN checksum CHAR(64) NULL");
    const runner = new MigrationRunner(fake);

    const report = await runner.applyPending(MIGRATIONS);
    expect(report.alreadyAppliedIds).toContain("0001_create_schema_migrations");
  });

  it("checksums de duas migrations com conteúdo diferente nunca colidem", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    const status = await runner.status(MIGRATIONS);

    const checksums = status.map((entry) => entry.storedChecksum);
    expect(new Set(checksums).size).toBe(checksums.length);
  });
});

describe("MigrationRunner — status (leitura pura)", () => {
  it("banco sem schema_migrations ainda: todas as migrations aparecem como pending", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    const status = await runner.status(MIGRATIONS);

    expect(status.every((entry) => entry.state === "pending")).toBe(true);
    expect(status.every((entry) => entry.appliedAt === null)).toBe(true);
  });

  it("status nunca escreve nada — nenhuma chamada de INSERT/ALTER/CREATE", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.status(MIGRATIONS);

    const writeCalls = fake.calls.filter((call) => /^(INSERT|ALTER|CREATE|DELETE)/i.test(call.sql.trim()));
    expect(writeCalls).toEqual([]);
  });

  it("mistura de aplicadas e pendentes é reportada corretamente (sem 0004 aplicada ainda, coluna checksum não existe → checksum_unknown é o estado correto, não incompatibilidade)", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS.slice(0, 2));

    const status = await runner.status(MIGRATIONS);

    expect(status[0]?.state).toBe("checksum_unknown");
    expect(status[1]?.state).toBe("checksum_unknown");
    expect(status[2]?.state).toBe("pending");
    expect(status[3]?.state).toBe("pending");
  });

  it("quando 0001-0003 são aplicadas numa chamada e 0004 só depois, numa SEGUNDA chamada separada (legado real): 0001-0003 permanecem checksum_unknown — nunca preenchidas retroativamente a partir de uma execução passada, só 0004 fica applied", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS.slice(0, 3));
    await runner.applyPending(MIGRATIONS); // aplica só a 0004 restante, numa chamada separada

    const status = await runner.status(MIGRATIONS);

    expect(status[0]?.state).toBe("checksum_unknown");
    expect(status[1]?.state).toBe("checksum_unknown");
    expect(status[2]?.state).toBe("checksum_unknown");
    expect(status[3]?.state).toBe("applied");
  });
});

describe("MigrationRunner — rollback", () => {
  it("rollbackLast reverte apenas a última migration aplicada, na ordem fornecida (reverter 0004 remove a própria infraestrutura de checksum — as demais voltam a checksum_unknown, corretamente, até 0004 ser reaplicada)", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);

    const report = await runner.rollbackLast(MIGRATIONS);

    expect(report.revertedIds).toEqual(["0004_add_checksum_and_timing_to_schema_migrations"]);
    const status = await runner.status(MIGRATIONS);
    expect(status.find((e) => e.id === "0004_add_checksum_and_timing_to_schema_migrations")?.state).toBe("pending");
    // A própria coluna checksum deixou de existir (0004.down.sql a
    // remove) — as demais migrations ainda aplicadas não têm mais como
    // reportar checksum, por isso "checksum_unknown", não "applied".
    expect(status.find((e) => e.id === "0003_create_audit_events")?.state).toBe("checksum_unknown");
  });

  it("rollbackLast em banco sem nenhuma migration aplicada não faz nada e não lança", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    const report = await runner.rollbackLast(MIGRATIONS);
    expect(report.revertedIds).toEqual([]);
  });

  it("rollbackAll reverte todas as migrations aplicadas, em ordem estritamente reversa", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);

    const report = await runner.rollbackAll(MIGRATIONS);

    expect(report.revertedIds).toEqual([...MIGRATIONS].reverse().map((m) => m.id));
    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state === "pending")).toBe(true);
  });

  it("reaplicar depois de um rollbackAll funciona normalmente (prova de idempotência do ciclo completo)", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);
    await runner.rollbackAll(MIGRATIONS);
    const reapplyReport = await runner.applyPending(MIGRATIONS);

    expect(reapplyReport.appliedIds).toEqual(MIGRATIONS.map((m) => m.id));
    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state === "applied")).toBe(true);
  });

  it("rollback executa o SQL de down de cada migration revertida", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);

    await runner.rollbackLast(MIGRATIONS);

    expect(fake.calls.some((call) => call.sql.includes("DROP COLUMN checksum"))).toBe(true);
  });
});

describe("MigrationRunner — falha durante apply", () => {
  it("se o SQL de uma migration falhar, lança MigrationExecutionError (fase 'up', migrationId incluído, causa original preservada em .cause, SEM o SQL completo na mensagem), e a migration NÃO é registrada como aplicada", async () => {
    const fake = new FakeQueryable();
    const failingMigrations: MigrationDefinition[] = [
      MIGRATIONS[0]!,
      { id: "0002_broken", description: "quebra de propósito", up: "ESTA SQL FALHA COM SEGREDO DE MENTIRA", down: "SELECT 1" }
    ];
    fake.whenExecute(
      (sql) => sql === "ESTA SQL FALHA COM SEGREDO DE MENTIRA",
      () => {
        throw new Error("falha simulada de SQL");
      }
    );
    const runner = new MigrationRunner(fake);

    let caught: unknown;
    try {
      await runner.applyPending(failingMigrations);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MigrationExecutionError);
    const migrationError = caught as MigrationExecutionError;
    expect(migrationError.migrationId).toBe("0002_broken");
    expect(migrationError.phase).toBe("up");
    expect(migrationError.cause).toBeInstanceOf(Error);
    expect((migrationError.cause as Error).message).toBe("falha simulada de SQL");
    // A mensagem do próprio MigrationExecutionError nunca ecoa o SQL completo da migration.
    expect(migrationError.message).not.toContain("ESTA SQL FALHA COM SEGREDO DE MENTIRA");
    expect(fake.releaseLockCallCount).toBe(1);

    // A mensagem do próprio MigrationExecutionError nunca ecoa o SQL completo da migration.
    expect(migrationError.message).not.toContain("ESTA SQL FALHA COM SEGREDO DE MENTIRA");

    expect(fake.releaseLockCallCount).toBe(1);

    const status = await runner.status(failingMigrations);
    expect(status.find((e) => e.id === "0001_create_schema_migrations")?.state).toBe("checksum_unknown");
    expect(status.find((e) => e.id === "0002_broken")?.state).toBe("pending");
  });

  it("interrompe imediatamente após a primeira falha — nenhuma migration seguinte na lista é executada", async () => {
    const fake = new FakeQueryable();
    const migrationsWithFailureInMiddle: MigrationDefinition[] = [
      { id: "0001_ok", description: "ok", up: "CREATE TABLE ok1 (id INT)", down: "DROP TABLE ok1" },
      { id: "0002_falha", description: "falha", up: "SQL QUE FALHA", down: "SELECT 1" },
      { id: "0003_nunca_deveria_rodar", description: "nunca", up: "CREATE TABLE nunca (id INT)", down: "DROP TABLE nunca" }
    ];
    fake.whenExecute(
      (sql) => sql === "SQL QUE FALHA",
      () => {
        throw new Error("falha simulada");
      }
    );
    const runner = new MigrationRunner(fake);

    await expect(runner.applyPending(migrationsWithFailureInMiddle)).rejects.toThrow(MigrationExecutionError);

    expect(fake.calls.some((call) => call.sql === "CREATE TABLE nunca (id INT)")).toBe(false);
    const status = await runner.status(migrationsWithFailureInMiddle);
    expect(status.find((e) => e.id === "0003_nunca_deveria_rodar")?.state).toBe("pending");
  });
});

describe("MigrationRunner — validação de instrução única por arquivo", () => {
  it("assertSingleStatement aceita uma única instrução, mesmo com ';' dentro de string literal (aspas simples/duplas, com escape)", () => {
    expect(() =>
      assertSingleStatement("x", "up", `CREATE TABLE a (c VARCHAR(10) COMMENT 'tem ; ponto e vírgula dentro')`)
    ).not.toThrow();
    expect(() =>
      assertSingleStatement("x", "up", `CREATE TABLE a (c VARCHAR(10) COMMENT 'aspas '' escapada; ainda uma string')`)
    ).not.toThrow();
    expect(() => assertSingleStatement("x", "up", `CREATE TABLE a (id INT);`)).not.toThrow();
    expect(() => assertSingleStatement("x", "up", `CREATE TABLE a (id INT)`)).not.toThrow(); // sem ';' final — aceitável
  });

  it("assertSingleStatement rejeita duas instruções reais separadas por ';'", () => {
    expect(() => assertSingleStatement("x", "up", `CREATE TABLE a (id INT); CREATE TABLE b (id INT);`)).toThrow(
      MigrationMultipleStatementsError
    );
    expect(() => assertSingleStatement("x", "down", `DROP TABLE a; DROP TABLE b;`)).toThrow(MigrationMultipleStatementsError);
  });

  it("[auditoria] cada um dos 21 arquivos de migration reais (0001-0021, up e down) tem exatamente uma instrução executável", async () => {
    const { loadMigrationDefinitions } = await import("../loadMigrationDefinitions.js");
    const migrations = loadMigrationDefinitions();
    expect(migrations.length).toBe(21);
    for (const migration of migrations) {
      expect(() => assertSingleStatement(migration.id, "up", migration.up)).not.toThrow();
      expect(() => assertSingleStatement(migration.id, "down", migration.down)).not.toThrow();
    }
  });

  it("applyPending rejeita TODO o lote (nenhuma migration executada) se qualquer uma tiver múltiplas instruções — falha rápido, antes de adquirir lock/conexão", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    const invalidMigrations: MigrationDefinition[] = [
      MIGRATIONS[0]!,
      { id: "0002_duas_instrucoes", description: "x", up: "CREATE TABLE a (id INT); CREATE TABLE b (id INT);", down: "DROP TABLE a" }
    ];

    await expect(runner.applyPending(invalidMigrations)).rejects.toThrow(MigrationMultipleStatementsError);
    expect(fake.connectionsAcquired.length).toBe(0);
    expect(fake.calls.length).toBe(0);
  });
});

describe("MigrationRunner — conexão única por operação (GET_LOCK/migrations/schema_migrations/RELEASE_LOCK)", () => {
  it("applyPending adquire exatamente UMA conexão, e ela é liberada exatamente uma vez", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);

    expect(fake.connectionsAcquired.length).toBe(1);
    expect(fake.connectionsAcquired[0]!.releaseCallCount).toBe(1);
  });

  it("GET_LOCK, o SQL de cada migration, schema_migrations e RELEASE_LOCK passam todos pela MESMA instância de conexão", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);

    const connection = fake.connectionsAcquired[0]!;
    const sqlOnThisConnection = connection.calls.map((c) => c.sql);
    expect(sqlOnThisConnection.some((sql) => sql.includes("GET_LOCK"))).toBe(true);
    expect(sqlOnThisConnection.some((sql) => sql.includes("RELEASE_LOCK"))).toBe(true);
    expect(sqlOnThisConnection.some((sql) => sql.includes("CREATE TABLE identities"))).toBe(true);
    expect(sqlOnThisConnection.some((sql) => sql.toUpperCase().startsWith("INSERT INTO SCHEMA_MIGRATIONS"))).toBe(true);
    // Toda chamada registrada no FakeQueryable "banco" também aparece na
    // própria conexão — prova de que nada foi executado por fora dela.
    expect(connection.calls.length).toBe(fake.calls.length);
  });

  it("rollbackLast/rollbackAll também usam exatamente uma conexão", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    fake.connectionsAcquired.length = 0;

    await runner.rollbackAll(MIGRATIONS);

    expect(fake.connectionsAcquired.length).toBe(1);
    expect(fake.connectionsAcquired[0]!.releaseCallCount).toBe(1);
  });

  it("a conexão é liberada mesmo quando GET_LOCK falha (retorna 0) — mas RELEASE_LOCK nunca é chamado nesse caso", async () => {
    const fake = new FakeQueryable();
    fake.lockAcquisitionResult = 0;
    const runner = new MigrationRunner(fake);

    await expect(runner.applyPending(MIGRATIONS)).rejects.toThrow(MigrationLockUnavailableError);

    expect(fake.connectionsAcquired.length).toBe(1);
    expect(fake.connectionsAcquired[0]!.releaseCallCount).toBe(1);
    expect(fake.releaseLockCallCount).toBe(0);
  });

  it("a conexão é liberada mesmo quando uma migration falha no meio da aplicação", async () => {
    const fake = new FakeQueryable();
    const failingMigrations: MigrationDefinition[] = [{ id: "0001_falha", description: "x", up: "SQL RUIM", down: "SELECT 1" }];
    fake.whenExecute(
      (sql) => sql === "SQL RUIM",
      () => {
        throw new Error("falha");
      }
    );
    const runner = new MigrationRunner(fake);

    await expect(runner.applyPending(failingMigrations)).rejects.toThrow(MigrationExecutionError);

    expect(fake.connectionsAcquired.length).toBe(1);
    expect(fake.connectionsAcquired[0]!.releaseCallCount).toBe(1);
    expect(fake.releaseLockCallCount).toBe(1); // lock foi adquirido antes da falha, então é liberado
  });

  it("status() também adquire e libera sua própria conexão (sem lock — leitura pura)", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.status(MIGRATIONS);

    expect(fake.connectionsAcquired.length).toBe(1);
    expect(fake.connectionsAcquired[0]!.releaseCallCount).toBe(1);
    expect(fake.getLockCallCount).toBe(0); // status nunca adquire o lock
  });
});

describe("MigrationRunner — logs sanitizados", () => {
  it("nenhuma senha/credencial aparece no SQL ou nos params registrados pelo runner (o runner nunca lida com credenciais — só SQL/ids)", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);

    const allText = fake.calls.map((call) => `${call.sql} ${JSON.stringify(call.params ?? [])}`).join("\n");
    expect(allText.toLowerCase()).not.toContain("password");
    expect(allText.toLowerCase()).not.toContain("senha");
  });
});
