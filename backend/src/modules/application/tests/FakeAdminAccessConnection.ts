import type {
  BootstrapConnection,
  BootstrapConnectionPool
} from "../../identity/application/BootstrapFirstIdentityService.js";

/**
 * Fake de conexão física única — nunca abre rede/MariaDB real. Modela
 * exatamente o suficiente de `applications`/`identities`/
 * `application_accesses`/`audit_events`/`GET_LOCK`/`RELEASE_LOCK` para
 * exercitar `BootstrapFirstApplicationAccessService` de ponta a ponta,
 * incluindo os cenários de falha exigidos (task v0.5.0, seção 20).
 *
 * Mesmo padrão já usado em
 * `modules/identity/tests/BootstrapFirstIdentityService.test.ts` — a
 * `timeline` nomeada prova ORDEM exata (não só contagem) entre
 * GET_LOCK/BEGIN/SELECT/INSERT/COMMIT/ROLLBACK/RELEASE_LOCK/release().
 */
export class FakeAdminAccessConnection implements BootstrapConnection {
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  public readonly timeline: string[] = [];

  public beginTransactionCallCount = 0;
  public commitCallCount = 0;
  public rollbackCallCount = 0;
  public releaseCallCount = 0;
  public getLockCallCount = 0;
  public releaseLockCallCount = 0;

  public lockAcquisitionResult: 1 | 0 = 1;
  public failApplicationAccessInsert = false;
  public failAuditInsert = false;

  /** Application seedada — por padrão, PCTEC_INGRESSA existe (cenário comum). */
  public applicationRow:
    | { id: number; public_id: string; code: string; name: string; status: string; version: number; created_at: Date; updated_at: Date }
    | undefined = {
    id: 1,
    public_id: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
    code: "PCTEC_INGRESSA",
    name: "PCTEC Ingressa",
    status: "ACTIVE",
    version: 1,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z")
  };

  /** Identity existente — por padrão, a Identity informada é encontrada. */
  public identityExists = true;

  /** Já existe ADMIN concedido para a aplicação (guard one-shot). */
  public adminAlreadyGrantedForApplication = false;

  /** Já existe concessão duplicada para a mesma tripla identidade/aplicação/perfil. */
  public duplicateForIdentity = false;

  private nextInsertId = 1;

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
    if (normalized.includes("FROM APPLICATIONS") && normalized.includes("WHERE CODE = ?")) {
      this.timeline.push("SELECT_APPLICATION");
      return [this.applicationRow === undefined ? [] : [this.applicationRow], []];
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
            full_name: "Identity Fundacional",
            email: "fundador@example.com",
            email_normalized: "fundador@example.com",
            cpf: null,
            cpf_normalized: null,
            status: "PENDING",
            login_enabled: 0,
            version: 1,
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
    if (
      normalized.includes("FROM APPLICATION_ACCESSES") &&
      normalized.includes("APPLICATION_PUBLIC_ID = ?") &&
      normalized.includes("ACCESS_PROFILE = ?") &&
      !normalized.includes("IDENTITY_PUBLIC_ID = ?")
    ) {
      this.timeline.push("SELECT_APPLICATION_ACCESS_BY_APPLICATION");
      return [this.adminAlreadyGrantedForApplication ? [{ 1: 1 }] : [], []];
    }
    if (
      normalized.includes("FROM APPLICATION_ACCESSES") &&
      normalized.includes("IDENTITY_PUBLIC_ID = ?") &&
      normalized.includes("APPLICATION_PUBLIC_ID = ?") &&
      normalized.includes("ACCESS_PROFILE = ?")
    ) {
      this.timeline.push("SELECT_APPLICATION_ACCESS_BY_IDENTITY");
      return [this.duplicateForIdentity ? [{ 1: 1 }] : [], []];
    }
    if (normalized.startsWith("INSERT INTO APPLICATION_ACCESSES")) {
      if (this.failApplicationAccessInsert) {
        this.timeline.push("INSERT_APPLICATION_ACCESS_FAILED");
        throw new Error("ER_SIMULATED: falha ao inserir application_access (mensagem de driver simulada)");
      }
      const insertId = this.nextInsertId;
      this.nextInsertId += 1;
      this.timeline.push("INSERT_APPLICATION_ACCESS");
      return [{ insertId, affectedRows: 1 }, []];
    }
    if (normalized.startsWith("INSERT INTO AUDIT_EVENTS")) {
      if (this.failAuditInsert) {
        this.timeline.push("INSERT_AUDIT_FAILED");
        throw new Error("ER_SIMULATED: falha ao inserir audit_event (mensagem de driver simulada)");
      }
      this.timeline.push("INSERT_AUDIT");
      return [{ affectedRows: 1 }, []];
    }
    // Nunca deve chegar aqui em nenhum cenário de teste desta suíte —
    // qualquer SQL de Credential/Session/etc. cairia aqui, provando que
    // nenhuma dessas tabelas é tocada por este serviço.
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

export class FakeAdminAccessConnectionPool implements BootstrapConnectionPool {
  public readonly connectionsAcquired: FakeAdminAccessConnection[] = [];

  public constructor(private readonly factory: () => FakeAdminAccessConnection) {}

  public async getConnection(): Promise<FakeAdminAccessConnection> {
    const connection = this.factory();
    this.connectionsAcquired.push(connection);
    return connection;
  }
}
