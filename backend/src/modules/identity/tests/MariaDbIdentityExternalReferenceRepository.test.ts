import { describe, it, expect } from "vitest";
import { MariaDbIdentityExternalReferenceRepository } from "../infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const REFERENCE_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000002";
const ACTOR_PUBLIC_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

describe("MariaDbIdentityExternalReferenceRepository", () => {
  it("findByPublicId retorna undefined quando nenhuma linha é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identity_external_references") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(REFERENCE_PUBLIC_ID));

    expect(result).toBeUndefined();
  });

  it("findByPublicId reconstrói a partir da linha encontrada, incluindo matchMethod", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identity_external_references") && sql.includes("public_id = ?"),
      () => [
        [
          {
            id: 1,
            public_id: REFERENCE_PUBLIC_ID,
            identity_public_id: IDENTITY_PUBLIC_ID,
            system_code: "PCTEC_PORTAL",
            entity_type: "portal_acesso",
            legacy_id: 33,
            match_method: "MATCHED_MANUAL_CONFIRMED",
            status: "ACTIVE",
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(REFERENCE_PUBLIC_ID));

    expect(result).toBeInstanceOf(IdentityExternalReference);
    expect(result?.getLegacyId().toString()).toBe("33");
    expect(result?.getMatchMethod().toString()).toBe("MATCHED_MANUAL_CONFIRMED");
  });

  it("existsActiveBySystemCodeEntityTypeAndLegacyId usa SQL parametrizado, filtra status='ACTIVE', e retorna true/false", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identity_external_references") && sql.includes("legacy_id = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);

    const exists = await repository.existsActiveBySystemCodeEntityTypeAndLegacyId(
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("portal_acesso"),
      LegacyId.create(33)
    );

    expect(exists).toBe(true);
    const call = fake.calls.find((c) => c.sql.includes("legacy_id = ?"));
    // Referências SUPERSEDED nunca contam para esta checagem.
    expect(call?.sql).toContain("status = 'ACTIVE'");
    expect(call?.params).toEqual(["PCTEC_PORTAL", "portal_acesso", 33]);
  });

  it("insert grava todas as colunas (incluindo match_method) e atribui internalId gerado pelo banco", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("INSERT INTO identity_external_references"),
      () => [{ insertId: 8 }, []]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);
    const reference = IdentityExternalReference.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });

    await repository.insert(reference);

    expect(reference.getInternalIdForPersistence()).toBe(8);
    const call = fake.calls.find((c) => c.sql.includes("INSERT INTO identity_external_references"));
    expect(call?.params).toEqual([
      reference.getPublicId().toString(),
      IDENTITY_PUBLIC_ID,
      "PCTEC_PORTAL",
      "portal_acesso",
      33,
      "MATCHED_MANUAL_CONFIRMED",
      "ACTIVE",
      reference.getCreatedAt(),
      reference.getUpdatedAt()
    ]);
  });

  it("findActiveBySystemCodeEntityTypeAndLegacyId (direção reversa: legacyId→Identity) retorna undefined quando nenhuma linha ACTIVE é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) =>
        sql.includes("FROM identity_external_references") &&
        sql.includes("legacy_id = ?") &&
        sql.includes("status = 'ACTIVE'"),
      () => [[], []]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);

    const result = await repository.findActiveBySystemCodeEntityTypeAndLegacyId(
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("portal_acesso"),
      LegacyId.create(33)
    );

    expect(result).toBeUndefined();
  });

  it("findActiveBySystemCodeEntityTypeAndLegacyId reconstrói a referência quando encontrada, com identityPublicId correto", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) =>
        sql.includes("FROM identity_external_references") &&
        sql.includes("legacy_id = ?") &&
        sql.includes("status = 'ACTIVE'"),
      () => [
        [
          {
            id: 1,
            public_id: REFERENCE_PUBLIC_ID,
            identity_public_id: IDENTITY_PUBLIC_ID,
            system_code: "PCTEC_PORTAL",
            entity_type: "portal_acesso",
            legacy_id: 33,
            match_method: "MATCHED_MANUAL_CONFIRMED",
            status: "ACTIVE",
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);

    const result = await repository.findActiveBySystemCodeEntityTypeAndLegacyId(
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("portal_acesso"),
      LegacyId.create(33)
    );

    expect(result?.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(result?.getLegacyId().toNumber()).toBe(33);
    expect(result?.isActive()).toBe(true);
  });

  it("findActiveBySystemCodeEntityTypeAndLegacyId usa SQL parametrizado, filtra status='ACTIVE' explicitamente (SUPERSEDED nunca é retornada)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identity_external_references") && sql.includes("legacy_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);

    await repository.findActiveBySystemCodeEntityTypeAndLegacyId(
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("portal_acesso"),
      LegacyId.create(33)
    );

    const call = fake.calls.find((c) => c.sql.includes("legacy_id = ?") && !c.sql.includes("SELECT 1"));
    expect(call?.sql).toContain("status = 'ACTIVE'");
    // SQL nunca embute o legacyId — sempre via parâmetro.
    expect(call?.sql).not.toContain("33");
    expect(call?.params).toEqual(["PCTEC_PORTAL", "portal_acesso", 33]);
  });

  it("insert com MATCHED_BY_EMAIL grava o método correto no parâmetro", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("INSERT INTO identity_external_references"),
      () => [{ insertId: 99 }, []]
    );
    const repository = new MariaDbIdentityExternalReferenceRepository(fake);
    const reference = IdentityExternalReference.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 42,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000002"
    });

    await repository.insert(reference);

    const call = fake.calls.find((c) => c.sql.includes("INSERT INTO identity_external_references"));
    expect(call?.params).toContain("MATCHED_BY_EMAIL");
  });
});
