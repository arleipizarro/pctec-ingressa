import { describe, it, expect } from "vitest";
import { Session } from "../domain/session/Session.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const TOKEN_HASH = "a".repeat(64);
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000090";

function buildSession(overrides: Partial<Parameters<typeof Session.create>[0]> = {}) {
  return Session.create({
    identityPublicId: IDENTITY_PUBLIC_ID,
    tokenHash: TOKEN_HASH,
    ttlSeconds: 3600,
    correlationId: CORRELATION_ID,
    ...overrides
  });
}

describe("Session.create", () => {
  it("cria com sucesso, status ACTIVE", () => {
    const session = buildSession();
    expect(session.getStatus()).toBe("ACTIVE");
    expect(session.isRevoked()).toBe(false);
  });

  it("publicId é gerado (UUID válido)", () => {
    const session = buildSession();
    expect(session.getPublicId().toString()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("identityPublicId e tokenHash são preservados", () => {
    const session = buildSession();
    expect(session.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(session.getTokenHash()).toBe(TOKEN_HASH);
  });

  it("expiresAt = createdAt + ttlSeconds", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const session = buildSession({ ttlSeconds: 3600, now });
    expect(session.getExpiresAt().toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("version nasce em 1", () => {
    expect(buildSession().getVersion()).toBe(1);
  });

  it("lastSeenAt/revokedAt/revocationReason nascem undefined", () => {
    const session = buildSession();
    expect(session.getLastSeenAt()).toBeUndefined();
    expect(session.getRevokedAt()).toBeUndefined();
    expect(session.getRevocationReason()).toBeUndefined();
  });

  it("gera o evento session.created com actor = a própria Identity (nunca BOOTSTRAP)", () => {
    const session = buildSession();
    const [event] = session.pullDomainEvents();

    expect(event?.eventType).toBe("session.created");
    expect(event?.actorPublicId).toBe(IDENTITY_PUBLIC_ID);
    expect(event?.actorPublicId).not.toBe("BOOTSTRAP");
    expect(event?.actorPublicId).not.toBe("SYSTEM");
  });

  it("o payload do evento não contém token bruto, hash, senha, cookie ou header Authorization", () => {
    const session = buildSession();
    const [event] = session.pullDomainEvents();
    const serialized = JSON.stringify(event?.payload);

    expect(event?.payload).not.toHaveProperty("tokenHash");
    expect(event?.payload).not.toHaveProperty("rawToken");
    expect(event?.payload).not.toHaveProperty("token");
    expect(event?.payload).not.toHaveProperty("cookie");
    expect(event?.payload).not.toHaveProperty("authorization");
    expect(serialized).not.toContain(TOKEN_HASH);
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual(
      ["expiresAt", "identityPublicId", "sessionPublicId"].sort()
    );
  });

  it("pullDomainEvents esvazia a fila — segunda chamada retorna vazio", () => {
    const session = buildSession();
    session.pullDomainEvents();
    expect(session.pullDomainEvents()).toHaveLength(0);
  });
});

describe("Session.reconstitute", () => {
  it("reconstrói a partir de estado persistido, sem gerar eventos", () => {
    const session = Session.reconstitute({
      internalId: 5,
      publicId: "22222222-2222-2222-2222-222222222222",
      identityPublicId: IDENTITY_PUBLIC_ID,
      tokenHash: TOKEN_HASH,
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2026-01-01T08:00:00Z"),
      lastSeenAt: undefined,
      revokedAt: undefined,
      revocationReason: undefined,
      version: 1
    });

    expect(session.getStatus()).toBe("ACTIVE");
    expect(session.pullDomainEvents()).toHaveLength(0);
  });
});

describe("Session — lifecycle: ACTIVE/REVOKED/EXPIRED (derivado)", () => {
  it("isValid() = true quando ACTIVE e não expirada", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const session = buildSession({ ttlSeconds: 3600, now });
    expect(session.isValid(new Date("2026-01-01T00:30:00Z"))).toBe(true);
  });

  it("isExpired() = true quando expiresAt <= now, mesmo com status ACTIVE ainda persistido", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const session = buildSession({ ttlSeconds: 3600, now });
    const afterExpiry = new Date("2026-01-01T02:00:00Z");

    expect(session.getStatus()).toBe("ACTIVE"); // nunca muda para um terceiro valor
    expect(session.isExpired(afterExpiry)).toBe(true);
    expect(session.isValid(afterExpiry)).toBe(false);
  });

  it("isExpired() com expiresAt exatamente igual a now — considerado expirado (<=, não <)", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const session = buildSession({ ttlSeconds: 3600, now });
    const exactExpiry = new Date("2026-01-01T01:00:00Z");

    expect(session.isExpired(exactExpiry)).toBe(true);
  });

  it("revoke() muda status para REVOKED, seta revokedAt/revocationReason, incrementa version", () => {
    const session = buildSession();
    const now = new Date("2026-01-01T05:00:00Z");

    session.revoke("LOGOUT", now);

    expect(session.getStatus()).toBe("REVOKED");
    expect(session.isRevoked()).toBe(true);
    expect(session.getRevokedAt()).toEqual(now);
    expect(session.getRevocationReason()).toBe("LOGOUT");
    expect(session.getVersion()).toBe(2);
  });

  it("sessão revogada é sempre inválida, mesmo se ainda não expirada", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const session = buildSession({ ttlSeconds: 3600, now });
    session.revoke("LOGOUT", now);

    expect(session.isValid(now)).toBe(false);
  });

  it("touch() atualiza lastSeenAt", () => {
    const session = buildSession();
    const seenAt = new Date("2026-01-01T03:00:00Z");
    session.touch(seenAt);
    expect(session.getLastSeenAt()).toEqual(seenAt);
  });

  it("internalId nunca é exposto por getter público comum", () => {
    const session = buildSession();
    expect(session.getInternalIdForPersistence()).toBeUndefined();
    session.assignInternalIdFromPersistence(11);
    expect(session.getInternalIdForPersistence()).toBe(11);
  });
});
