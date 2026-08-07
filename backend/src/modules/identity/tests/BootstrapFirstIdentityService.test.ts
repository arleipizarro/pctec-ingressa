import { describe, it, expect } from "vitest";
import {
  BootstrapFirstIdentityService,
  type BootstrapConnection,
  type BootstrapConnectionPool
} from "../application/BootstrapFirstIdentityService.js";
import { BootstrapAlreadyCompletedError, BootstrapLockNotAcquiredError } from "../application/errors/BootstrapErrors.js";
import { MariaDbIdentityRepository } from "../infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";

/**
 * Fake de conexão física única — nunca abre rede/MariaDB real. Modela
 * exatamente o suficiente de `identities`/`audit_events`/`GET_LOCK`/
 * `RELEASE_LOCK` para exercitar `BootstrapFirstIdentityService` de ponta
 * a ponta, incluindo os cenários de falha exigidos (seção 17 do prompt
 * de implementação).
 */
class FakeBootstrapConnection implements BootstrapConnection {
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  /**
   * Linha do tempo de eventos NOMEADOS — usada especificamente para
   * provar ORDEM exata (não só contagem) entre GET_LOCK/BEGIN/COUNT/
   * INSERT/COMMIT/ROLLBACK/RELEASE_LOCK/release(), exigida pela auditoria
   * crítica desta revisão.
   */
  public readonly timeline: string[] = [];
  public beginTransactionCallCount = 0;
  public commitCallCount = 0;
  public rollbackCallCount = 0;
  public releaseCallCount = 0;
  public getLockCallCount = 0;
  public releaseLockCallCount = 0;

  public lockAcquisitionResult: 1 | 0 = 1;
  public failIdentityInsert = false;
  public failAuditInsert = false;

  private identitiesCount: number;
  private nextInsertId = 1;

  public constructor(initialIdentitiesCount = 0) {
    this.identitiesCount = initialIdentitiesCount;
  }

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
    if (normalized.includes("COUNT(*)") && normalized.includes("FROM IDENTITIES")) {
      this.timeline.push("COUNT");
      return [[{ total: this.identitiesCount }], []];
    }
    if (normalized.startsWith("INSERT INTO IDENTITIES")) {
      if (this.failIdentityInsert) {
        this.timeline.push("INSERT_IDENTITY_FAILED");
        throw new Error("ER_SIMULATED: falha ao inserir identity (mensagem de driver simulada)");
      }
      this.identitiesCount += 1;
      const insertId = this.nextInsertId;
      this.nextInsertId += 1;
      this.timeline.push("INSERT_IDENTITY");
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

class FakeBootstrapConnectionPool implements BootstrapConnectionPool {
  public readonly connectionsAcquired: FakeBootstrapConnection[] = [];

  public constructor(private readonly factory: () => FakeBootstrapConnection) {}

  public async getConnection(): Promise<FakeBootstrapConnection> {
    const connection = this.factory();
    this.connectionsAcquired.push(connection);
    return connection;
  }
}

function createService(connection: FakeBootstrapConnection): { service: BootstrapFirstIdentityService; pool: FakeBootstrapConnectionPool } {
  const pool = new FakeBootstrapConnectionPool(() => connection);
  const service = new BootstrapFirstIdentityService(
    pool,
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn)
  );
  return { service, pool };
}

const VALID_REQUEST = { fullName: "Fundador da Plataforma", email: "fundador@example.com" };

describe("BootstrapFirstIdentityService — sucesso", () => {
  it("1. bootstrap bem-sucedido retorna publicId, status PENDING, loginEnabled false", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    const result = await service.execute(VALID_REQUEST);

    expect(result.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.status).toBe("PENDING");
    expect(result.loginEnabled).toBe(false);
  });

  it("2. count=0 permite o bootstrap", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).resolves.toBeDefined();
  });
});

describe("BootstrapFirstIdentityService — guard one-shot", () => {
  it("3. count>0 bloqueia com BOOTSTRAP_ALREADY_COMPLETED, sem inserir nada", async () => {
    const connection = new FakeBootstrapConnection(1);
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapAlreadyCompletedError);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES"))).toBe(false);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("22. segunda execução (nova chamada de execute, count já > 0) é bloqueada", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST); // primeira: sucesso, incrementa count internamente
    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapAlreadyCompletedError);
  });
});

