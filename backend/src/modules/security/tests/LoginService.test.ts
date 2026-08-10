import { describe, it, expect } from "vitest";
import { LoginService } from "../application/LoginService.js";
import { AuthenticationFailedError } from "../domain/errors/AuthenticationErrors.js";
import { MariaDbCredentialRepository } from "../infrastructure/persistence/MariaDbCredentialRepository.js";
import { MariaDbSessionRepository } from "../infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { FakeLoginConnection, FakeLoginConnectionPool } from "./FakeLoginConnection.js";

const VALID_EMAIL = "pessoa@example.com";
const VALID_PASSWORD = "senha-correta-123456";

class RealMatchPasswordVerifier {
  public async verify(): Promise<boolean> {
    return true;
  }
}

class NeverMatchPasswordVerifier {
  public async verify(): Promise<boolean> {
    return false;
  }
}

class FixedTokenGenerator {
  public generate(): string {
    return "token-fixo-para-teste-de-login";
  }
}

function createService(connection: FakeLoginConnection, passwordVerifier: { verify(): Promise<boolean> }) {
  const pool = new FakeLoginConnectionPool(() => connection);
  const service = new LoginService(
    pool,
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbCredentialRepository(conn),
    (conn) => new MariaDbSessionRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn),
    passwordVerifier,
    new FixedTokenGenerator(),
    3600
  );
  return { service, pool };
}

