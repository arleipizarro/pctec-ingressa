import { describe, it, expect } from "vitest";
import { LogoutService } from "../application/LogoutService.js";
import { SessionValidationFailedError } from "../domain/errors/SessionValidationErrors.js";
import { MariaDbSessionRepository } from "../infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { FakeLogoutConnection, FakeLogoutConnectionPool } from "./FakeLogoutConnection.js";

const RAW_TOKEN = "token-bruto-para-teste-de-logout";

function createService(connection: FakeLogoutConnection) {
  const pool = new FakeLogoutConnectionPool(() => connection);
  const service = new LogoutService(
    pool,
    (conn) => new MariaDbSessionRepository(conn),
    (conn) => new MariaDbIdentityRepository(conn),
    (conn) => new MariaDbAuditEventRepository(conn)
  );
  return { service, pool };
}

describe("LogoutService - sucesso", () => {
  it("25/26/27/28/29. Session valida: revoga, revokedAt preenchido, reason=LOGOUT, version incrementa, session.revoked gravado", async () => {
    const connection = new FakeLogoutConnection();
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    const updateCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("UPDATE SESSIONS"));
    expect(updateCall).toBeDefined();
    expect(updateCall?.params?.[0]).toBe("REVOKED");
    expect(updateCall?.params?.[2]).toBeInstanceOf(Date);
    expect(updateCall?.params?.[3]).toBe("LOGOUT");
    expect(updateCall?.params?.[4]).toBe(2);

    const auditCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    expect(auditCall).toBeDefined();
    expect(auditCall?.params?.[1]).toBe("session.revoked");
  });

  it("10. [REVISÃO CRÍTICA] optimistic locking exato: SET version=2 (absoluto), WHERE public_id + version=1 (original), affectedRows=0 -> conflito", async () => {
    const connection = new FakeLogoutConnection();
    connection.sessionVersion = 1;
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    const updateCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("UPDATE SESSIONS"));
    expect(updateCall?.sql).toContain("WHERE public_id = ?");
    expect(updateCall?.sql).toContain("AND version = ?");
    expect(updateCall?.sql).not.toContain("version + 1"); // nunca incremento relativo hardcoded
    // params: [status, last_seen_at, revoked_at, revocation_reason, version(SET), public_id, expectedVersion(WHERE)]
    expect(updateCall?.params?.[4]).toBe(2); // SET version = 2 (absoluto, final)
    const lastParamIndex = (updateCall?.params?.length ?? 1) - 1;
    expect(updateCall?.params?.[lastParamIndex]).toBe(1); // WHERE version = 1 (original)
  });

  it("10. affectedRows=0 no UPDATE -> SessionVersionConflictError, ROLLBACK", async () => {
    const connection = new FakeLogoutConnection();
    connection.failSessionUpdate = true; // simula affectedRows=0 (conflito real)
    const { service } = createService(connection);

    await expect(service.execute({ rawSessionToken: RAW_TOKEN })).rejects.toThrow();

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });

  it("11. [REVISÃO CRÍTICA] session.revoked: actor_public_id = identityPublicId autenticado, payload exato, nunca token/hash/cookie/Authorization", async () => {
    const connection = new FakeLogoutConnection();
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    const auditCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    // params: [eventId, event_type, eventVersion, aggregatePublicId, actorPublicId, correlationId, causationId, payload_json, occurredAt, persistedAt]
    expect(auditCall?.params?.[4]).toBe("66231e51-66fb-466d-af4f-ac7b925ca9ec"); // actor = Identity autenticada
    expect(auditCall?.params?.[4]).not.toBe("BOOTSTRAP");
    expect(auditCall?.params?.[4]).not.toBe("SYSTEM");

    const payloadJson = String(auditCall?.params?.[7]);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["identityPublicId", "reason", "sessionPublicId"].sort());
    expect(payload["reason"]).toBe("LOGOUT");
    expect(payload["sessionPublicId"]).toBe("22222222-2222-2222-2222-222222222222");
    expect(payload["identityPublicId"]).toBe("66231e51-66fb-466d-af4f-ac7b925ca9ec");
    expect(payloadJson.toLowerCase()).not.toContain("token");
    expect(payloadJson.toLowerCase()).not.toContain("hash");
    expect(payloadJson.toLowerCase()).not.toContain("cookie");
    expect(payloadJson.toLowerCase()).not.toContain("authorization");
  });
});

