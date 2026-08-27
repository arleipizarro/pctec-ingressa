import { describe, it, expect } from "vitest";
import { BootstrapFirstCredentialService } from "../application/BootstrapFirstCredentialService.js";
import {
  CredentialBootstrapAlreadyCompletedError,
  CredentialLockNotAcquiredError
} from "../application/errors/CredentialBootstrapErrors.js";
import { IdentityNotFoundForCredentialError } from "../domain/errors/CredentialErrors.js";
import { CredentialPasswordPolicyViolationError } from "../domain/value-objects/PlainPassword.js";
import { MariaDbCredentialRepository } from "../infrastructure/persistence/MariaDbCredentialRepository.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { MariaDbApplicationRepository } from "../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { FakeCredentialConnection, FakeCredentialConnectionPool } from "./FakeCredentialConnection.js";
import { FakePasswordHasher } from "./FakePasswordHasher.js";

const VALID_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const VALID_PASSWORD = "senha-valida-123456";

function createService(
  connection: FakeCredentialConnection,
  hasher?: FakePasswordHasher
): {
  service: BootstrapFirstCredentialService;
  pool: FakeCredentialConnectionPool;
  hasher: FakePasswordHasher;
} {
  // Por padrão, o hasher registra HASH_PASSWORD na MESMA timeline da
  // conexão — prova a posição exata do hashing na sequência real
  // (revisão crítica: relatório anterior omitiu esse passo).
  const effectiveHasher = hasher ?? new FakePasswordHasher(connection.timeline);
  const pool = new FakeCredentialConnectionPool(() => connection);
  const service = new BootstrapFirstCredentialService(
    pool,
    (conn) => new MariaDbCredentialRepository(conn),
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn),
    effectiveHasher,
    (conn) => new MariaDbApplicationRepository(conn),
    (conn) => new MariaDbApplicationAccessRepository(conn)
  );
  return { service, pool, hasher: effectiveHasher };
}

function validRequest(
  overrides: Partial<{ identityPublicId: string; plainPassword: string; plainPasswordConfirmation: string }> = {}
) {
  return {
    identityPublicId: VALID_IDENTITY_PUBLIC_ID,
    plainPassword: VALID_PASSWORD,
    plainPasswordConfirmation: VALID_PASSWORD,
    ...overrides
  };
}

describe("BootstrapFirstCredentialService — sucesso", () => {
  it("sucesso: Credential criada, Identity ACTIVE, loginEnabled=true", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    const result = await service.execute(validRequest());

    expect(result.credentialType).toBe("LOCAL_PASSWORD");
    expect(result.identityStatus).toBe("ACTIVE");
    expect(result.loginEnabled).toBe(true);
    expect(result.identityPublicId).toBe(VALID_IDENTITY_PUBLIC_ID);
    expect(result.credentialPublicId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("23. Identity transiciona PENDING → ACTIVE", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityStatus = "PENDING";
    const { service } = createService(connection);

    const result = await service.execute(validRequest());

    expect(result.identityStatus).toBe("ACTIVE");
  });

  it("24. loginEnabled transiciona false → true", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityLoginEnabled = false;
    const { service } = createService(connection);

    const result = await service.execute(validRequest());

    expect(result.loginEnabled).toBe(true);
  });

  it("25. a Identity é persistida com version absoluta (não incremento relativo hardcoded)", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityVersion = 5;
    const { service } = createService(connection);

    await service.execute(validRequest());

    const updateCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("UPDATE IDENTITIES"));
    expect(updateCall).toBeDefined();
    expect(updateCall?.params?.[7]).toBe(7);
    expect(updateCall?.params?.[updateCall.params.length - 1]).toBe(5);
  });
});

describe("BootstrapFirstCredentialService — Identity ausente", () => {
  it("13. Identity inexistente bloqueia com IDENTITY_NOT_FOUND, sem inserir nada", async () => {
    const connection = new FakeCredentialConnection();
    connection.identityExists = false;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow(IdentityNotFoundForCredentialError);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO CREDENTIALS"))).toBe(false);
  });
});

describe("BootstrapFirstCredentialService — password policy", () => {
  it("10. senha fora da política é rejeitada antes de qualquer I/O", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await expect(
      service.execute(validRequest({ plainPassword: "curta", plainPasswordConfirmation: "curta" }))
    ).rejects.toThrow(CredentialPasswordPolicyViolationError);

    expect(connection.calls).toHaveLength(0);
  });

  it("41. confirmação de senha divergente é rejeitada antes de qualquer I/O", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await expect(
      service.execute(validRequest({ plainPasswordConfirmation: "outra-senha-diferente-789" }))
    ).rejects.toThrow(CredentialPasswordPolicyViolationError);

    expect(connection.calls).toHaveLength(0);
  });
});

