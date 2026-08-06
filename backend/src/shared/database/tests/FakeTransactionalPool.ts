import type { Queryable } from "../Queryable.js";

/**
 * Simula "o banco" — apenas o que foi efetivamente commitado é visível
 * aqui. Nenhuma escrita de uma transação em andamento aparece nestas
 * listas antes de `commit()` ser chamado na conexão correspondente.
 */
export class FakeTransactionalDatabase {
  public readonly committedIdentityInserts: Array<{ params: readonly unknown[] }> = [];
  public readonly committedAuditEventInserts: Array<{ params: readonly unknown[] }> = [];
}

/** Configuração mutável, usada para programar falhas em um teste específico. */
export interface FakeFailureConfig {
  failOnSqlPrefix?: string;
}

/**
 * Conexão fake que se comporta como uma transação real de banco de
 * dados: escritas ficam pendentes (visíveis apenas para esta própria
 * conexão) até `commit()`; `rollback()` descarta tudo que estava
 * pendente, sem afetar `FakeTransactionalDatabase`.
 *
 * Implementa `Queryable` (compatível com os repositories reais) e,
 * adicionalmente, `beginTransaction`/`commit`/`rollback`/`release`
 * (compatível estruturalmente com `PoolConnection` de mysql2/promise —
 * o suficiente para dirigir `MariaDbUnitOfWork` em teste, sem importar
 * `mysql2` nem abrir nenhuma conexão de rede real).
 */
export class FakeTransactionalConnection implements Queryable {
  public rollbackCallCount = 0;
  public commitCallCount = 0;
  public beginTransactionCallCount = 0;
  public releaseCallCount = 0;
  public readonly executeCalls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

  private pendingIdentityInserts: Array<{ params: readonly unknown[] }> = [];
  private pendingAuditEventInserts: Array<{ params: readonly unknown[] }> = [];
  private nextInsertId = 1;

  public constructor(
    private readonly db: FakeTransactionalDatabase,
    private readonly failureConfig: FakeFailureConfig
  ) {}

  public async beginTransaction(): Promise<void> {
    this.beginTransactionCallCount += 1;
  }

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.executeCalls.push({ sql, params });
    const normalized = sql.trim().toUpperCase();

    if (
      this.failureConfig.failOnSqlPrefix !== undefined &&
      normalized.startsWith(this.failureConfig.failOnSqlPrefix)
    ) {
      throw new Error(`Falha simulada para SQL iniciado com: ${this.failureConfig.failOnSqlPrefix}`);
    }

    if (normalized.startsWith("INSERT INTO IDENTITIES")) {
      const insertId = this.nextInsertId;
      this.nextInsertId += 1;
      this.pendingIdentityInserts.push({ params: params ?? [] });
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (normalized.startsWith("SELECT 1 FROM IDENTITIES")) {
      // Nenhuma duplicidade simulada por padrão nestes testes de
      // atomicidade — o foco é a transação, não unicidade.
      return [[], []];
    }

    if (normalized.startsWith("INSERT INTO AUDIT_EVENTS")) {
      this.pendingAuditEventInserts.push({ params: params ?? [] });
      return [{ affectedRows: 1, insertId: 1 }, []];
    }

    return [{ affectedRows: 0 }, []];
  }

  public async commit(): Promise<void> {
    this.commitCallCount += 1;
    this.db.committedIdentityInserts.push(...this.pendingIdentityInserts);
    this.db.committedAuditEventInserts.push(...this.pendingAuditEventInserts);
    this.pendingIdentityInserts = [];
    this.pendingAuditEventInserts = [];
  }

  public async rollback(): Promise<void> {
    this.rollbackCallCount += 1;
    // Descarta tudo que estava pendente nesta transação — nada é
    // promovido para FakeTransactionalDatabase.
    this.pendingIdentityInserts = [];
    this.pendingAuditEventInserts = [];
  }

  public release(): void {
    this.releaseCallCount += 1;
  }
}

/**
 * Fake compatível estruturalmente com `Pool` de mysql2/promise — apenas
 * `getConnection()`, que é tudo que `MariaDbUnitOfWork` usa.
 */
export class FakeTransactionalPool {
  public readonly connectionsCreated: FakeTransactionalConnection[] = [];

  public constructor(
    private readonly db: FakeTransactionalDatabase,
    private readonly failureConfig: FakeFailureConfig = {}
  ) {}

  public async getConnection(): Promise<FakeTransactionalConnection> {
    const connection = new FakeTransactionalConnection(this.db, this.failureConfig);
    this.connectionsCreated.push(connection);
    return connection;
  }
}