describe("BootstrapFirstIdentityService — named lock", () => {
  it("4. lock recusado (GET_LOCK retorna 0) lança BootstrapLockNotAcquiredError, nunca tenta contar/inserir", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapLockNotAcquiredError);
    expect(connection.beginTransactionCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().includes("COUNT(*)"))).toBe(false);
  });

  it("não chama RELEASE_LOCK quando o lock nunca foi adquirido", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapLockNotAcquiredError);
    expect(connection.releaseLockCallCount).toBe(0);
  });

  it("9. RELEASE_LOCK é chamado exatamente uma vez em caso de sucesso", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(connection.releaseLockCallCount).toBe(1);
  });

  it("RELEASE_LOCK é chamado exatamente uma vez mesmo em erro (bootstrap já concluído)", async () => {
    const connection = new FakeBootstrapConnection(1);
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapAlreadyCompletedError);
    expect(connection.releaseLockCallCount).toBe(1);
  });
});

describe("BootstrapFirstIdentityService — conexão física única", () => {
  it("5. adquire exatamente UMA conexão do pool por chamada de execute()", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service, pool } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(pool.connectionsAcquired.length).toBe(1);
  });

  it("GET_LOCK, COUNT, INSERT Identity, INSERT AuditEvent e RELEASE_LOCK passam todos pela MESMA conexão", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const sqlTexts = connection.calls.map((c) => c.sql.toUpperCase());
    expect(sqlTexts.some((s) => s.includes("GET_LOCK"))).toBe(true);
    expect(sqlTexts.some((s) => s.includes("COUNT(*)"))).toBe(true);
    expect(sqlTexts.some((s) => s.startsWith("INSERT INTO IDENTITIES"))).toBe(true);
    expect(sqlTexts.some((s) => s.startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(true);
    expect(sqlTexts.some((s) => s.includes("RELEASE_LOCK"))).toBe(true);
  });

  it("10. connection.release() é chamado exatamente uma vez, mesmo em sucesso", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(connection.releaseCallCount).toBe(1);
  });

  it("connection.release() é chamado exatamente uma vez mesmo quando o lock falha (setup parcial)", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapLockNotAcquiredError);
    expect(connection.releaseCallCount).toBe(1);
  });
});

describe("BootstrapFirstIdentityService — transação", () => {
  it("6. beginTransaction é chamado exatamente uma vez", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(connection.beginTransactionCallCount).toBe(1);
  });

  it("7. commit é chamado exatamente uma vez em caso de sucesso", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(connection.commitCallCount).toBe(1);
    expect(connection.rollbackCallCount).toBe(0);
  });

  it("8. rollback é chamado exatamente uma vez quando count > 0 (erro após BEGIN)", async () => {
    const connection = new FakeBootstrapConnection(1);
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapAlreadyCompletedError);

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });

  it("rollback nunca é chamado quando o erro ocorre ANTES do BEGIN (lock recusado)", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapLockNotAcquiredError);
    expect(connection.rollbackCallCount).toBe(0);
  });
});

describe("BootstrapFirstIdentityService — Identity criada corretamente", () => {
  it("11. Identity é criada com type=HUMAN", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const insertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES"));
    expect(insertCall?.params?.[1]).toBe("HUMAN");
  });

  it("12. loginEnabled persistido é false (0)", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const insertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES"));
    expect(insertCall?.params?.[8]).toBe(0);
  });

  it("13. created_by_identity_public_id persistido é NULL — nunca um marcador", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const insertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES"));
    // created_by_identity_public_id é o 12º parâmetro posicional do INSERT (índice 11).
    expect(insertCall?.params?.[11]).toBeNull();
    expect(insertCall?.params).not.toContain("BOOTSTRAP");
  });

  it("14. AuditEvent gravado tem actor_public_id = 'BOOTSTRAP'", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const auditInsertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    expect(auditInsertCall?.params?.[4]).toBe("BOOTSTRAP"); // actor_public_id é o 5º parâmetro (índice 4).
  });

  it("15. event_type gravado é identity.created", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const auditInsertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    expect(auditInsertCall?.params?.[1]).toBe("identity.created");
  });

  it("16. nenhuma tabela/comando relacionado a Credential é tocado", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(connection.calls.some((c) => c.sql.toLowerCase().includes("credential"))).toBe(false);
  });

  it("17. nenhuma tabela/comando relacionado a ApplicationAccess é tocado", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(connection.calls.some((c) => c.sql.toLowerCase().includes("application_access"))).toBe(false);
  });

  it("exatamente 1 linha inserida em identities e 1 em audit_events por bootstrap", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const identityInserts = connection.calls.filter((c) => c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES"));
    const auditInserts = connection.calls.filter((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    expect(identityInserts).toHaveLength(1);
    expect(auditInserts).toHaveLength(1);
  });
});

