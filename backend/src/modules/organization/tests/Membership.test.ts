import { describe, it, expect } from "vitest";
import { Membership } from "../domain/Membership.js";
import { InvalidMembershipProfileError } from "../domain/value-objects/MembershipProfile.js";
import { InvalidMembershipScopeError } from "../domain/value-objects/MembershipScope.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

function createValidMembership(overrides?: { profile?: string; scope?: string }) {
  return Membership.create({
    identityPublicId: IDENTITY_PUBLIC_ID,
    organizationPublicId: ORGANIZATION_PUBLIC_ID,
    profile: overrides?.profile ?? "CUSTOMER",
    scope: overrides?.scope ?? "ORGANIZATION_ONLY",
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
}

describe("Membership — 1. Identity válida + Organization válida (construção do Aggregate)", () => {
  it("cria um Membership com status ACTIVE, version 1, startedAt preenchido e endedAt undefined", () => {
    const membership = createValidMembership();

    expect(membership.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(membership.getOrganizationPublicId()).toBe(ORGANIZATION_PUBLIC_ID);
    expect(membership.getStatus()).toBe("ACTIVE");
    expect(membership.isActive()).toBe(true);
    expect(membership.getEndedAt()).toBeUndefined();
    expect(membership.getVersion()).toBe(1);
    expect(membership.getPublicId().toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

describe("Membership — 2. profile válido (5 valores reconfirmados contra o design)", () => {
  it.each(["EMPLOYEE", "CUSTOMER", "PARTNER", "SUPPLIER", "SERVICE_ACCOUNT"])(
    "aceita profile=%s",
    (profile) => {
      const membership = createValidMembership({ profile });
      expect(membership.getProfile().toString()).toBe(profile);
    }
  );

  it("rejeita profile fora do conjunto fechado", () => {
    expect(() => createValidMembership({ profile: "ADMIN" })).toThrow(InvalidMembershipProfileError);
  });
});

describe("Membership — 3. scope válido (nomes completos, sem abreviação)", () => {
  it.each(["ORGANIZATION_ONLY", "ORGANIZATION_AND_DESCENDANTS"])("aceita scope=%s", (scope) => {
    const membership = createValidMembership({ scope });
    expect(membership.getScope().toString()).toBe(scope);
  });

  it("rejeita scope abreviado ou fora do conjunto fechado", () => {
    expect(() => createValidMembership({ scope: "AND_DESCENDANTS" })).toThrow(InvalidMembershipScopeError);
  });

  it("includesDescendants() reflete o scope corretamente", () => {
    const onlyMembership = createValidMembership({ scope: "ORGANIZATION_ONLY" });
    const descendantsMembership = createValidMembership({ scope: "ORGANIZATION_AND_DESCENDANTS" });

    expect(onlyMembership.getScope().includesDescendants()).toBe(false);
    expect(descendantsMembership.getScope().includesDescendants()).toBe(true);
  });
});

describe("Membership — 4. múltiplos Memberships para a mesma Identity (cardinalidade, construção)", () => {
  it("duas instâncias distintas para a mesma Identity, Organizations diferentes, publicIds distintos", () => {
    const membershipA = Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const membershipB = Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000002",
      profile: "PARTNER",
      scope: "ORGANIZATION_AND_DESCENDANTS",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(membershipA.getIdentityPublicId()).toBe(membershipB.getIdentityPublicId());
    expect(membershipA.getOrganizationPublicId()).not.toBe(membershipB.getOrganizationPublicId());
    expect(membershipA.getPublicId().equals(membershipB.getPublicId())).toBe(false);
  });
});

describe("Membership — 5. reconstituição", () => {
  it("reconstrói um Membership a partir de estado persistido, incluindo endedAt presente (vínculo já encerrado)", () => {
    const membership = Membership.reconstitute({
      internalId: 9,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000003",
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      profile: "EMPLOYEE",
      scope: "ORGANIZATION_ONLY",
      status: "INACTIVE",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: new Date("2026-02-01T00:00:00Z"),
      version: 2,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });

    expect(membership.getInternalIdForPersistence()).toBe(9);
    expect(membership.getStatus()).toBe("INACTIVE");
    expect(membership.isActive()).toBe(false);
    expect(membership.getEndedAt()).toEqual(new Date("2026-02-01T00:00:00Z"));
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });
});

describe("Membership — 6. sem comando de mutação nesta fatia (G2)", () => {
  it("nenhum método revoke()/end()/update() existe no Aggregate; version permanece 1 após create()", () => {
    const membership = createValidMembership();

    expect(membership.getVersion()).toBe(1);
    expect((membership as unknown as { revoke?: unknown }).revoke).toBeUndefined();
    expect((membership as unknown as { end?: unknown }).end).toBeUndefined();
    expect((membership as unknown as { update?: unknown }).update).toBeUndefined();
  });
});

describe("Membership — 7. evento de domínio membership.created", () => {
  it("create() produz exatamente um evento membership.created, payload conforme o catálogo (sem profile)", () => {
    const membership = createValidMembership({ scope: "ORGANIZATION_AND_DESCENDANTS" });

    const events = membership.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("membership.created");
    expect(events[0]?.payload).toEqual({
      membershipPublicId: membership.getPublicId().toString(),
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      scope: "ORGANIZATION_AND_DESCENDANTS"
    });
  });

  it("pullDomainEvents() limpa a lista — chamada seguinte retorna vazio", () => {
    const membership = createValidMembership();

    expect(membership.pullDomainEvents()).toHaveLength(1);
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });
});

describe("Membership — 8. não expõe internalId publicamente", () => {
  it("getInternalIdForPersistence é undefined antes de persistir, atribuível só via infraestrutura", () => {
    const membership = createValidMembership();

    expect(membership.getInternalIdForPersistence()).toBeUndefined();
    membership.assignInternalIdFromPersistence(15);
    expect(membership.getInternalIdForPersistence()).toBe(15);
  });
});