describe("LoginService - sucesso", () => {
  it("sucesso: retorna identityPublicId/sessionPublicId/rawToken/expiresAt", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    const result = await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(result.identityPublicId).toBe("66231e51-66fb-466d-af4f-ac7b925ca9ec");
    expect(result.sessionPublicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.rawToken).toBe("token-fixo-para-teste-de-login");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});

describe("LoginService - atomicidade e conexao unica", () => {
  it("timeline completa ordenada: BEGIN -> SELECT_IDENTITY -> SELECT_CREDENTIAL -> UPDATE_CREDENTIAL -> INSERT_SESSION -> INSERT_AUDIT -> COMMIT -> RELEASE_CONNECTION", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(connection.timeline).toEqual([
      "BEGIN",
      "SELECT_IDENTITY",
      "SELECT_CREDENTIAL",
      "UPDATE_CREDENTIAL",
      "INSERT_SESSION",
      "INSERT_AUDIT_1",
      "COMMIT",
      "RELEASE_CONNECTION"
    ]);
  });

  it("[PROVA COMPLETA — revisão crítica, item 5] timeline UNIFICADA incluindo VERIFY_PASSWORD e GENERATE_SESSION_TOKEN (não apenas SQL)", async () => {
    const connection = new FakeLoginConnection();
    // VERIFY_PASSWORD e GENERATE_SESSION_TOKEN não são chamadas SQL —
    // acontecem via objetos injetados separados do FakeLoginConnection
    // (PasswordVerifier/SessionTokenGenerator). Instrumentamos os dois
    // para escrever na MESMA timeline compartilhada da conexão,
    // provando a ordem real entre eles e as chamadas SQL.
    const trackingPasswordVerifier = {
      async verify(): Promise<boolean> {
        connection.timeline.push("VERIFY_PASSWORD");
        return true;
      }
    };
    const trackingTokenGenerator = {
      generate(): string {
        connection.timeline.push("GENERATE_SESSION_TOKEN");
        return "token-fixo-para-teste-de-timeline";
      }
    };
    const pool = new FakeLoginConnectionPool(() => connection);
    const service = new LoginService(
      pool,
      (conn) => new MariaDbIdentityRepository(conn),
      (conn) => new MariaDbCredentialRepository(conn),
      (conn) => new MariaDbSessionRepository(conn),
      (conn) => new MariaDbAuditEventRepository(conn),
      trackingPasswordVerifier,
      trackingTokenGenerator,
      3600
    );

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    // Sequência real completa: autenticação primeiro (identidade, then
    // credencial, then verificação de senha, then persistência da
    // credencial), depois criação da sessão (geração do token, then
    // persistência da sessão), depois auditoria, depois commit.
    //
    // HASH_SESSION_TOKEN (hashSessionToken(), dentro de
    // CreateSessionService) DELIBERADAMENTE não aparece como uma entrada
    // separada nesta timeline — é uma função pura, síncrona, sem I/O
    // (SHA-256 de uma string em memória), chamada imediatamente após
    // GENERATE_SESSION_TOKEN, no mesmo tick, sem nenhuma possibilidade
    // de intercalação com outra operação. Instrumentar uma função pura
    // sem efeito colateral só para aparecer nesta timeline adicionaria
    // indireção à camada de produção sem nenhum ganho real de prova —
    // ao contrário de VERIFY_PASSWORD/GENERATE_SESSION_TOKEN (que
    // envolvem, respectivamente, custo computacional real do Argon2id e
    // geração de entropia criptográfica) ou das chamadas SQL (que
    // envolvem I/O real), cuja ordem relativa a outras operações É
    // observável e relevante.
    expect(connection.timeline).toEqual([
      "BEGIN",
      "SELECT_IDENTITY",
      "SELECT_CREDENTIAL",
      "VERIFY_PASSWORD",
      "UPDATE_CREDENTIAL",
      "GENERATE_SESSION_TOKEN",
      "INSERT_SESSION",
      "INSERT_AUDIT_1",
      "COMMIT",
      "RELEASE_CONNECTION"
    ]);
  });

  it("GET_LOCK/RELEASE_LOCK nunca aparecem - login nao usa named lock", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(connection.timeline).not.toContain("GET_LOCK");
    expect(connection.timeline).not.toContain("RELEASE_LOCK");
  });

  it("apenas UMA conexao e adquirida do pool em toda a operacao", async () => {
    const connection = new FakeLoginConnection();
    const { service, pool } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(pool.connectionsAcquired).toHaveLength(1);
    expect(pool.connectionsAcquired[0]).toBe(connection);
  });

  it("[PROVA EXPLÍCITA — revisão crítica, item 4] IdentityRepository, CredentialRepository, SessionRepository e AuditEventRepository recebem exatamente a MESMA referência de conexão", async () => {
    const connection = new FakeLoginConnection();
    const pool = new FakeLoginConnectionPool(() => connection);
    const seenConnections: { identity?: unknown; credential?: unknown; session?: unknown; audit?: unknown } = {};

    const service = new LoginService(
      pool,
      (conn) => {
        seenConnections.identity = conn;
        return new MariaDbIdentityRepository(conn);
      },
      (conn) => {
        seenConnections.credential = conn;
        return new MariaDbCredentialRepository(conn);
      },
      (conn) => {
        seenConnections.session = conn;
        return new MariaDbSessionRepository(conn);
      },
      (conn) => {
        seenConnections.audit = conn;
        return new MariaDbAuditEventRepository(conn);
      },
      new RealMatchPasswordVerifier(),
      new FixedTokenGenerator(),
      3600
    );

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(seenConnections.identity).toBeDefined();
    expect(seenConnections.credential).toBeDefined();
    expect(seenConnections.session).toBeDefined();
    expect(seenConnections.audit).toBeDefined();
    // Identidade de referência (===), não apenas igualdade estrutural.
    expect(seenConnections.identity).toBe(connection);
    expect(seenConnections.credential).toBe(connection);
    expect(seenConnections.session).toBe(connection);
    expect(seenConnections.audit).toBe(connection);
    expect(seenConnections.identity).toBe(seenConnections.credential);
    expect(seenConnections.credential).toBe(seenConnections.session);
    expect(seenConnections.session).toBe(seenConnections.audit);

    // E o pool só foi consultado UMA vez — nenhum repository poderia ter
    // aberto uma segunda conexão via pool, pois nenhum deles sequer
    // recebe uma referência ao pool (só à conexão já aberta, injetada
    // via construtor).
    expect(pool.connectionsAcquired).toHaveLength(1);
  });

  it("BEGIN e chamado exatamente uma vez", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(connection.beginTransactionCallCount).toBe(1);
  });

  it("COMMIT e chamado exatamente uma vez em sucesso; ROLLBACK nunca", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(connection.commitCallCount).toBe(1);
    expect(connection.rollbackCallCount).toBe(0);
  });

  it("connection.release() e chamado exatamente uma vez, mesmo em sucesso", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(connection.releaseCallCount).toBe(1);
  });

  it("connection.release() e chamado exatamente uma vez, mesmo em falha de autenticacao", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new NeverMatchPasswordVerifier());

    await expect(service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD })).rejects.toThrow();

    expect(connection.releaseCallCount).toBe(1);
  });
});