describe("BootstrapFirstIdentityService — ORDEM exata lock/transação (auditoria crítica)", () => {
  it("sucesso: a ordem exata é GET_LOCK → BEGIN → COUNT → INSERT_IDENTITY → INSERT_AUDIT → COMMIT → RELEASE_LOCK → RELEASE_CONNECTION", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "COUNT",
      "INSERT_IDENTITY",
      "INSERT_AUDIT",
      "COMMIT",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
  });

  it("RELEASE_LOCK nunca ocorre antes do COMMIT (prova por posição no array, não só por contagem)", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const commitIndex = connection.timeline.indexOf("COMMIT");
    const releaseLockIndex = connection.timeline.indexOf("RELEASE_LOCK");
    expect(commitIndex).toBeGreaterThan(-1);
    expect(releaseLockIndex).toBeGreaterThan(commitIndex);
  });

  it("falha após BEGIN (count > 0): a ordem exata é GET_LOCK → BEGIN → COUNT → ROLLBACK → RELEASE_LOCK → RELEASE_CONNECTION — nunca COMMIT", async () => {
    const connection = new FakeBootstrapConnection(1);
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapAlreadyCompletedError);

    expect(connection.timeline).toEqual(["GET_LOCK", "BEGIN", "COUNT", "ROLLBACK", "RELEASE_LOCK", "RELEASE_CONNECTION"]);
    expect(connection.timeline).not.toContain("COMMIT");
  });

  it("RELEASE_LOCK nunca ocorre antes do ROLLBACK, no caminho de erro (prova por posição)", async () => {
    const connection = new FakeBootstrapConnection(1);
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapAlreadyCompletedError);

    const rollbackIndex = connection.timeline.indexOf("ROLLBACK");
    const releaseLockIndex = connection.timeline.indexOf("RELEASE_LOCK");
    expect(rollbackIndex).toBeGreaterThan(-1);
    expect(releaseLockIndex).toBeGreaterThan(rollbackIndex);
  });

  it("falha ao inserir AuditEvent: ordem exata inclui INSERT_IDENTITY antes de INSERT_AUDIT_FAILED, depois ROLLBACK, nunca COMMIT", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failAuditInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow();

    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "COUNT",
      "INSERT_IDENTITY",
      "INSERT_AUDIT_FAILED",
      "ROLLBACK",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
  });

  it("falha ao inserir Identity: ordem exata pula direto para ROLLBACK, nunca chega a INSERT_AUDIT", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failIdentityInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow();

    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "COUNT",
      "INSERT_IDENTITY_FAILED",
      "ROLLBACK",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
  });

  it("lock recusado: ordem exata é só GET_LOCK → RELEASE_CONNECTION — nunca BEGIN, nunca RELEASE_LOCK", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(BootstrapLockNotAcquiredError);

    expect(connection.timeline).toEqual(["GET_LOCK", "RELEASE_CONNECTION"]);
  });

  it("connection.release() ocorre exatamente uma vez, sempre como o ÚLTIMO evento da linha do tempo, em todos os cenários", async () => {
    const successConn = new FakeBootstrapConnection(0);
    await createService(successConn).service.execute(VALID_REQUEST);
    expect(successConn.timeline.at(-1)).toBe("RELEASE_CONNECTION");
    expect(successConn.timeline.filter((e) => e === "RELEASE_CONNECTION")).toHaveLength(1);

    const alreadyCompletedConn = new FakeBootstrapConnection(1);
    await createService(alreadyCompletedConn).service.execute(VALID_REQUEST).catch(() => undefined);
    expect(alreadyCompletedConn.timeline.at(-1)).toBe("RELEASE_CONNECTION");
    expect(alreadyCompletedConn.timeline.filter((e) => e === "RELEASE_CONNECTION")).toHaveLength(1);

    const lockRefusedConn = new FakeBootstrapConnection(0);
    lockRefusedConn.lockAcquisitionResult = 0;
    await createService(lockRefusedConn).service.execute(VALID_REQUEST).catch(() => undefined);
    expect(lockRefusedConn.timeline.at(-1)).toBe("RELEASE_CONNECTION");
    expect(lockRefusedConn.timeline.filter((e) => e === "RELEASE_CONNECTION")).toHaveLength(1);
  });
});