describe("LogoutService - 30. atomicidade e timeline exata", () => {
  it("timeline completa ordenada: BEGIN -> SELECT_SESSION -> SELECT_IDENTITY -> UPDATE_SESSION -> INSERT_AUDIT -> COMMIT -> RELEASE_CONNECTION", async () => {
    const connection = new FakeLogoutConnection();
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(connection.timeline).toEqual([
      "BEGIN",
      "SELECT_SESSION",
      "SELECT_IDENTITY",
      "UPDATE_SESSION",
      "INSERT_AUDIT_1",
      "COMMIT",
      "RELEASE_CONNECTION"
    ]);
  });

  it("apenas UMA conexao e adquirida do pool", async () => {
    const connection = new FakeLogoutConnection();
    const { service, pool } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(pool.connectionsAcquired).toHaveLength(1);
  });

  it("BEGIN e COMMIT chamados exatamente uma vez em sucesso; ROLLBACK nunca", async () => {
    const connection = new FakeLogoutConnection();
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(connection.beginTransactionCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(1);
    expect(connection.rollbackCallCount).toBe(0);
  });

  it("connection.release() chamado exatamente uma vez, mesmo em sucesso", async () => {
    const connection = new FakeLogoutConnection();
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(connection.releaseCallCount).toBe(1);
  });

  it("connection.release() chamado exatamente uma vez, mesmo em falha", async () => {
    const connection = new FakeLogoutConnection();
    connection.sessionExists = false;
    const { service } = createService(connection);

    await expect(service.execute({ rawSessionToken: RAW_TOKEN })).rejects.toThrow();

    expect(connection.releaseCallCount).toBe(1);
  });

  it("falha: Session nao encontrada -> ROLLBACK, nenhum UPDATE/INSERT, nenhum COMMIT", async () => {
    const connection = new FakeLogoutConnection();
    connection.sessionExists = false;
    const { service } = createService(connection);

    await expect(service.execute({ rawSessionToken: RAW_TOKEN })).rejects.toThrow(SessionValidationFailedError);

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE SESSIONS"))).toBe(false);
  });

  it("8. [REVISÃO CRÍTICA] logout com Session JÁ REVOKED -> SESSION_INVALID/401, ROLLBACK, NENHUM novo UPDATE, NENHUM novo session.revoked, version NÃO incrementa novamente", async () => {
    const connection = new FakeLogoutConnection();
    connection.sessionStatus = "REVOKED";
    connection.sessionVersion = 5; // simula uma sessão já revogada anteriormente, version já avançada
    const { service } = createService(connection);

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SessionValidationFailedError);
    expect((caught as SessionValidationFailedError).code).toBe("SESSION_INVALID");
    expect((caught as SessionValidationFailedError).classification).toBe("AUTHENTICATION"); // 401
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    // Nenhum novo UPDATE — a version permanece exatamente como estava,
    // nunca incrementada de novo.
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE SESSIONS"))).toBe(false);
    // Nenhum novo session.revoked gravado.
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("9. [REVISÃO CRÍTICA] logout com Session expirada -> SESSION_INVALID/401, ROLLBACK, NÃO 'revoga' a sessão só para satisfazer o DELETE, nenhum session.revoked", async () => {
    const connection = new FakeLogoutConnection();
    connection.sessionExpiresAt = new Date("2000-01-01T00:00:00Z");
    const { service } = createService(connection);

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SessionValidationFailedError);
    expect((caught as SessionValidationFailedError).code).toBe("SESSION_INVALID");
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    // Nunca revoga uma sessão já expirada só para satisfazer o DELETE —
    // nenhum UPDATE, nenhum AuditEvent.
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE SESSIONS"))).toBe(false);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("falha: Identity nao ACTIVE -> ROLLBACK, nenhuma revogacao persistida", async () => {
    const connection = new FakeLogoutConnection();
    connection.identityStatus = "BLOCKED";
    const { service } = createService(connection);

    await expect(service.execute({ rawSessionToken: RAW_TOKEN })).rejects.toThrow(SessionValidationFailedError);

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("UPDATE SESSIONS"))).toBe(false);
  });

  it("falha: UPDATE de Session falha -> ROLLBACK, nenhum COMMIT", async () => {
    const connection = new FakeLogoutConnection();
    connection.failSessionUpdate = true;
    const { service } = createService(connection);

    await expect(service.execute({ rawSessionToken: RAW_TOKEN })).rejects.toThrow();

    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.calls.some((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"))).toBe(false);
  });

  it("falha: INSERT de AuditEvent falha -> ROLLBACK de tudo", async () => {
    const connection = new FakeLogoutConnection();
    connection.failAuditInsert = true;
    const { service } = createService(connection);

    await expect(service.execute({ rawSessionToken: RAW_TOKEN })).rejects.toThrow();

    expect(connection.timeline).toContain("UPDATE_SESSION");
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
  });
});

describe("LogoutService - token bruto nunca vaza", () => {
  it("token bruto nunca aparece em nenhum parametro SQL", async () => {
    const connection = new FakeLogoutConnection();
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    for (const call of connection.calls) {
      const serializedParams = JSON.stringify(call.params ?? []);
      expect(serializedParams).not.toContain(RAW_TOKEN);
    }
  });

  it("token bruto nunca aparece no payload do AuditEvent", async () => {
    const connection = new FakeLogoutConnection();
    const { service } = createService(connection);

    await service.execute({ rawSessionToken: RAW_TOKEN });

    const auditCall = connection.calls.find((c) => c.sql.toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"));
    const payloadJson = String(auditCall?.params?.[7]);
    expect(payloadJson).not.toContain(RAW_TOKEN);
    expect(payloadJson.toLowerCase()).not.toContain("tokenhash");
    expect(payloadJson.toLowerCase()).not.toContain("cookie");
  });
});
