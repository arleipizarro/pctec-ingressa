import { describe, it, expect } from "vitest";
import { MariaDbSessionRepository } from "../infrastructure/persistence/MariaDbSessionRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { Session } from "../domain/session/Session.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const TOKEN_HASH = "b".repeat(64);
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000091";

describe("MariaDbSessionRepository", () => {
  it("insert usa SQL parametrizado (sem concatenação) e atribui o internalId retornado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("INSERT INTO SESSIONS"),
      () => [{ insertId: 9, affectedRows: 1 }, []]
    );
    const repository = new MariaDbSessionRepository(fake);
    const session = Session.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      tokenHash: TOKEN_HASH,
      ttlSeconds: 3600,
      correlationId: CORRELATION_ID
    });

    await repository.insert(session);

    expect(session.getInternalIdForPersistence()).toBe(9);
    const insertCall = fake.calls.find((c) => c.sql.toUpperCase().includes("INSERT INTO SESSIONS"));
    expect(insertCall?.sql).not.toContain(IDENTITY_PUBLIC_ID);
    expect(insertCall?.sql).not.toContain(TOKEN_HASH);
    expect(insertCall?.params).toContain(IDENTITY_PUBLIC_ID);
    expect(insertCall?.params).toContain(TOKEN_HASH);
  });

  it("findByTokenHash retorna undefined quando não encontrado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM sessions") && sql.includes("token_hash = ?"),
      () => [[], []]
    );
    const repository = new MariaDbSessionRepository(fake);

    const result = await repository.findByTokenHash(TOKEN_HASH);

    expect(result).toBeUndefined();
  });

  it("findByTokenHash reconstrói uma Session a partir da linha encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM sessions") && sql.includes("token_hash = ?"),
      () => [
        [
          {
            id: 3,
            public_id: "33333333-3333-3333-3333-333333333333",
            identity_public_id: IDENTITY_PUBLIC_ID,
            token_hash: TOKEN_HASH,
            status: "ACTIVE",
            created_at: new Date("2026-01-01T00:00:00Z"),
            expires_at: new Date("2026-01-01T08:00:00Z"),
            last_seen_at: null,
            revoked_at: null,
            revocation_reason: null,
            version: 1
          }
        ],
        []
      ]
    );
    const repository = new MariaDbSessionRepository(fake);

    const result = await repository.findByTokenHash(TOKEN_HASH);

    expect(result).toBeInstanceOf(Session);
    expect(result?.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(result?.getTokenHash()).toBe(TOKEN_HASH);
  });

  it("findByPublicId retorna undefined quando não encontrado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM sessions") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbSessionRepository(fake);

    const result = await repository.findByPublicId("44444444-4444-4444-4444-444444444444");

    expect(result).toBeUndefined();
  });
});
