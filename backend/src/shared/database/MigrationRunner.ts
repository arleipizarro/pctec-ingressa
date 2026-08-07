import { createHash } from "node:crypto";
import type { Queryable } from "./Queryable.js";

export interface MigrationDefinition {
  readonly id: string;
  readonly description: string;
  readonly up: string;
  readonly down: string;
}

export interface MigrationApplyReport {
  readonly appliedIds: readonly string[];
  readonly alreadyAppliedIds: readonly string[];
}

export type MigrationStatusState = "applied" | "pending" | "checksum_mismatch" | "checksum_unknown";

export interface MigrationStatusEntry {
  readonly id: string;
  readonly description: string;
  readonly state: MigrationStatusState;
  readonly appliedAt: Date | null;
  readonly storedChecksum: string | null;
  readonly currentChecksum: string;
}

export interface MigrationRollbackReport {
  readonly revertedIds: readonly string[];
}

/**
 * Uma conexão física única (não um Pool) — compatível estruturalmente com
 * `PoolConnection` de mysql2/promise. Todo o ciclo de uma operação de
 * migration (GET_LOCK, aplicar/reverter, ler/escrever schema_migrations,
 * RELEASE_LOCK) roda sobre A MESMA instância desta interface — nunca uma
 * conexão diferente adquirida no meio do caminho (ver `withLock`).
 */
export interface Connection extends Queryable {
  release(): void;
}

/** Compatível estruturalmente com `Pool` de mysql2/promise — só o que este runner usa. */
export interface ConnectionPool {
  getConnection(): Promise<Connection>;
}

/**
 * Lançado quando uma migration já registrada em `schema_migrations` tem
 * `checksum` armazenado (não NULL) que não bate com o checksum do arquivo
 * `.up.sql` atual — sinal de que o conteúdo de uma migration já aplicada
 * foi editado depois do fato, o que este runner NUNCA aplica
 * silenciosamente.
 */
export class MigrationChecksumMismatchError extends Error {
  public constructor(
    public readonly migrationId: string,
    public readonly storedChecksum: string,
    public readonly currentChecksum: string
  ) {
    super(
      `Checksum divergente para a migration "${migrationId}": armazenado=${storedChecksum}, atual=${currentChecksum}. ` +
        `O conteúdo de uma migration já aplicada não deve ser editado — crie uma migration corretiva nova.`
    );
    this.name = "MigrationChecksumMismatchError";
  }
}

/** Lançado quando o lock nomeado de migration não pôde ser adquirido (outro runner em execução, ou GET_LOCK retornou 0/NULL). */
export class MigrationLockUnavailableError extends Error {
  public constructor(public readonly lockName: string, public readonly timeoutSeconds: number) {
    super(
      `Não foi possível adquirir o lock de migration "${lockName}" em ${timeoutSeconds}s — ` +
        `outro processo de migration parece estar em execução, ou o servidor recusou o lock.`
    );
    this.name = "MigrationLockUnavailableError";
  }
}

/**
 * Lançado quando o SQL de uma migration (arquivo `.up.sql` ou `.down.sql`)
 * contém mais de uma instrução executável — este runner exige exatamente
 * UMA instrução por arquivo (ver `assertSingleStatement`), porque
 * `mysql2/promise` roda com `multipleStatements` desabilitado por padrão
 * (não habilitado globalmente nesta fatia — ver auditoria no relatório
 * desta entrega) e porque múltiplas instruções por arquivo dificultam
 * diagnóstico de falha parcial.
 */
export class MigrationMultipleStatementsError extends Error {
  public constructor(public readonly migrationId: string, public readonly phase: "up" | "down") {
    super(
      `A migration "${migrationId}" (${phase}) contém mais de uma instrução SQL executável. ` +
        `Este runner exige exatamente uma instrução por arquivo — divida em migrations separadas.`
    );
    this.name = "MigrationMultipleStatementsError";
  }
}