describe("BootstrapFirstCredentialService — guard global one-shot", () => {
  it("12. guard global com LOCAL_PASSWORD já existente bloqueia, sem inserir nada", async () => {
    const connection = new FakeCredentialConnection();
    connection.anyCredentialExists = true;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow(CredentialBootstrapAlreadyCompletedError);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO CREDENTIALS"))).toBe(false);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE IDENTITIES"))).toBe(false);
  });

  it("35. segunda execução (nova chamada, guard já verdadeiro) é bloqueada", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());
    connection.anyCredentialExists = true;
    await expect(service.execute(validRequest())).rejects.toThrow(CredentialBootstrapAlreadyCompletedError);
  });

  it("o guard é GLOBAL — não depende de qual identityPublicId foi informado", async () => {
    const connection = new FakeCredentialConnection();
    connection.anyCredentialExists = true;
    const { service } = createService(connection);

    await expect(
      service.execute(validRequest({ identityPublicId: "99999999-9999-9999-9999-999999999999" }))
    ).rejects.toThrow(CredentialBootstrapAlreadyCompletedError);
  });
});

describe("BootstrapFirstCredentialService — named lock", () => {
  it("14. lock recusado lança CREDENTIAL_LOCK_NOT_ACQUIRED, nunca tenta ler/inserir", async () => {
    const connection = new FakeCredentialConnection();
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow(CredentialLockNotAcquiredError);
    expect(connection.beginTransactionCallCount).toBe(0);
  });

  it("lock recusado nunca chama RELEASE_LOCK", async () => {
    const connection = new FakeCredentialConnection();
    connection.lockAcquisitionResult = 0;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow();
    expect(connection.releaseLockCallCount).toBe(0);
  });

  it("19. RELEASE_LOCK depois do COMMIT (sucesso) — nunca antes", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    const commitIndex = connection.timeline.indexOf("COMMIT");
    const releaseLockIndex = connection.timeline.indexOf("RELEASE_LOCK");
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(releaseLockIndex).toBeGreaterThan(commitIndex);
  });

  it("20. RELEASE_LOCK depois do ROLLBACK (erro) — nunca antes", async () => {
    const connection = new FakeCredentialConnection();
    connection.anyCredentialExists = true;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow();

    const rollbackIndex = connection.timeline.indexOf("ROLLBACK");
    const releaseLockIndex = connection.timeline.indexOf("RELEASE_LOCK");
    expect(rollbackIndex).toBeGreaterThanOrEqual(0);
    expect(releaseLockIndex).toBeGreaterThan(rollbackIndex);
  });
});

