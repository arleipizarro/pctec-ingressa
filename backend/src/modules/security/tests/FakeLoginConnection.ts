import type {
  BootstrapConnection,
  BootstrapConnectionPool
} from "../../identity/application/BootstrapFirstIdentityService.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const REAL_PASSWORD_HASH_PHC = "$argon2id$v=19$m=65536,p=4,t=3$c29tZXNhbHR2YWx1ZQ$c29tZWhhc2h2YWx1ZTEyMzQ1Ng";

/**
 * Fake de conexão física única para `LoginService` — nunca abre
 * rede/MariaDB real. Modela `identities`/`credentials`/`sessions`/
 * `audit_events` o suficiente para provar a timeline completa,
 * incluindo os cenários de falha exigidos. Mesmo padrão de
 * `FakeCredentialConnection` (v0.5.x).
 */
export class FakeLoginConnection implements BootstrapConnection {
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  public readonly timeline: string[] = [];

  public beginTransactionCallCount = 0;
  public commitCallCount = 0;
  public rollbackCallCount = 0;
  public releaseCallCount = 0;

  public identityExists = true;
  public identityStatus = "ACTIVE";
  public identityLoginEnabled = true;

  public credentialExists = true;
  public credentialStatus = "ACTIVE";
  public credentialVersion = 1;

  public failCredentialUpdate = false;
  public failSessionInsert = false;
  public failAuditInsert = false;

  private nextSessionInsertId = 1;
  private auditInsertCount = 0;

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.calls.push({ sql, params });
    const normalized = sql.trim().toUpperCase();

    if (normalized.includes("FROM IDENTITIES") && normalized.includes("EMAIL_NORMALIZED = ?")) {
      this.timeline.push("SELECT_IDENTITY");
      if (!this.identityExists) {
        return [[], []];
      }
      return [
        [
          {
            id: 1,
            public_id: IDENTITY_PUBLIC_ID,
            type: "HUMAN",
            full_name: "Pessoa de Teste",
            email: "pessoa@example.com",
            email_normalized: "pessoa@example.com",
            cpf: null,
            cpf_normalized: null,
            status: this.identityStatus,
            login_enabled: this.identityLoginEnabled ? 1 : 0,
            version: 3,
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

    if (normalized.includes("FROM CREDENTIALS") && normalized.includes("IDENTITY_PUBLIC_ID = ?")) {
      this.timeline.push("SELECT_CREDENTIAL");
      if (!this.credentialExists) {
        return [[], []];
      }
      return [
        [
          {
            id: 1,
            public_id: "55555555-5555-5555-5555-555555555555",
            identity_public_id: IDENTITY_PUBLIC_ID,
            type: "LOCAL_PASSWORD",
            password_hash: REAL_PASSWORD_HASH_PHC,
            status: this.credentialStatus,
            last_authenticated_at: null,
            version: this.credentialVersion,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ];
    }

    if (normalized.startsWith("UPDATE CREDENTIALS")) {
      if (this.failCredentialUpdate) {
        this.timeline.push("UPDATE_CREDENTIAL_FAILED");
        throw new Error("ER_SIMULATED: falha ao atualizar credential (mensagem de driver simulada)");
      }
      this.timeline.push("UPDATE_CREDENTIAL");
      return [{ affectedRows: 1 }, []];
    }

    if (normalized.startsWith("INSERT INTO SESSIONS")) {
      if (this.failSessionInsert) {
        this.timeline.push("INSERT_SESSION_FAILED");
        throw new Error("ER_SIMULATED: falha ao inserir session (mensagem de driver simulada)");
      }
      const insertId = this.nextSessionInsertId;
      this.nextSessionInsertId += 1;
      this.timeline.push("INSERT_SESSION");
      return [{ insertId, affectedRows: 1 }, []];
    }

    if (normalized.startsWith("INSERT INTO AUDIT_EVENTS")) {
      this.auditInsertCount += 1;
      if (this.failAuditInsert) {
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

export class FakeLoginConnectionPool implements BootstrapConnectionPool {
  public readonly connectionsAcquired: FakeLoginConnection[] = [];

  public constructor(private readonly factory: () => FakeLoginConnection) {}

  public async getConnection(): Promise<FakeLoginConnection> {
    const connection = this.factory();
    this.connectionsAcquired.push(connection);
    return connection;
  }
}