describe("LoginService - falha de autenticacao: ROLLBACK, nada persistido", () => {
  it("senha errada: ROLLBACK, nenhuma Session/AuditEvent inserido, nenhum COMMIT", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new NeverMatchPasswordVerifier());

    await expect(service.execute({ email: VALID_EMAIL, password: "senha-errada" })).rejects.toThrow(
      AuthenticationFailedError
    );

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO SESSIONS"))).toBe(false);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("e-mail inexistente: ROLLBACK, nenhuma Credential sequer consultada", async () => {
    const connection = new FakeLoginConnection();
    connection.identityExists = false;
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await expect(service.execute({ email: "inexistente@example.com", password: VALID_PASSWORD })).rejects.toThrow(
      AuthenticationFailedError
    );

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.timeline).not.toContain("SELECT_CREDENTIAL");
  });
});

describe("LoginService - falhas parciais na segunda metade da transacao", () => {
  it("falha no UPDATE de Credential: ROLLBACK, nenhuma Session inserida", async () => {
    const connection = new FakeLoginConnection();
    connection.failCredentialUpdate = true;
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await expect(service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD })).rejects.toThrow();

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO SESSIONS"))).toBe(false);
  });

  it("falha no INSERT de Session: ROLLBACK - o UPDATE de Credential ja aplicado e revertido pela transacao", async () => {
    const connection = new FakeLoginConnection();
    connection.failSessionInsert = true;
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await expect(service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD })).rejects.toThrow();

    expect(connection.timeline).toContain("UPDATE_CREDENTIAL");
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("falha no INSERT de AuditEvent: ROLLBACK de tudo", async () => {
    const connection = new FakeLoginConnection();
    connection.failAuditInsert = true;
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await expect(service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD })).rejects.toThrow();

    expect(connection.timeline).toContain("INSERT_SESSION");
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });
});

describe("LoginService - auditoria", () => {
  it("o AuditEvent de session.created tem actor_public_id = a propria Identity (nunca BOOTSTRAP/SYSTEM)", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    const auditCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    expect(auditCall?.params?.[4]).toBe("66231e51-66fb-466d-af4f-ac7b925ca9ec");
    expect(auditCall?.params?.[4]).not.toBe("BOOTSTRAP");
    expect(auditCall?.params?.[4]).not.toBe("SYSTEM");
  });

  it("o payload do AuditEvent nao contem token/hash/password/cookie/Authorization", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    const auditCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    const payloadJson = String(auditCall?.params?.[7]);
    expect(payloadJson.toLowerCase()).not.toContain("password");
    expect(payloadJson.toLowerCase()).not.toContain("token");
    expect(payloadJson.toLowerCase()).not.toContain("cookie");
    expect(payloadJson.toLowerCase()).not.toContain("authorization");
    expect(payloadJson).not.toContain(VALID_PASSWORD);
    expect(payloadJson).not.toContain("token-fixo-para-teste-de-login");
  });
});

describe("LoginService - senha nunca vaza", () => {
  it("a senha em texto puro nunca aparece em nenhum parametro de nenhuma chamada SQL simulada", async () => {
    const connection = new FakeLoginConnection();
    const { service } = createService(connection, new RealMatchPasswordVerifier());

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    for (const call of connection.calls) {
      const serializedParams = JSON.stringify(call.params ?? []);
      expect(serializedParams).not.toContain(VALID_PASSWORD);
    }
  });
});