describe("BootstrapFirstCredentialService — conexão física única e atomicidade", () => {
  it("15. GET_LOCK, SELECTs, INSERTs, UPDATE e RELEASE_LOCK passam todos pela MESMA conexão", async () => {
    const connection = new FakeCredentialConnection();
    const { service, pool } = createService(connection);

    await service.execute(validRequest());

    expect(pool.connectionsAcquired).toHaveLength(1);
    expect(pool.connectionsAcquired[0]).toBe(connection);
  });

  it("16. BEGIN é chamado exatamente uma vez", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    expect(connection.beginTransactionCallCount).toBe(1);
  });

  it("17. COMMIT é chamado exatamente uma vez em caso de sucesso", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    expect(connection.commitCallCount).toBe(1);
    expect(connection.rollbackCallCount).toBe(0);
  });

  it("18. ROLLBACK é chamado exatamente uma vez em caso de erro", async () => {
    const connection = new FakeCredentialConnection();
    connection.failCredentialInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow();

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });

  it("21. connection.release() é chamado exatamente uma vez, mesmo em sucesso", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    expect(connection.releaseCallCount).toBe(1);
  });

  it("21b. connection.release() é chamado exatamente uma vez, mesmo em erro", async () => {
    const connection = new FakeCredentialConnection();
    connection.anyCredentialExists = true;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow();

    expect(connection.releaseCallCount).toBe(1);
  });

  it("22. INSERT_CREDENTIAL ocorre antes de UPDATE_IDENTITY na timeline", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    const insertIndex = connection.timeline.indexOf("INSERT_CREDENTIAL");
    const updateIndex = connection.timeline.indexOf("UPDATE_IDENTITY");
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(insertIndex);
  });

  it("sequência completa ordenada [PROVA EXATA — revisão crítica, item 4]: GET_LOCK → BEGIN → CHECK_BOOTSTRAP → SELECT_IDENTITY → HASH_PASSWORD → INSERT_CREDENTIAL → UPDATE_IDENTITY → INSERT_AUDIT×3 → COMMIT → RELEASE_LOCK → RELEASE_CONNECTION", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "CHECK_BOOTSTRAP",
      "SELECT_IDENTITY",
      "SELECT_APPLICATION",
      "CHECK_FOUNDATIONAL_ADMIN",
      "HASH_PASSWORD",
      "INSERT_CREDENTIAL",
      "UPDATE_IDENTITY",
      "INSERT_AUDIT_1",
      "INSERT_AUDIT_2",
      "INSERT_AUDIT_3",
      "COMMIT",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
  });
  it("15b. [PROVA EXPLÍCITA — revisão crítica, item 5] CredentialRepository, IdentityRepository e AuditEventRepository recebem exatamente a MESMA referência de conexão — nenhum abre conexão secundária via pool", async () => {
    const connection = new FakeCredentialConnection();
    const pool = new FakeCredentialConnectionPool(() => connection);
    const seenConnections: {
      credential?: unknown;
      identity?: unknown;
      audit?: unknown;
      application?: unknown;
      applicationAccess?: unknown;
    } = {};

    const service = new BootstrapFirstCredentialService(
      pool,
      (conn) => {
        seenConnections.credential = conn;
        return new MariaDbCredentialRepository(conn);
      },
      (conn) => {
        seenConnections.identity = conn;
        return new MariaDbIdentityRepository(conn);
      },
      (conn) => {
        seenConnections.audit = conn;
        return new MariaDbAuditEventRepository(conn);
      },
      new FakePasswordHasher(connection.timeline),
      (conn) => {
        seenConnections.application = conn;
        return new MariaDbApplicationRepository(conn);
      },
      (conn) => {
        seenConnections.applicationAccess = conn;
        return new MariaDbApplicationAccessRepository(conn);
      }
    );

    await service.execute(validRequest());

    expect(seenConnections.credential).toBeDefined();
    expect(seenConnections.identity).toBeDefined();
    expect(seenConnections.audit).toBeDefined();
    // Identidade de referência (===), não apenas igualdade estrutural —
    // prova que é literalmente o mesmo objeto de conexão física.
    expect(seenConnections.credential).toBe(connection);
    expect(seenConnections.identity).toBe(connection);
    expect(seenConnections.audit).toBe(connection);
    expect(seenConnections.credential).toBe(seenConnections.identity);
    expect(seenConnections.identity).toBe(seenConnections.audit);

    // E o pool, por sua vez, só foi consultado UMA vez em toda a
    // operação — nenhum repository poderia ter aberto uma segunda
    // conexão via pool, pois nenhum deles sequer recebe uma referência
    // ao pool (só à conexão já aberta, injetada via construtor).
    expect(pool.connectionsAcquired).toHaveLength(1);
  });

});

describe("BootstrapFirstCredentialService — falhas parciais", () => {
  it("31. falha no hash da senha: rollback, nenhum INSERT de Credential; falha ocorre APÓS SELECT_IDENTITY e ANTES de qualquer INSERT", async () => {
    const connection = new FakeCredentialConnection();
    const hasher = new FakePasswordHasher(connection.timeline);
    hasher.shouldFail = true;
    const { service } = createService(connection, hasher);

    await expect(service.execute(validRequest())).rejects.toThrow();

    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO CREDENTIALS"))).toBe(false);
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.timeline).toEqual([
      "GET_LOCK",
      "BEGIN",
      "CHECK_BOOTSTRAP",
      "SELECT_IDENTITY",
      "SELECT_APPLICATION",
      "CHECK_FOUNDATIONAL_ADMIN",
      "HASH_PASSWORD_FAILED",
      "ROLLBACK",
      "RELEASE_LOCK",
      "RELEASE_CONNECTION"
    ]);
  });

  it("32. falha no INSERT de Credential: Identity não é atualizada", async () => {
    const connection = new FakeCredentialConnection();
    connection.failCredentialInsert = true;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow();

    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE IDENTITIES"))).toBe(false);
    expect(connection.rollbackCallCount).toBe(1);
  });

  it("33. falha no UPDATE de Identity: rollback reverte também o INSERT de Credential (transação única)", async () => {
    const connection = new FakeCredentialConnection();
    connection.failIdentityUpdate = true;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow();

    expect(connection.timeline).toContain("INSERT_CREDENTIAL");
    expect(connection.commitCallCount).toBe(0);
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("34. falha em qualquer AuditEvent: rollback de tudo", async () => {
    const connection = new FakeCredentialConnection();
    connection.failAuditInsertOnIndex = 2;
    const { service } = createService(connection);

    await expect(service.execute(validRequest())).rejects.toThrow();

    expect(connection.commitCallCount).toBe(0);
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.timeline).toContain("INSERT_AUDIT_1");
    expect(connection.timeline).toContain("INSERT_AUDIT_FAILED_2");
    expect(connection.timeline).not.toContain("INSERT_AUDIT_3");
  });
});