/**
 * Lançado quando a execução de uma migration (SQL de `up`, ou o registro
 * subsequente em `schema_migrations`) falha. NUNCA inclui o SQL completo
 * da migration na mensagem (pode ser longo e, em migrations futuras,
 * conter dado sensível) — só `migrationId` e a fase em que a falha
 * ocorreu. A causa original fica em `.cause` (nunca logada por inteiro
 * pelo CLI — ver `src/cli/migrate.ts`).
 *
 * NUNCA prometido: nenhuma reversão automática do que a migration já
 * tiver alterado no schema antes de falhar — MariaDB/InnoDB dá commit
 * implícito em DDL, então uma falha a meio de uma instrução com múltiplos
 * efeitos (não é o caso das migrations atuais, que têm 1 instrução cada,
 * mas uma única instrução DDL como `ALTER TABLE ... ADD COLUMN a, ADD
 * COLUMN b` também não é atômica internamente no MariaDB) pode deixar o
 * schema parcialmente alterado sem estar registrado. Ver runbook, "Fase
 * C — falha parcial", para o procedimento de diagnóstico manual.
 */
export class MigrationExecutionError extends Error {
  public constructor(
    public readonly migrationId: string,
    public readonly phase: "up" | "down" | "record",
    cause: unknown
  ) {
    super(
      `Falha ao aplicar a migration "${migrationId}" na fase "${phase}". ` +
        `Nenhuma migration subsequente foi executada; o lock já foi liberado. ` +
        `Este runner NÃO reverte automaticamente o que já tiver sido alterado (DDL não é transacional no MariaDB/InnoDB) — ` +
        `siga o procedimento de diagnóstico manual no runbook antes de tentar novamente.`,
      { cause }
    );
    this.name = "MigrationExecutionError";
  }
}

function computeChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf-8").digest("hex");
}

/**
 * Valida que `sql` contém exatamente UMA instrução executável — ciente de
 * aspas: um `;` dentro de uma string literal (`'...'`/`"..."`/`` `...` ``,
 * incluindo aspas escapadas `''`/`\'`) NUNCA conta como separador de
 * instrução. Isso é necessário na prática: as migrations 0002 e 0003
 * têm comentários de coluna (`COMMENT '...'`) com pontuação em português
 * que inclui `;` dentro do texto — uma checagem ingênua de "primeiro `;`"
 * rejeitaria essas migrations incorretamente.
 */
