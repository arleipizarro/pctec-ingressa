import type { Queryable } from "../Queryable.js";

/**
 * Implementação fake de Queryable, em memória, para uso em testes
 * unitários — nunca abre conexão de rede ou de banco real.
 *
 * Entende um subconjunto pequeno e propositalmente simples de SQL (o
 * suficiente para exercitar MigrationRunner: schema_migrations,
 * information_schema.tables/columns, GET_LOCK/RELEASE_LOCK), além de
 * permitir registrar respostas programadas (`whenExecute`) para casos
 * mais específicos usados por outros testes (ex.: repositories).
 */
export class FakeQueryable implements Queryable {
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  /** Toda `FakeConnection` entregue por `getConnection()` — usado pelos testes de MigrationRunner para provar "uma conexão por operação". */
  public readonly connectionsAcquired: FakeConnection[] = [];

  private schemaMigrationsTableCreated = false;
  private hasChecksumColumns = false;
  private schemaMigrationsRows: Array<{ id: string; applied_at: Date; checksum: string | null; execution_time_ms: number | null }> = [];

  /** Configurável pelos testes: simula GET_LOCK falhando (lock indisponível). */
  public lockAcquisitionResult: 1 | 0 = 1;
  public getLockCallCount = 0;
  public releaseLockCallCount = 0;

  private readonly programmedResponses: Array<{
    match: (sql: string, params: readonly unknown[] | undefined) => boolean;
    respond: () => [unknown, unknown];
  }> = [];

  /** Registra uma resposta programada para chamadas cujo SQL/params batam com `match`. */
  public whenExecute(
    match: (sql: string, params: readonly unknown[] | undefined) => boolean,
    respond: () => [unknown, unknown]
  ): void {
    this.programmedResponses.push({ match, respond });
  }

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.calls.push({ sql, params });
    const normalized = sql.trim().toUpperCase();

    const programmed = this.programmedResponses.find((entry) => entry.match(sql, params));
    if (programmed !== undefined) {
      return programmed.respond();
    }

    if (normalized.startsWith("SELECT GET_LOCK")) {
      this.getLockCallCount += 1;
      return [[{ acquired: this.lockAcquisitionResult }], []];
    }

