import type {
  BootstrapConnection,
  BootstrapConnectionPool
} from "../../identity/application/BootstrapFirstIdentityService.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const SESSION_PUBLIC_ID = "22222222-2222-2222-2222-222222222222";

/**
 * Fake de conexão física única para `LogoutService` — nunca abre
 * rede/MariaDB real. Modela `sessions`/`identities`/`audit_events` o
 * suficiente para provar a timeline completa, incluindo os cenários de
 * falha exigidos. Mesmo padrão de `FakeLoginConnection` (Fase D).
 */
export class FakeLogoutConnection implements BootstrapConnection {
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  public readonly timeline: string[] = [];

  public beginTransactionCallCount = 0;
  public commitCallCount = 0;
  public rollbackCallCount = 0;
  public releaseCallCount = 0;

  public sessionExists = true;
  public sessionStatus = "ACTIVE";
  public sessionExpiresAt = new Date("2099-01-01T00:00:00Z");
  public sessionVersion = 1;

  public identityExists = true;
  public identityStatus = "ACTIVE";
  public identityLoginEnabled = true;

  public failSessionUpdate = false;
  public failAuditInsert = false;

  private auditInsertCount = 0;

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.calls.push({ sql, params });
    const normalized = sql.trim().toUpperCase();

    if (normalized.includes("FROM SESSIONS") && normalized.includes("TOKEN_HASH = ?")) {
      this.timeline.push("SELECT_SESSION");
      if (!this.sessionExists) {
        return [[], []];
      }
      return [
        [
          {
            id: 1,
            public_id: SESSION_PUBLIC_ID,
            identity_public_id: IDENTITY_PUBLIC_ID,
            token_hash: "a".repeat(64),
            status: this.sessionStatus,
            created_at: new Date("2026-01-01T00:00:00Z"),
            expires_at: this.sessionExpiresAt,
            last_seen_at: null,
            revoked_at: null,
            revocation_reason: null,
            version: this.sessionVersion
          }
        ],
        []
      ];
    }

    if (normalized.includes("FROM IDENTITIES") && normalized.includes("PUBLIC_ID = ?")) {
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

    if (normalized.startsWith("UPDATE SESSIONS")) {
      if (this.failSessionUpdate) {
        this.timeline.push("UPDATE_SESSION_FAILED");
        throw new Error("ER_SIMULATED: falha ao atualizar session (mensagem de driver simulada)");
      }
      this.timeline.push("UPDATE_SESSION");
      // Stateful: reflete a revogação em SELECT_SESSION subsequentes na
      // MESMA conexão — necessário para provar "mesmo token depois ->
      // 401" de ponta a ponta (revisão da Fase E, task seção 29, item
      // 32), sem precisar de um MariaDB real.
      this.sessionStatus = "REVOKED";
      this.sessionVersion += 1;
      return [{ affectedRows: 1 }, []];
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

export class FakeLogoutConnectionPool implements BootstrapConnectionPool {
  public readonly connectionsAcquired: FakeLogoutConnection[] = [];

  public constructor(private readonly factory: () => FakeLogoutConnection) {}

  public async getConnection(): Promise<FakeLogoutConnection> {
    const connection = this.factory();
    this.connectionsAcquired.push(connection);
    return connection;
  }
}
