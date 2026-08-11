import { describe, it, expect } from "vitest";
import { MariaDbMembershipRepository } from "../infrastructure/persistence/MariaDbMembershipRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { Membership } from "../domain/Membership.js";
import { MembershipProfile } from "../domain/value-objects/MembershipProfile.js";
import { PublicId } from "../domain/value-objects/PublicId.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const MEMBERSHIP_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000002";

describe("MariaDbMembershipRepository", () => {
  it("findByPublicId retorna undefined quando nenhuma linha é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM memberships") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbMembershipRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(MEMBERSHIP_PUBLIC_ID));

    expect(result).toBeUndefined();
  });

  it("findByPublicId reconstrói um Membership a partir da linha encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM memberships") && sql.includes("public_id = ?"),
      () => [
        [
          {
            id: 1,
            public_id: MEMBERSHIP_PUBLIC_ID,
            identity_public_id: IDENTITY_PUBLIC_ID,
            organization_public_id: ORGANIZATION_PUBLIC_ID,
            profile: "CUSTOMER",
            scope: "ORGANIZATION_ONLY",
            status: "ACTIVE",
            started_at: new Date("2026-01-01T00:00:00Z"),
            ended_at: null,
            version: 1,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbMembershipRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(MEMBERSHIP_PUBLIC_ID));

    expect(result).toBeInstanceOf(Membership);
    expect(result?.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(result?.getEndedAt()).toBeUndefined();
  });

  it("findAllByIdentityPublicId retorna lista (múltiplos Memberships) parametrizada por identity_public_id", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM memberships") && sql.includes("identity_public_id = ?"),
      () => [
        [
          {
            id: 1,
            public_id: "0b13f6f0-8f3a-4a1e-9c2d-000000000010",
            identity_public_id: IDENTITY_PUBLIC_ID,
            organization_public_id: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
            profile: "CUSTOMER",
            scope: "ORGANIZATION_ONLY",
            status: "ACTIVE",
            started_at: new Date(),
            ended_at: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date()
          },
          {
            id: 2,
            public_id: "0b13f6f0-8f3a-4a1e-9c2d-000000000011",
            identity_public_id: IDENTITY_PUBLIC_ID,
            organization_public_id: "0b13f6f0-8f3a-4a1e-9c2d-000000000002",
            profile: "PARTNER",
            scope: "ORGANIZATION_AND_DESCENDANTS",
            status: "ACTIVE",
            started_at: new Date(),
            ended_at: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date()
          }
        ],
        []
      ]
    );
    const repository = new MariaDbMembershipRepository(fake);

    const results = await repository.findAllByIdentityPublicId(IDENTITY_PUBLIC_ID);

    expect(results).toHaveLength(2);
    expect(results.every((m) => m.getIdentityPublicId() === IDENTITY_PUBLIC_ID)).toBe(true);
    const call = fake.calls.find((c) => c.sql.includes("identity_public_id = ?"));
    expect(call?.sql).not.toContain(IDENTITY_PUBLIC_ID);
    expect(call?.params).toContain(IDENTITY_PUBLIC_ID);
  });

  it("existsByIdentityOrganizationAndProfile usa SQL parametrizado e retorna true/false", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM memberships") && sql.includes("profile = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbMembershipRepository(fake);

    const exists = await repository.existsByIdentityOrganizationAndProfile(
      IDENTITY_PUBLIC_ID,
      ORGANIZATION_PUBLIC_ID,
      MembershipProfile.create("CUSTOMER")
    );

    expect(exists).toBe(true);
    const call = fake.calls.find((c) => c.sql.includes("profile = ?"));
    expect(call?.params).toEqual([IDENTITY_PUBLIC_ID, ORGANIZATION_PUBLIC_ID, "CUSTOMER"]);
  });

  it("insert grava todas as colunas e atribui internalId gerado pelo banco", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("INSERT INTO memberships"),
      () => [{ insertId: 77 }, []]
    );
    const repository = new MariaDbMembershipRepository(fake);
    const membership = Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      profile: "EMPLOYEE",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: IDENTITY_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });

    await repository.insert(membership);

    expect(membership.getInternalIdForPersistence()).toBe(77);
    const call = fake.calls.find((c) => c.sql.includes("INSERT INTO memberships"));
    expect(call?.params).toEqual([
      membership.getPublicId().toString(),
      IDENTITY_PUBLIC_ID,
      ORGANIZATION_PUBLIC_ID,
      "EMPLOYEE",
      "ORGANIZATION_ONLY",
      "ACTIVE",
      membership.getStartedAt(),
      null,
      1,
      membership.getCreatedAt(),
      membership.getUpdatedAt()
    ]);
    expect(call?.sql).not.toContain(IDENTITY_PUBLIC_ID);
  });
});
