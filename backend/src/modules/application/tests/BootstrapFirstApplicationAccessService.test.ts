import { describe, it, expect } from "vitest";
import { BootstrapFirstApplicationAccessService } from "../application/BootstrapFirstApplicationAccessService.js";
import {
  ApplicationAccessBootstrapAlreadyCompletedError,
  ApplicationAccessLockNotAcquiredError
} from "../application/errors/ApplicationAccessBootstrapErrors.js";
import { ApplicationNotFoundError, IdentityNotFoundForAccessError } from "../domain/errors/ApplicationErrors.js";
import { MariaDbApplicationRepository } from "../infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { FakeAdminAccessConnection, FakeAdminAccessConnectionPool } from "./FakeAdminAccessConnection.js";

const VALID_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

function createService(connection: FakeAdminAccessConnection): {
  service: BootstrapFirstApplicationAccessService;
  pool: FakeAdminAccessConnectionPool;
} {
  const pool = new FakeAdminAccessConnectionPool(() => connection);
  const service = new BootstrapFirstApplicationAccessService(
    pool,
    (conn) => new MariaDbApplicationRepository(conn),
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbApplicationAccessRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn)
  );
  return { service, pool };
}

describe("BootstrapFirstApplicationAccessService — sucesso", () => {
  it("1. Application PCTEC_INGRESSA é encontrada e usada na concessão", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    const result = await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(result.applicationPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000001");
    expect(connection.calls.some((c) => c.sql.toUpperCase().includes("FROM APPLICATIONS"))).toBe(true);
  });

  it("3. Identity existente é encontrada antes da concessão", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.identityExists = true;
    const { service } = createService(connection);

    const result = await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(result.identityPublicId).toBe(VALID_IDENTITY_PUBLIC_ID);
  });

  it("5. ADMIN é o accessProfile válido resultante", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    const result = await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(result.accessProfile).toBe("ADMIN");
  });

  it("7. primeira concessão tem sucesso e retorna os dados esperados", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    const result = await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(result.applicationAccessPublicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.identityPublicId).toBe(VALID_IDENTITY_PUBLIC_ID);
    expect(result.applicationPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000001");
    expect(result.accessProfile).toBe("ADMIN");
  });
});

describe("BootstrapFirstApplicationAccessService — Application/Identity ausentes", () => {
  it("Application PCTEC_INGRESSA ausente bloqueia com APPLICATION_NOT_FOUND", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.applicationRow = undefined;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow(
      ApplicationNotFoundError
    );
  });

  it("4. Identity inexistente bloqueia com IDENTITY_NOT_FOUND, sem inserir nada", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.identityExists = false;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow(
      IdentityNotFoundForAccessError
    );
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO APPLICATION_ACCESSES"))).toBe(
      false
    );
  });
});

describe("BootstrapFirstApplicationAccessService — perfil", () => {
  it("6. perfil inválido é rejeitado pelo Value Object antes de qualquer acesso a repositório", async () => {
    const { AccessProfile, ApplicationAccessInvalidProfileError } = await import(
      "../domain/value-objects/AccessProfile.js"
    );
    expect(() => AccessProfile.create("SUPERUSER")).toThrow(ApplicationAccessInvalidProfileError);
    expect(() => AccessProfile.create("ADMIN")).not.toThrow();
  });
});

describe("BootstrapFirstApplicationAccessService — guard one-shot", () => {
  it("8. segunda concessão (ADMIN já concedido para a aplicação) é bloqueada, sem inserir nada", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.adminAlreadyGrantedForApplication = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow(
      ApplicationAccessBootstrapAlreadyCompletedError
    );
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO APPLICATION_ACCESSES"))).toBe(
      false
    );
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("9. duplicidade para a mesma identity/aplicação/perfil é bloqueada", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.duplicateForIdentity = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow(
      ApplicationAccessBootstrapAlreadyCompletedError
    );
  });

  it("27. segunda execução de execute() (nova chamada, ADMIN já concedido) é bloqueada", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID }); // primeira: sucesso
    connection.adminAlreadyGrantedForApplication = true; // simula estado após commit
    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow(
      ApplicationAccessBootstrapAlreadyCompletedError
    );
  });
});