export function assertSingleStatement(migrationId: string, phase: "up" | "down", sql: string): void {
  const withoutLineComments = sql.replace(/--[^\n]*/g, "");

  let inString = false;
  let quoteChar: string | null = null;
  let statementEndIndex: number | null = null;

  for (let i = 0; i < withoutLineComments.length; i += 1) {
    const ch = withoutLineComments[i];

    if (inString) {
      if (ch === quoteChar) {
        if (withoutLineComments[i + 1] === quoteChar) {
          i += 1; // aspas duplicadas escapadas ('' ou ""), continua na string
        } else {
          inString = false;
          quoteChar = null;
        }
      } else if (ch === "\\") {
        i += 1; // barra invertida escapa o próximo caractere (extensão MySQL/MariaDB)
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (ch === ";") {
      statementEndIndex = i;
      break;
    }
  }

  if (statementEndIndex === null) {
    return; // nenhum ';' encontrado fora de string — uma única instrução sem terminador, aceitável.
  }

  const remainder = withoutLineComments.slice(statementEndIndex + 1).trim();
  if (remainder.length > 0) {
    throw new MigrationMultipleStatementsError(migrationId, phase);
  }
}

const LOCK_NAME = "pctec_ingressa_migrations";
const LOCK_TIMEOUT_SECONDS = 10;

/**
 * Runner de migrations — v0.4.2 (MariaDB Integration).
 *
 * Propriedade central desta versão: GET_LOCK, a aplicação/reversão de
 * cada migration, a leitura/escrita de `schema_migrations` e RELEASE_LOCK
 * rodam TODOS sobre a MESMA conexão física, adquirida uma única vez por
 * operação (`withLock`) e liberada de volta ao pool ao final — nunca uma
 * conexão diferente obtida no meio do caminho. Isso é essencial porque
 * `GET_LOCK`/`RELEASE_LOCK` do MariaDB têm escopo de SESSÃO/CONEXÃO: se
 * o lock fosse adquirido numa conexão e as migrations executadas via
 * `pool.execute()` (que o mysql2 pode servir de uma conexão QUALQUER do
 * pool), o lock não protegeria nada de verdade.
 *
 * NÃO transacional por migration: MariaDB/InnoDB não suporta DDL
 * transacional (CREATE/ALTER/DROP TABLE dão commit implícito). Este
 * runner nunca promete nem finge reverter automaticamente uma migration
 * que falhou no meio — ver `MigrationExecutionError`.
 *
 * Cada arquivo `.up.sql`/`.down.sql` precisa conter exatamente UMA
 * instrução executável (`assertSingleStatement`) — este runner nunca
 * habilita `multipleStatements` na conexão.
 *
 * Este runner NUNCA é invocado automaticamente pelo bootstrap da
 * aplicação — só roda via o CLI operacional (`src/cli/migrate.ts`),
 * chamado explicitamente por um operador humano.
 */
export class MigrationRunner {
  public constructor(private readonly pool: ConnectionPool) {}

  public async applyPending(migrations: readonly MigrationDefinition[]): Promise<MigrationApplyReport> {
    for (const migration of migrations) {
      assertSingleStatement(migration.id, "up", migration.up);
    }

    return this.withLock(async (connection) => {
      await this.ensureSchemaMigrationsTableExists(connection);
      const applied = await this.fetchAppliedRows(connection);

      const appliedIds: string[] = [];
      const alreadyAppliedIds: string[] = [];
      // Migrations aplicadas NESTE MESMO run antes de a coluna `checksum`
      // existir (ex.: 0001-0003 processadas antes de 0004 rodar seu
      // ALTER TABLE, num banco totalmente novo) — recebem o checksum via
      // UPDATE logo depois que a coluna passa a existir, ainda dentro
      // deste método. Diferente de uma migration verdadeiramente legada
      // (aplicada por uma execução PASSADA) — essas nunca são
      // retroativamente preenchidas (ver `assertChecksumMatches`).
      const pendingBackfill: Array<{ id: string; checksum: string; executionTimeMs: number }> = [];

      for (const migration of migrations) {
        const existing = applied.get(migration.id);
        const currentChecksum = computeChecksum(migration.up);

        if (existing !== undefined) {
          this.assertChecksumMatches(migration.id, existing.checksum, currentChecksum);
          alreadyAppliedIds.push(migration.id);
          continue;
        }

        const startedAt = Date.now();
        try {
          // eslint-disable-next-line no-await-in-loop -- migrations devem ser
          // aplicadas estritamente em ordem, uma após a outra; uma falha aqui
          // interrompe o laço imediatamente (nenhuma migration seguinte roda).
          await connection.execute(migration.up);
        } catch (error) {
          throw new MigrationExecutionError(migration.id, "up", error);
        }
        const executionTimeMs = Date.now() - startedAt;

        try {
          // eslint-disable-next-line no-await-in-loop
          const hasChecksum = await this.hasChecksumColumns(connection);
          if (hasChecksum) {
            // eslint-disable-next-line no-await-in-loop
            await this.insertAppliedRowWithChecksum(connection, migration.id, currentChecksum, executionTimeMs);
          } else {
            // eslint-disable-next-line no-await-in-loop
            await this.insertAppliedRowLegacy(connection, migration.id);
            pendingBackfill.push({ id: migration.id, checksum: currentChecksum, executionTimeMs });
          }
        } catch (error) {
          // O `up` desta migration JÁ RODOU (schema possivelmente
          // alterado), mas não foi possível registrar em
          // schema_migrations — exatamente o risco de DDL não
          // transacional documentado na classe deste erro.
          throw new MigrationExecutionError(migration.id, "record", error);
        }
        appliedIds.push(migration.id);
      }

      if (pendingBackfill.length > 0 && (await this.hasChecksumColumns(connection))) {
        for (const item of pendingBackfill) {
          // eslint-disable-next-line no-await-in-loop -- poucas linhas, mantém simplicidade.
          await connection.execute(`UPDATE schema_migrations SET checksum = ?, execution_time_ms = ? WHERE id = ?`, [
            item.checksum,
            item.executionTimeMs,
            item.id
          ]);
        }
      }

      return { appliedIds, alreadyAppliedIds };
    });
  }

  /**
   * Leitura pura. Adquire sua própria conexão (não passa pelo lock — não
   * há necessidade de exclusão mútua para uma leitura simples), libera ao
   * final. Nunca escreve — exceto que, tecnicamente, esta versão não
   * precisa mais criar `schema_migrations` para funcionar: se a tabela
   * não existir, todas as migrations aparecem como `pending` sem
   * nenhuma escrita ter ocorrido.
   */
  public async status(migrations: readonly MigrationDefinition[]): Promise<MigrationStatusEntry[]> {
    const connection = await this.pool.getConnection();
    try {
      const tableExists = await this.schemaMigrationsTableExists(connection);
      const applied = tableExists
        ? await this.fetchAppliedRows(connection)
        : new Map<string, { appliedAt: Date; checksum: string | null }>();

      return migrations.map((migration) => {
        const currentChecksum = computeChecksum(migration.up);
        const existing = applied.get(migration.id);

        if (existing === undefined) {
          return {
            id: migration.id,
            description: migration.description,
            state: "pending",
            appliedAt: null,
            storedChecksum: null,
            currentChecksum
          };
        }

        if (existing.checksum === null) {
          return {
            id: migration.id,
            description: migration.description,
            state: "checksum_unknown",
            appliedAt: existing.appliedAt,
            storedChecksum: null,
            currentChecksum
          };
        }

        const state: MigrationStatusState = existing.checksum === currentChecksum ? "applied" : "checksum_mismatch";
        return {
          id: migration.id,
          description: migration.description,
          state,
          appliedAt: existing.appliedAt,
          storedChecksum: existing.checksum,
          currentChecksum
        };
      });
    } finally {
      connection.release();
    }
  }

  /** Reverte apenas a migration mais recentemente aplicada (última em `migrations` que estiver em `schema_migrations`). */
  public async rollbackLast(migrations: readonly MigrationDefinition[]): Promise<MigrationRollbackReport> {
    for (const migration of migrations) {
      assertSingleStatement(migration.id, "down", migration.down);
    }

    return this.withLock(async (connection) => {
      const applied = await this.fetchAppliedRows(connection);
      const appliedInOrder = migrations.filter((migration) => applied.has(migration.id));
      const last = appliedInOrder[appliedInOrder.length - 1];

      if (last === undefined) {
        return { revertedIds: [] };
      }

      await this.revertOne(connection, last);
      return { revertedIds: [last.id] };
    });
  }

  /** Reverte todas as migrations aplicadas, em ordem estritamente reversa. */
  public async rollbackAll(migrations: readonly MigrationDefinition[]): Promise<MigrationRollbackReport> {
    for (const migration of migrations) {
      assertSingleStatement(migration.id, "down", migration.down);
    }

    return this.withLock(async (connection) => {
      const applied = await this.fetchAppliedRows(connection);
      const appliedInOrder = migrations.filter((migration) => applied.has(migration.id));

      const revertedIds: string[] = [];
      for (const migration of [...appliedInOrder].reverse()) {
        // eslint-disable-next-line no-await-in-loop -- reversão estritamente em ordem; falha interrompe imediatamente.
        await this.revertOne(connection, migration);
        revertedIds.push(migration.id);
      }
      return { revertedIds };
    });
  }

  private async revertOne(connection: Connection, migration: MigrationDefinition): Promise<void> {
    try {
      await connection.execute(migration.down);
    } catch (error) {
      throw new MigrationExecutionError(migration.id, "down", error);
    }
    await connection.execute(`DELETE FROM schema_migrations WHERE id = ?`, [migration.id]);
  }

  private assertChecksumMatches(id: string, storedChecksum: string | null, currentChecksum: string): void {
    if (storedChecksum === null) {
      return;
    }
    if (storedChecksum !== currentChecksum) {
      throw new MigrationChecksumMismatchError(id, storedChecksum, currentChecksum);
    }
  }

  /**
   * Adquire UMA conexão física do pool, executa `fn` inteiramente sobre
   * ela (GET_LOCK → fn → RELEASE_LOCK), e SÓ NO FINAL libera a conexão de
   * volta ao pool. Se `GET_LOCK` não retornar 1/true (inclui 0 e NULL),
   * nenhuma migration é executada — a conexão ainda é liberada (ela foi
   * adquirida), mas `RELEASE_LOCK` nunca é chamado (o lock nunca foi
   * obtido, não há o que liberar).
   */
  private async withLock<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      const [lockRows] = await connection.execute(`SELECT GET_LOCK(?, ?) AS acquired`, [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
      const acquired = this.extractSingleColumnValue(lockRows, "acquired");
      if (acquired !== 1 && acquired !== true) {
        throw new MigrationLockUnavailableError(LOCK_NAME, LOCK_TIMEOUT_SECONDS);
      }

      try {
        return await fn(connection);
      } finally {
        await connection.execute(`SELECT RELEASE_LOCK(?) AS released`, [LOCK_NAME]);
      }
    } finally {
      connection.release();
    }
  }

  private extractSingleColumnValue(rows: unknown, column: string): unknown {
    const rowList = rows as Array<Record<string, unknown>>;
    return rowList[0]?.[column];
  }

  private async schemaMigrationsTableExists(connection: Connection): Promise<boolean> {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'`
    );
    const total = Number(this.extractSingleColumnValue(rows, "total") ?? 0);
    return total > 0;
  }

  private async hasChecksumColumns(connection: Connection): Promise<boolean> {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS total FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'checksum'`
    );
    const total = Number(this.extractSingleColumnValue(rows, "total") ?? 0);
    return total > 0;
  }

  private async ensureSchemaMigrationsTableExists(connection: Connection): Promise<void> {
    // Formato mínimo (id, applied_at) — idêntico ao criado pela migration
    // 0001_create_schema_migrations. As colunas checksum/execution_time_ms
    // (migration 0004) são adicionadas via ALTER quando 0004 é aplicada
    // dentro do mesmo applyPending, não aqui.
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id            VARCHAR(64)   NOT NULL,
         applied_at    DATETIME(3)   NOT NULL,
         PRIMARY KEY (id)
       ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_520_ci`
    );
  }

  private async fetchAppliedRows(connection: Connection): Promise<Map<string, { appliedAt: Date; checksum: string | null }>> {
    const hasChecksum = await this.hasChecksumColumns(connection);
    const columns = hasChecksum ? "id, applied_at, checksum" : "id, applied_at";
    const [rows] = await connection.execute(`SELECT ${columns} FROM schema_migrations`);
    const rowList = rows as Array<Record<string, unknown>>;

    const result = new Map<string, { appliedAt: Date; checksum: string | null }>();
    for (const row of rowList) {
      result.set(String(row["id"]), {
        appliedAt: row["applied_at"] as Date,
        checksum: hasChecksum ? ((row["checksum"] as string | null) ?? null) : null
      });
    }
    return result;
  }

  private async insertAppliedRowWithChecksum(
    connection: Connection,
    id: string,
    checksum: string,
    executionTimeMs: number
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO schema_migrations (id, applied_at, checksum, execution_time_ms) VALUES (?, ?, ?, ?)`,
      [id, new Date(), checksum, executionTimeMs]
    );
  }

  private async insertAppliedRowLegacy(connection: Connection, id: string): Promise<void> {
    await connection.execute(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`, [id, new Date()]);
  }
}