describe("BootstrapFirstCredentialService — eventos e auditoria", () => {
  it("26/27/28/29. os três AuditEvents (credential.created, identity.activated, identity.login-enabled) têm actor_public_id = BOOTSTRAP", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    const auditCalls = connection.calls.filter((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    expect(auditCalls).toHaveLength(3);

    const eventTypes = auditCalls.map((c) => c.params?.[1]);
    expect(eventTypes).toContain("credential.created");
    expect(eventTypes).toContain("identity.activated");
    expect(eventTypes).toContain("identity.login-enabled");

    for (const call of auditCalls) {
      expect(call.params?.[4]).toBe("BOOTSTRAP");
    }
  });

  it("30. nenhum AuditEvent contém password, hash, salt ou PHC no payload serializado", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    const auditCalls = connection.calls.filter((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    for (const call of auditCalls) {
      const payloadJson = String(call.params?.[7]);
      // Não checamos a substring genérica "password" — o `type`
      // legítimo do payload é "LOCAL_PASSWORD" (minúsculo:
      // "local_password"), que naturalmente contém essa substring sem
      // ser um vazamento. Checamos especificamente as chaves/valores que
      // seriam o vazamento real.
      expect(payloadJson.toLowerCase()).not.toContain("passwordhash");
      expect(payloadJson.toLowerCase()).not.toContain('"password"');
      expect(payloadJson.toLowerCase()).not.toContain("salt");
      expect(payloadJson.toLowerCase()).not.toContain("argon2");
      expect(payloadJson).not.toContain(VALID_PASSWORD);
      expect(payloadJson).not.toContain("$argon2id$");
    }
  });
});

describe("BootstrapFirstCredentialService — senha nunca vaza (revisão crítica, item 4)", () => {
  it("a senha em texto puro nunca aparece em NENHUM parâmetro de NENHUMA chamada SQL simulada (não só em audit_events)", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    await service.execute(validRequest());

    for (const call of connection.calls) {
      const serializedParams = JSON.stringify(call.params ?? []);
      expect(serializedParams).not.toContain(VALID_PASSWORD);
    }
  });

  it("a senha em texto puro nunca aparece na mensagem de erro quando o hash falha", async () => {
    const connection = new FakeCredentialConnection();
    const hasher = new FakePasswordHasher(connection.timeline);
    hasher.shouldFail = true;
    const { service } = createService(connection, hasher);

    let caught: unknown;
    try {
      await service.execute(validRequest());
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(VALID_PASSWORD);
  });

  it("a senha em texto puro nunca aparece em nenhuma mensagem de erro de nenhum cenário de falha testado nesta suíte", async () => {
    const scenarios: Array<(connection: FakeCredentialConnection) => void> = [
      (c) => {
        c.anyCredentialExists = true;
      },
      (c) => {
        c.identityExists = false;
      },
      (c) => {
        c.failCredentialInsert = true;
      },
      (c) => {
        c.failIdentityUpdate = true;
      },
      (c) => {
        c.failAuditInsertOnIndex = 1;
      }
    ];

    for (const applyScenario of scenarios) {
      const connection = new FakeCredentialConnection();
      applyScenario(connection);
      const { service } = createService(connection);

      let caught: unknown;
      try {
        await service.execute(validRequest());
      } catch (error) {
        caught = error;
      }
      expect((caught as Error).message).not.toContain(VALID_PASSWORD);
    }
  });
});

describe("BootstrapFirstCredentialService — não aceita campos fora do contrato", () => {
  it("entrada só aceita identityPublicId/plainPassword/plainPasswordConfirmation — campos extras são ignorados", async () => {
    const connection = new FakeCredentialConnection();
    const { service } = createService(connection);

    const requestWithExtraFields = {
      ...validRequest(),
      actor: "algum-actor-suspeito",
      type: "MICROSOFT_ENTRA",
      status: "REVOKED",
      loginEnabled: false,
      version: 999
    } as unknown as Parameters<typeof service.execute>[0];

    const result = await service.execute(requestWithExtraFields);

    expect(result.credentialType).toBe("LOCAL_PASSWORD");
  });
});