describe("BootstrapFirstIdentityService — atomicidade (auditoria crítica, seção 5)", () => {
  it("sucesso: Identity e AuditEvent são commitados JUNTOS — um único COMMIT, depois de ambos os INSERTs", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service } = createService(connection);

    await service.execute(VALID_REQUEST);

    const identityIndex = connection.timeline.indexOf("INSERT_IDENTITY");
    const auditIndex = connection.timeline.indexOf("INSERT_AUDIT");
    const commitIndex = connection.timeline.indexOf("COMMIT");
    expect(identityIndex).toBeLessThan(auditIndex);
    expect(auditIndex).toBeLessThan(commitIndex);
    expect(connection.commitCallCount).toBe(1);
  });

  it("falha no INSERT de Identity: AuditEvent nunca é tentado, e rollback ocorre (não commit parcial)", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failIdentityInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow();

    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });

  it("falha no INSERT de AuditEvent: a Identity NÃO permanece commitada — rollback desfaz a transação inteira", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failAuditInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow();

    expect(connection.commitCallCount).toBe(0);
    expect(connection.rollbackCallCount).toBe(1);
    // A prova de que "não permanece commitada" é o próprio commitCallCount
    // === 0 combinado com rollbackCallCount === 1 sobre a MESMA conexão/
    // transação — não há um segundo caminho de persistência (nenhuma
    // conexão adicional é aberta pelos repositories, ver teste abaixo).
  });

  it("nenhuma conexão secundária é aberta pelos repositories — MariaDbIdentityRepository/MariaDbAuditEventRepository recebem a MESMA conexão do serviço, nunca chamam pool.getConnection() por conta própria", async () => {
    const connection = new FakeBootstrapConnection(0);
    const { service, pool } = createService(connection);

    await service.execute(VALID_REQUEST);

    // Só o BootstrapFirstIdentityService chama pool.getConnection() — os
    // repositories são construídos via factory sobre essa MESMA conexão
    // (ver identityRepositoryFactory/auditEventRepositoryFactory no
    // service), nunca recebem o pool diretamente.
    expect(pool.connectionsAcquired).toHaveLength(1);
  });
});

describe("BootstrapFirstIdentityService — falhas parciais (23, 24, 25)", () => {
  it("23. falha ao inserir AuditEvent reverte (rollback) a Identity já inserida na mesma transação", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failAuditInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(/falha ao inserir audit_event/);

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES"))).toBe(true);
  });

  it("24. falha ao inserir Identity nunca chega a tentar inserir AuditEvent", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failIdentityInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow(/falha ao inserir identity/);

    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
    expect(connection.rollbackCallCount).toBe(1);
  });

  it("25. erro de driver simulado nunca adiciona dado sensível (env/senha) à mensagem", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failIdentityInsert = true;
    const { service } = createService(connection);

    try {
      await service.execute(VALID_REQUEST);
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as Error).message).not.toMatch(/DB_PASSWORD|password\s*=/i);
    }
  });

  it("lock é liberado e conexão é liberada mesmo quando a transação falha por erro de driver", async () => {
    const connection = new FakeBootstrapConnection(0);
    connection.failIdentityInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(VALID_REQUEST)).rejects.toThrow();

    expect(connection.releaseLockCallCount).toBe(1);
    expect(connection.releaseCallCount).toBe(1);
  });
});