describe("BootstrapFirstApplicationAccessService — named lock", () => {
  it("10. lock recusado (GET_LOCK retorna 0) lança APPLICATION_ACCESS_LOCK_NOT_ACQUIRED, nunca tenta ler/inserir", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow(
      ApplicationAccessLockNotAcquiredError
    );
    expect(connection.beginTransactionCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().includes("FROM APPLICATIONS"))).toBe(false);
  });

  it("não chama RELEASE_LOCK quando o lock nunca foi adquirido", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();
    expect(connection.releaseLockCallCount).toBe(0);
  });

  it("15. RELEASE_LOCK é chamado depois do COMMIT (sucesso) — nunca antes", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    const commitIndex = connection.timeline.indexOf("COMMIT");
    const releaseLockIndex = connection.timeline.indexOf("RELEASE_LOCK");
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(releaseLockIndex).toBeGreaterThan(commitIndex);
  });

  it("16. RELEASE_LOCK é chamado depois do ROLLBACK (erro) — nunca antes", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.adminAlreadyGrantedForApplication = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    const rollbackIndex = connection.timeline.indexOf("ROLLBACK");
    const releaseLockIndex = connection.timeline.indexOf("RELEASE_LOCK");
    expect(rollbackIndex).toBeGreaterThanOrEqual(0);
    expect(releaseLockIndex).toBeGreaterThan(rollbackIndex);
  });
});

describe("BootstrapFirstApplicationAccessService — conexão física única e atomicidade", () => {
  it("11. GET_LOCK, SELECTs, INSERTs e RELEASE_LOCK passam todos pela MESMA conexão", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service, pool } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(pool.connectionsAcquired).toHaveLength(1);
    expect(pool.connectionsAcquired[0]).toBe(connection);
  });

  it("12. BEGIN é chamado exatamente uma vez", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(connection.beginTransactionCallCount).toBe(1);
  });

  it("13. COMMIT é chamado exatamente uma vez em caso de sucesso", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(connection.commitCallCount).toBe(1);
    expect(connection.rollbackCallCount).toBe(0);
  });

  it("14. ROLLBACK é chamado exatamente uma vez em caso de erro", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.failApplicationAccessInsert = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });

  it("17. connection.release() é chamado exatamente uma vez, mesmo em sucesso", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(connection.releaseCallCount).toBe(1);
  });

  it("17b. connection.release() é chamado exatamente uma vez, mesmo em erro", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.adminAlreadyGrantedForApplication = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    expect(connection.releaseCallCount).toBe(1);
  });

  it("28. falha no INSERT de AuditEvent causa ROLLBACK — ApplicationAccess não permanece inserido/commitado", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.failAuditInsert = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    expect(connection.commitCallCount).toBe(0);
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.timeline).toContain("INSERT_APPLICATION_ACCESS");
    expect(connection.timeline).toContain("INSERT_AUDIT_FAILED");
  });

  it("29. falha no INSERT de ApplicationAccess nunca tenta o INSERT de AuditEvent", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.failApplicationAccessInsert = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    expect(connection.timeline).toContain("INSERT_APPLICATION_ACCESS_FAILED");
    expect(connection.timeline).not.toContain("INSERT_AUDIT");
  });
});

describe("BootstrapFirstApplicationAccessService — granted_by e auditoria", () => {
  it("18. granted_by_identity_public_id é NULL na concessão de bootstrap (sem Actor autenticado real)", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    const insertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO APPLICATION_ACCESSES"));
    expect(insertCall).toBeDefined();
    expect(insertCall?.params?.[6]).toBeNull();
  });

  it("19. o AuditEvent gravado tem actor_public_id = BOOTSTRAP", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    const auditCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    expect(auditCall).toBeDefined();
    expect(auditCall?.params?.[4]).toBe("BOOTSTRAP");
  });

  it("20. o evento de domínio gerado é do tipo application-access.granted", async () => {
    const { ApplicationAccess } = await import("../domain/ApplicationAccess.js");
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: VALID_IDENTITY_PUBLIC_ID,
      applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    const [event] = applicationAccess.pullDomainEvents();

    expect(event?.eventType).toBe("application-access.granted");
    expect(event?.payload.accessProfile).toBe("ADMIN");
  });
});

