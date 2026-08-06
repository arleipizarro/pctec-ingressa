import { describe, it, expect } from "vitest";
import { AuditEvent } from "../domain/AuditEvent.js";
import { createIdentityCreatedEvent } from "../../identity/domain/events/IdentityDomainEvents.js";

describe("AuditEvent", () => {
  it("fromDomainEvent mapeia todos os campos do evento de domínio, carimbando persistedAt", () => {
    const occurredAt = new Date("2026-01-01T10:00:00Z");
    const domainEvent = createIdentityCreatedEvent(
      {
        aggregatePublicId: "8f14e45f-ceea-467e-a1a3-000000000010",
        actorPublicId: "SYSTEM",
        correlationId: "8f14e45f-ceea-467e-a1a3-000000000011",
        occurredAt
      },
      {
        publicId: "8f14e45f-ceea-467e-a1a3-000000000010",
        type: "HUMAN",
        email: "pessoa@example.com",
        status: "PENDING"
      }
    );

    const persistedAt = new Date("2026-01-01T10:00:01Z");
    const auditEvent = AuditEvent.fromDomainEvent(domainEvent, persistedAt);

    expect(auditEvent.eventPublicId).toBe(domainEvent.eventId);
    expect(auditEvent.eventType).toBe("identity.created");
    expect(auditEvent.eventVersion).toBe(1);
    expect(auditEvent.aggregatePublicId).toBe("8f14e45f-ceea-467e-a1a3-000000000010");
    expect(auditEvent.actorPublicId).toBe("SYSTEM");
    expect(auditEvent.occurredAt).toBe(occurredAt);
    expect(auditEvent.persistedAt).toBe(persistedAt);
    expect(auditEvent.payload).toEqual({
      publicId: "8f14e45f-ceea-467e-a1a3-000000000010",
      type: "HUMAN",
      email: "pessoa@example.com",
      status: "PENDING"
    });
  });

  it("reconstitute reconstrói um AuditEvent a partir de dados já persistidos", () => {
    const auditEvent = AuditEvent.reconstitute({
      eventPublicId: "8f14e45f-ceea-467e-a1a3-000000000020",
      eventType: "identity.created",
      eventVersion: 1,
      aggregatePublicId: "8f14e45f-ceea-467e-a1a3-000000000021",
      actorPublicId: "SYSTEM",
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000022",
      causationId: undefined,
      payload: { publicId: "8f14e45f-ceea-467e-a1a3-000000000021" },
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      persistedAt: new Date("2026-01-01T00:00:01Z")
    });

    expect(auditEvent.eventType).toBe("identity.created");
    expect(auditEvent.causationId).toBeUndefined();
  });
});