    if (normalized.startsWith("SELECT RELEASE_LOCK")) {
      this.releaseLockCallCount += 1;
      return [[{ released: 1 }], []];
    }

    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS SCHEMA_MIGRATIONS")) {
      this.schemaMigrationsTableCreated = true;
      return [[], []];
    }

    if (normalized.startsWith("ALTER TABLE SCHEMA_MIGRATIONS") && normalized.includes("ADD COLUMN CHECKSUM")) {
      this.hasChecksumColumns = true;
      return [[], []];
    }

    if (normalized.startsWith("ALTER TABLE SCHEMA_MIGRATIONS") && normalized.includes("DROP COLUMN CHECKSUM")) {
      this.hasChecksumColumns = false;
      return [[], []];
    }

    if (normalized.includes("INFORMATION_SCHEMA.TABLES") && normalized.includes("SCHEMA_MIGRATIONS")) {
      return [[{ total: this.schemaMigrationsTableCreated ? 1 : 0 }], []];
    }

    if (normalized.includes("INFORMATION_SCHEMA.COLUMNS") && normalized.includes("CHECKSUM")) {
      return [[{ total: this.hasChecksumColumns ? 1 : 0 }], []];
    }

    if (normalized.startsWith("SELECT ID, APPLIED_AT, CHECKSUM FROM SCHEMA_MIGRATIONS")) {
      return [
        this.schemaMigrationsRows.map((row) => ({ id: row.id, applied_at: row.applied_at, checksum: row.checksum })),
        []
      ];
    }

    if (normalized.startsWith("SELECT ID, APPLIED_AT FROM SCHEMA_MIGRATIONS")) {
      return [this.schemaMigrationsRows.map((row) => ({ id: row.id, applied_at: row.applied_at })), []];
    }

    if (normalized.startsWith("INSERT INTO SCHEMA_MIGRATIONS (ID, APPLIED_AT, CHECKSUM, EXECUTION_TIME_MS)")) {
      const [id, appliedAt, checksum, executionTimeMs] = params ?? [];
      this.schemaMigrationsRows.push({
        id: String(id),
        applied_at: appliedAt as Date,
        checksum: checksum as string,
        execution_time_ms: executionTimeMs as number
      });
      return [{ insertId: this.schemaMigrationsRows.length, affectedRows: 1 }, []];
    }

    if (normalized.startsWith("INSERT INTO SCHEMA_MIGRATIONS (ID, APPLIED_AT)")) {
      const [id, appliedAt] = params ?? [];
      this.schemaMigrationsRows.push({ id: String(id), applied_at: appliedAt as Date, checksum: null, execution_time_ms: null });
      return [{ insertId: this.schemaMigrationsRows.length, affectedRows: 1 }, []];
    }

    if (normalized.startsWith("UPDATE SCHEMA_MIGRATIONS SET CHECKSUM")) {
      const [checksum, executionTimeMs, id] = params ?? [];
      const row = this.schemaMigrationsRows.find((r) => r.id === String(id));
      if (row !== undefined) {
        row.checksum = checksum as string;
        row.execution_time_ms = executionTimeMs as number;
      }
      return [{ affectedRows: row !== undefined ? 1 : 0 }, []];
    }

    if (normalized.startsWith("DELETE FROM SCHEMA_MIGRATIONS WHERE ID")) {
      const [id] = params ?? [];
      const before = this.schemaMigrationsRows.length;
      this.schemaMigrationsRows = this.schemaMigrationsRows.filter((row) => row.id !== String(id));
      return [{ affectedRows: before - this.schemaMigrationsRows.length }, []];
    }

    // Qualquer outro SQL (ex.: CREATE TABLE identities/audit_events das
    // migrations, ou ALTER TABLE genérica) é aceito e simplesmente
    // "executado" sem efeito — este fake não simula um schema completo,
    // apenas a orquestração de aplicação/reversão/status de migrations.
    return [{ affectedRows: 0 }, []];
  }

  /** Atalho de setup para testes: simula migrations já aplicadas (com ou sem checksum), sem passar pelo runner. */
  public seedAppliedMigration(id: string, options: { checksum?: string | null; appliedAt?: Date } = {}): void {
    this.schemaMigrationsTableCreated = true;
    if (options.checksum !== undefined) {
      this.hasChecksumColumns = true;
    }
    this.schemaMigrationsRows.push({
      id,
      applied_at: options.appliedAt ?? new Date(),
      checksum: options.checksum ?? null,
      execution_time_ms: null
    });
  }

  /**
   * Torna `FakeQueryable` diretamente compatível com `ConnectionPool`
   * (a interface que `MigrationRunner` agora exige) — assim, todo
   * `new MigrationRunner(fake)` já existente nos testes continua
   * funcionando sem alteração. Cada chamada entrega uma `FakeConnection`
   * NOVA (delegando para este mesmo `FakeQueryable`), registrada em
   * `connectionsAcquired`, para provar que o runner adquire exatamente
   * uma conexão por operação.
   */
  public async getConnection(): Promise<FakeConnection> {
    const connection = new FakeConnection(this);
    this.connectionsAcquired.push(connection);
    return connection;
  }
}

/**
 * "Conexão" fake — implementa `Connection` (Queryable + release()).
 * Delega toda execução para o `FakeQueryable` compartilhado (que modela
 * "o banco"), mas mantém seu PRÓPRIO log de chamadas e contador de
 * `release()` — para os testes de MigrationRunner poderem provar que
 * GET_LOCK, o SQL de cada migration, schema_migrations e RELEASE_LOCK
 * passaram todos pela MESMA instância de conexão, e que ela foi liberada
 * exatamente uma vez.
 */
export class FakeConnection implements Queryable {
  public releaseCallCount = 0;
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

  public constructor(private readonly queryable: FakeQueryable) {}

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.calls.push({ sql, params });
    return this.queryable.execute(sql, params);
  }

  public release(): void {
    this.releaseCallCount += 1;
  }
}