describe("BootstrapFirstApplicationAccessService — Identity permanece intocada", () => {
  it("21 e 22. Identity.status e loginEnabled não são alterados — nenhum UPDATE em identities é emitido", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE IDENTITIES"))).toBe(false);
  });

  it("não cria outra Identity — nenhum INSERT INTO identities é emitido", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES"))).toBe(false);
  });

  it("não atualiza version da Identity — nenhum SQL toca a coluna version de identities (nenhum UPDATE/INSERT em identities, ponto)", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    const identityWriteCalls = connection.calls.filter(
      (c) =>
        c.sql.toUpperCase().startsWith("UPDATE IDENTITIES") || c.sql.toUpperCase().startsWith("INSERT INTO IDENTITIES")
    );
    expect(identityWriteCalls).toHaveLength(0);
  });

  it("a Identity, após a concessão, continua PENDING e loginEnabled=false quando relida (fixture não muda por efeito colateral)", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    const identityRepository = new MariaDbIdentityRepository(connection);
    const { PublicId: IdentityPublicId } = await import("../../identity/domain/value-objects/PublicId.js");
    const identity = await identityRepository.findByPublicId(IdentityPublicId.fromString(VALID_IDENTITY_PUBLIC_ID));

    expect(identity?.getStatus().toString()).toBe("PENDING");
    expect(identity?.isLoginEnabled()).toBe(false);
  });

  it("23. nenhuma Credential é criada — nenhum SQL relacionado a 'credentials' é executado", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    expect(connection.calls.some((c) => c.sql.toUpperCase().includes("CREDENTIALS"))).toBe(false);
    expect(connection.timeline.some((t) => t.startsWith("UNEXPECTED_SQL"))).toBe(false);
  });
});

describe("BootstrapFirstApplicationAccessService — optimistic locking (aplicável nesta fatia)", () => {
  it("30. ApplicationAccess nasce com version=1 — nenhum comando de mutação (revoke) existe nesta fatia para exercitar conflito de versão", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    const insertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO APPLICATION_ACCESSES"));
    expect(insertCall?.params?.[9]).toBe(1);
  });
});

describe("BootstrapFirstApplicationAccessService — 6. prova explícita da sequência completa ordenada", () => {
  it("sucesso: GET_LOCK → BEGIN → SELECT_APPLICATION → SELECT_IDENTITY → CHECK_ADMIN → CHECK_DUPLICATE → INSERT_APPLICATION_ACCESS → INSERT_AUDIT → COMMIT → RELEASE_LOCK → RELEASE_CONNECTION, nessa ordem exata", async () => {
    const connection = new FakeAdminAccessConnection();
    const { service } = createService(connection);

    await service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID });

    // Mapeamento de nomes: SELECT_APPLICATION_ACCESS_BY_APPLICATION =
    // CHECK_ADMIN (task, seção 6); SELECT_APPLICATION_ACCESS_BY_IDENTITY
    // = CHECK_DUPLICATE.
    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "SELECT_APPLICATION",
      "SELECT_IDENTITY",
      "COUNT_IDENTITIES",
      "SELECT_APPLICATION_ACCESS_BY_APPLICATION", // = CHECK_ADMIN
      "SELECT_APPLICATION_ACCESS_BY_IDENTITY", // = CHECK_DUPLICATE
      "INSERT_APPLICATION_ACCESS",
      "INSERT_AUDIT",
      "COMMIT",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
  });

  it("erro após BEGIN (falha no INSERT de AuditEvent): ...INSERT_APPLICATION_ACCESS → INSERT_AUDIT_FAILED → ROLLBACK → RELEASE_LOCK → RELEASE_CONNECTION, nessa ordem exata", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.failAuditInsert = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "SELECT_APPLICATION",
      "SELECT_IDENTITY",
      "COUNT_IDENTITIES",
      "SELECT_APPLICATION_ACCESS_BY_APPLICATION",
      "SELECT_APPLICATION_ACCESS_BY_IDENTITY",
      "INSERT_APPLICATION_ACCESS",
      "INSERT_AUDIT_FAILED",
      "ROLLBACK",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
    // Nenhum COMMIT em nenhuma posição da timeline.
    expect(connection.timeline).not.toContain("COMMIT");
  });

  it("erro após BEGIN (guard ADMIN já concedido): ...CHECK_ADMIN → ROLLBACK → RELEASE_LOCK → RELEASE_CONNECTION, sem chegar a INSERT", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.adminAlreadyGrantedForApplication = true;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "SELECT_APPLICATION",
      "SELECT_IDENTITY",
      "COUNT_IDENTITIES",
      "SELECT_APPLICATION_ACCESS_BY_APPLICATION", // CHECK_ADMIN encontra conflito aqui
      "ROLLBACK",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
  });

  it("lock recusado: GET_LOCK → (nada mais) — nunca chega a BEGIN, nunca chama RELEASE_LOCK, mas sempre libera a conexão", async () => {
    const connection = new FakeAdminAccessConnection();
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute({ identityPublicId: VALID_IDENTITY_PUBLIC_ID })).rejects.toThrow();

    expect(connection.timeline).toEqual(["GET_LOCK", "RELEASE_CONNECTION"]);
  });
});
