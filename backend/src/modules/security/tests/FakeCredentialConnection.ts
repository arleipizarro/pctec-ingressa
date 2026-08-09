import type {
  BootstrapConnection,
  BootstrapConnectionPool
} from "../../identity/application/BootstrapFirstIdentityService.js";

/**
 * Fake de conexão física única — nunca abre rede/MariaDB real. Modela o
 * suficiente de `credentials`/`identities`/`audit_events`/`GET_LOCK`/
 * `RELEASE_LOCK` para exercitar `BootstrapFirstCredentialService` de
 * ponta a ponta, incluindo os cenários de falha exigidos.
 *
 * Mesmo padrão já usado em
 * `modules/application/tests/FakeAdminAccessConnection.ts` — a
 * `timeline` nomeada prova ORDEM exata entre
 * GET_LOCK/BEGIN/CHECK/SELECT/INSERT/UPDATE/COMMIT/ROLLBACK/
 * RELEASE_LOCK/release().
 */
export class FakeCredentialConnection implements BootstrapConnection {
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  public readonly timeline: string[] = [];

  public beginTransactionCallCount = 0;
  public commitCallCount = 0;
  public rollbackCallCount = 0;
  public releaseCallCount = 0;
  public getLockCallCount = 0;
  public releaseLockCallCount = 0;

  public lockAcquisitionResult: 1 | 0 = 1;
  public failCredentialInsert = false;
  public failIdentityUpdate = false;
  public failAuditInsert = false;
  public failAuditInsertOnIndex: number | undefined = undefined;
  private auditInsertCount = 0;

  /** Já existe QUALQUER Credential LOCAL_PASSWORD na plataforma (guard global). */
  public anyCredentialExists = false;

  /** Identity existente — por padrão, a Identity informada é encontrada, PENDING, loginEnabled=false. */
  public identityExists = true;
  public identityStatus = "PENDING";
  public identityLoginEnabled = false;
  public identityVersion = 1;

  private nextCredentialInsertId = 1;

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.calls.push({ sql, params });
    const normalized = sql.trim().toUpperCase();

    if (normalized.startsWith("SELECT GET_LOCK")) {
      this.getLockCallCount += 1;
      this.timeline.push("GET_LOCK");
      return [[{ acquired: this.lockAcquisitionResult }], []];
    }
    if (normalized.startsWith("SELECT RELEASE_LOCK")) {
      this.releaseLockCallCount += 1;
      this.timeline.push("RELEASE_LOCK");
      return [[{ released: 1 }], []];
    }
    if (normalized.startsWith("SELECT 1 FROM CREDENTIALS")) {
      this.timeline.push("CHECK_BOOTSTRAP");
      return [this.anyCredentialExists ? [{ 1: 1 }] : [], []];
    }
    if (normalized.includes("FROM IDENTITIES") && normalized.includes("WHERE PUBLIC_ID = ?")) {
      this.timeline.push("SELECT_IDENTITY");
      if (!this.identityExists) {
        return [[], []];
      }
      const identityPublicId = String(params?.[0]);
      return [
        [
          {
            id: 1,
            public_id: identityPublicId,
            type: "HUMAN",
            full_name: "Identity Fixture",
            email: "fixture@example.com",
            email_normalized: "fixture@example.com",
            cpf: null,
            cpf_normalized: null,
            status: this.identityStatus,
            login_enabled: this.identityLoginEnabled ? 1 : 0,
            version: this.identityVersion,
            created_at: new Date("2026-01-01T00:00:00Z"),
            created_by_identity_public_id: null,
            updated_at: new Date("2026-01-01T00:00:00Z"),
            updated_by_identity_public_id: null,
            deleted_at: null,
            deleted_by_identity_public_id: null,
            deletion_reason: null
          }
        ],
        []
      ];
    }
    if (normalized.startsWith("INSERT INTO CREDENTIALS")) {
      if (this.failCredentialInsert) {
        this.timeline.push("INSERT_CREDENTIAL_FAILED");
        throw new Error("ER_SIMULATED: falha ao inserir credential (mensagem de driver simulada)");
      }
      const insertId = this.nextCredentialInsertId;
      this.nextCredentialInsertId += 1;
      this.timeline.push("INSERT_CREDENTIAL");
      return [{ insertId, affectedRows: 1 }, []];
    }
    if (normalized.startsWith("UPDATE IDENTITIES")) {
      if (this.failIdentityUpdate) {
        this.timeline.push("UPDATE_IDENTITY_FAILED");
        throw new Error("ER_SIMULATED: falha ao atualizar identity (mensagem de driver simulada)");
      }
      this.timeline.push("UPDATE_IDENTITY");
      return [{ affectedRows: 1 }, []];
    }
    if (normalized.startsWith("INSERT INTO AUDIT_EVENTS")) {
      this.auditInsertCount += 1;
      const shouldFail =
        this.failAuditInsert ||
        (this.failAuditInsertOnIndex !== undefined && this.auditInsertCount === this.failAuditInsertOnIndex);
      if (shouldFail) {
        this.timeline.push(`INSERT_AUDIT_FAILED_${this.auditInsertCount}`);
        throw new Error("ER_SIMULATED: falha ao inserir audit_event (mensagem de driver simulada)");
      }
      this.timeline.push(`INSERT_AUDIT_${this.auditInsertCount}`);
      return [{ affectedRows: 1 }, []];
    }
    this.timeline.push(`UNEXPECTED_SQL: ${sql.slice(0, 40)}`);
    return [[], []];
  }

  public async beginTransaction(): Promise<void> {
    this.beginTransactionCallCount += 1;
    this.timeline.push("BEGIN");
  }

  public async commit(): Promise<void> {
    this.commitCallCount += 1;
    this.timeline.push("COMMIT");
  }

  public async rollback(): Promise<void> {
    this.rollbackCallCount += 1;
    this.timeline.push("ROLLBACK");
  }

  public release(): void {
    this.releaseCallCount += 1;
    this.timeline.push("RELEASE_CONNECTION");
  }
}

export class FakeCredentialConnectionPool implements BootstrapConnectionPool {
  public readonly connectionsAcquired: FakeCredentialConnection[] = [];

  public constructor(private readonly factory: () => FakeCredentialConnection) {}

  public async getConnection(): Promise<FakeCredentialConnection> {
    const connection = this.factory();
    this.connectionsAcquired.push(connection);
    return connection;
  }
}
