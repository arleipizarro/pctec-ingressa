import { describe, it, expect } from "vitest";
import { MariaDbAuditEventRepository } from "../infrastructure/MariaDbAuditEventRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { AuditEvent } from "../domain/AuditEvent.js";

function buildEvent(eventPublicId: string): AuditEvent {
  return AuditEvent.reconstitute({
    eventPublicId,
    eventType: "identity.created",
    eventVersion: 1,
    aggregatePublicId: "8f14e45f-ceea-467e-a1a3-000000000030",
    actorPublicId: "SYSTEM",
    correlationId: "8f14e45f-ceea-467e-a1a3-000000000031",
    causationId: undefined,
    payload: { publicId: "8f14e45f-ceea-467e-a1a3-000000000030" },
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    persistedAt: new Date("2026-01-01T00:00:01Z")
  });
}

describe("MariaDbAuditEventRepository", () => {
  it("insert grava o evento com SQL parametrizado, payload serializado como JSON", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"),
      () => [{ affectedRows: 1, insertId: 1 }, []]
    );
    const repository = new MariaDbAuditEventRepository(fake);
    const event = buildEvent("8f14e45f-ceea-467e-a1a3-000000000032");

    await repository.insert(event);

    const call = fake.calls.find((c) => c.sql.toUpperCase().includes("INSERT INTO AUDIT_EVENTS"));
    expect(call).toBeDefined();
    expect(call?.sql).toContain("?");
    expect(call?.params?.[0]).toBe("8f14e45f-ceea-467e-a1a3-000000000032");
    expect(typeof call?.params?.[7]).toBe("string"); // payload_json serializado
    expect(JSON.parse(String(call?.params?.[7]))).toEqual({
      publicId: "8f14e45f-ceea-467e-a1a3-000000000030"
    });
  });

  it("insertMany grava múltiplos eventos, um INSERT por evento", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("INSERT INTO AUDIT_EVENTS"),
      () => [{ affectedRows: 1, insertId: 1 }, []]
    );
    const repository = new MariaDbAuditEventRepository(fake);

    await repository.insertMany([
      buildEvent("8f14e45f-ceea-467e-a1a3-000000000040"),
      buildEvent("8f14e45f-ceea-467e-a1a3-000000000041")
    ]);

    const insertCalls = fake.calls.filter((c) => c.sql.toUpperCase().includes("INSERT INTO AUDIT_EVENTS"));
    expect(insertCalls).toHaveLength(2);
  });
});