describe("LoginService - [PROVA ABRANGENTE, revisão crítica, item 6] raw token NUNCA persistido, em lugar nenhum além do boundary do cookie", () => {
  const KNOWN_RAW_TOKEN = "um-token-de-teste-controlado-para-busca-exaustiva";

  class KnownTokenGenerator {
    public generate(): string {
      return KNOWN_RAW_TOKEN;
    }
  }

  it("sucesso: o token bruto conhecido não aparece em NENHUM parâmetro de NENHUMA chamada SQL (incluindo INSERT_SESSION)", async () => {
    const connection = new FakeLoginConnection();
    const pool = new FakeLoginConnectionPool(() => connection);
    const service = new LoginService(
      pool,
      (conn) => new MariaDbIdentityRepository(conn),
      (conn) => new MariaDbCredentialRepository(conn),
      (conn) => new MariaDbSessionRepository(conn),
      (conn) => new MariaDbAuditEventRepository(conn),
      new RealMatchPasswordVerifier(),
      new KnownTokenGenerator(),
      3600
    );

    const result = await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    // O token bruto SÓ deve aparecer no valor de retorno (o boundary
    // responsável por, na camada HTTP, construir o cookie) — em
    // NENHUMA chamada SQL, incluindo especificamente o INSERT em
    // `sessions` (que recebe apenas o hash).
    expect(result.rawToken).toBe(KNOWN_RAW_TOKEN); // confirma que É o mesmo token, no único lugar esperado

    for (const call of connection.calls) {
      const serializedParams = JSON.stringify(call.params ?? []);
      expect(serializedParams).not.toContain(KNOWN_RAW_TOKEN);
      expect(call.sql).not.toContain(KNOWN_RAW_TOKEN); // nunca concatenado no texto do SQL
    }

    // Especificamente no INSERT de sessions: o banco recebe apenas
    // sha256(raw), nunca o valor bruto.
    const sessionInsertCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO SESSIONS"));
    expect(sessionInsertCall).toBeDefined();
    const persistedTokenHash = sessionInsertCall?.params?.find(
      (param) => typeof param === "string" && /^[0-9a-f]{64}$/.test(param)
    );
    expect(persistedTokenHash).toBeDefined();
    expect(persistedTokenHash).not.toBe(KNOWN_RAW_TOKEN);
  });

  it("sucesso: o token bruto não aparece no payload do AuditEvent (session.created)", async () => {
    const connection = new FakeLoginConnection();
    const pool = new FakeLoginConnectionPool(() => connection);
    const service = new LoginService(
      pool,
      (conn) => new MariaDbIdentityRepository(conn),
      (conn) => new MariaDbCredentialRepository(conn),
      (conn) => new MariaDbSessionRepository(conn),
      (conn) => new MariaDbAuditEventRepository(conn),
      new RealMatchPasswordVerifier(),
      new KnownTokenGenerator(),
      3600
    );

    await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    const auditCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    const payloadJson = String(auditCall?.params?.[7]);
    expect(payloadJson).not.toContain(KNOWN_RAW_TOKEN);
  });

  it("falha após a geração do token (INSERT de Session falha): o token bruto não aparece na mensagem de erro nem em nenhuma chamada SQL", async () => {
    const connection = new FakeLoginConnection();
    connection.failSessionInsert = true;
    const pool = new FakeLoginConnectionPool(() => connection);
    const service = new LoginService(
      pool,
      (conn) => new MariaDbIdentityRepository(conn),
      (conn) => new MariaDbCredentialRepository(conn),
      (conn) => new MariaDbSessionRepository(conn),
      (conn) => new MariaDbAuditEventRepository(conn),
      new RealMatchPasswordVerifier(),
      new KnownTokenGenerator(),
      3600
    );

    let caught: unknown;
    try {
      await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(KNOWN_RAW_TOKEN);
    for (const call of connection.calls) {
      const serializedParams = JSON.stringify(call.params ?? []);
      expect(serializedParams).not.toContain(KNOWN_RAW_TOKEN);
    }
  });

  it("o token bruto nunca aparece em nenhum campo do LoginResult além de rawToken — nunca duplicado em identityPublicId/sessionPublicId", async () => {
    const connection = new FakeLoginConnection();
    const pool = new FakeLoginConnectionPool(() => connection);
    const service = new LoginService(
      pool,
      (conn) => new MariaDbIdentityRepository(conn),
      (conn) => new MariaDbCredentialRepository(conn),
      (conn) => new MariaDbSessionRepository(conn),
      (conn) => new MariaDbAuditEventRepository(conn),
      new RealMatchPasswordVerifier(),
      new KnownTokenGenerator(),
      3600
    );

    const result = await service.execute({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(result.identityPublicId).not.toBe(KNOWN_RAW_TOKEN);
    expect(result.sessionPublicId).not.toBe(KNOWN_RAW_TOKEN);
    expect(result.sessionPublicId).not.toContain(KNOWN_RAW_TOKEN);
  });
});
