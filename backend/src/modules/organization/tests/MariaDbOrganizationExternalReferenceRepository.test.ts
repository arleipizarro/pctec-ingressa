import { describe, it, expect } from "vitest";
import { MariaDbOrganizationExternalReferenceRepository } from "../infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbOrganizationDocumentMatchRepository } from "../infrastructure/persistence/MariaDbOrganizationDocumentMatchRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";
import { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { OrganizationType } from "../domain/value-objects/OrganizationType.js";

const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const REFERENCE_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000002";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

describe("MariaDbOrganizationExternalReferenceRepository", () => {
  it("findByPublicId retorna undefined quando nenhuma linha é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organization_external_references") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationExternalReferenceRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(REFERENCE_PUBLIC_ID));

    expect(result).toBeUndefined();
  });

  it("findByPublicId reconstrói a partir da linha encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organization_external_references") && sql.includes("public_id = ?"),
      () => [
        [
          {
            id: 1,
            public_id: REFERENCE_PUBLIC_ID,
            organization_public_id: ORGANIZATION_PUBLIC_ID,
            system_code: "PCTEC_HUB",
            entity_type: "clientes",
            legacy_id: 42,
            status: "ACTIVE",
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbOrganizationExternalReferenceRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(REFERENCE_PUBLIC_ID));

    expect(result).toBeInstanceOf(OrganizationExternalReference);
    expect(result?.getLegacyId().toString()).toBe("42");
  });

  it("existsActiveBySystemCodeEntityTypeAndLegacyId usa SQL parametrizado, filtra status='ACTIVE', e retorna true/false", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organization_external_references") && sql.includes("legacy_id = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbOrganizationExternalReferenceRepository(fake);

    const exists = await repository.existsActiveBySystemCodeEntityTypeAndLegacyId(
      SystemCode.create("PCTEC_HUB"),
      EntityType.create("clientes"),
      LegacyId.create(42)
    );

    expect(exists).toBe(true);
    const call = fake.calls.find((c) => c.sql.includes("legacy_id = ?"));
    // Referências SUPERSEDED nunca contam para esta checagem — a query
    // real filtra explicitamente por status='ACTIVE'.
    expect(call?.sql).toContain("status = 'ACTIVE'");
    expect(call?.params).toEqual(["PCTEC_HUB", "clientes", 42]);
  });

  it("insert grava todas as colunas e atribui internalId gerado pelo banco", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("INSERT INTO organization_external_references"),
      () => [{ insertId: 8 }, []]
    );
    const repository = new MariaDbOrganizationExternalReferenceRepository(fake);
    const reference = OrganizationExternalReference.create({
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 5,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });

    await repository.insert(reference);

    expect(reference.getInternalIdForPersistence()).toBe(8);
    const call = fake.calls.find((c) => c.sql.includes("INSERT INTO organization_external_references"));
    expect(call?.params).toEqual([
      reference.getPublicId().toString(),
      ORGANIZATION_PUBLIC_ID,
      "PCTEC_PORTAL",
      "clientes",
      5,
      "ACTIVE",
      reference.getCreatedAt(),
      reference.getUpdatedAt()
    ]);
  });

  it("findActiveByOrganizationSystemCodeAndEntityType (P1 Portal, v0.7.x) retorna undefined quando nenhuma linha ACTIVE é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) =>
        sql.includes("FROM organization_external_references") &&
        sql.includes("organization_public_id = ?") &&
        sql.includes("status = 'ACTIVE'"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationExternalReferenceRepository(fake);

    const result = await repository.findActiveByOrganizationSystemCodeAndEntityType(
      PublicId.fromString(ORGANIZATION_PUBLIC_ID),
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("clientes")
    );

    expect(result).toBeUndefined();
  });

  it("findActiveByOrganizationSystemCodeAndEntityType reconstrói a referência quando encontrada, com legacyId correto", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) =>
        sql.includes("FROM organization_external_references") &&
        sql.includes("organization_public_id = ?") &&
        sql.includes("status = 'ACTIVE'"),
      () => [
        [
          {
            id: 1,
            public_id: REFERENCE_PUBLIC_ID,
            organization_public_id: ORGANIZATION_PUBLIC_ID,
            system_code: "PCTEC_PORTAL",
            entity_type: "clientes",
            legacy_id: 75,
            status: "ACTIVE",
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbOrganizationExternalReferenceRepository(fake);

    const result = await repository.findActiveByOrganizationSystemCodeAndEntityType(
      PublicId.fromString(ORGANIZATION_PUBLIC_ID),
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("clientes")
    );

    expect(result?.getLegacyId().toNumber()).toBe(75);
    expect(result?.isActive()).toBe(true);
  });

  it("findActiveByOrganizationSystemCodeAndEntityType usa SQL parametrizado, filtra status='ACTIVE' explicitamente (SUPERSEDED nunca é retornada)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organization_external_references") && sql.includes("organization_public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationExternalReferenceRepository(fake);

    await repository.findActiveByOrganizationSystemCodeAndEntityType(
      PublicId.fromString(ORGANIZATION_PUBLIC_ID),
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("clientes")
    );

    const call = fake.calls.find((c) => c.sql.includes("organization_public_id = ?"));
    expect(call?.sql).toContain("status = 'ACTIVE'");
    expect(call?.sql).not.toContain(ORGANIZATION_PUBLIC_ID);
    expect(call?.params).toEqual([ORGANIZATION_PUBLIC_ID, "PCTEC_PORTAL", "clientes"]);
  });
});

describe("MariaDbOrganizationDocumentMatchRepository", () => {
  it("findAllByDocumentNumberAndType retorna lista vazia quando nenhuma candidata existe", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organizations") && sql.includes("document_number = ?"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationDocumentMatchRepository(fake);

    const results = await repository.findAllByDocumentNumberAndType(
      DocumentNumber.createOptional("11.222.333/0001-81")!,
      OrganizationType.company()
    );

    expect(results).toHaveLength(0);
  });

  it("findAllByDocumentNumberAndType retorna MÚLTIPLAS candidatas (caso AMBIGUOUS)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organizations") && sql.includes("document_number = ?"),
      () => [
        [
          {
            id: 1,
            public_id: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
            type: "COMPANY",
            legal_name: "Empresa A",
            trade_name: null,
            document_number: "11222333000181",
            status: "ACTIVE",
            version: 1,
            created_at: new Date(),
            updated_at: new Date()
          },
          {
            id: 2,
            public_id: "0b13f6f0-8f3a-4a1e-9c2d-000000000002",
            type: "COMPANY",
            legal_name: "Empresa B (mesmo CNPJ por erro de cadastro legado)",
            trade_name: null,
            document_number: "11222333000181",
            status: "ACTIVE",
            version: 1,
            created_at: new Date(),
            updated_at: new Date()
          }
        ],
        []
      ]
    );
    const repository = new MariaDbOrganizationDocumentMatchRepository(fake);

    const results = await repository.findAllByDocumentNumberAndType(
      DocumentNumber.createOptional("11.222.333/0001-81")!,
      OrganizationType.company()
    );

    expect(results).toHaveLength(2);
  });

  it("usa SQL parametrizado (sem concatenação)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organizations") && sql.includes("document_number = ?"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationDocumentMatchRepository(fake);

    await repository.findAllByDocumentNumberAndType(
      DocumentNumber.createOptional("11.222.333/0001-81")!,
      OrganizationType.company()
    );

    const call = fake.calls.find((c) => c.sql.includes("document_number = ?"));
    expect(call?.sql).not.toContain("11222333000181");
    expect(call?.params).toEqual(["11222333000181", "COMPANY"]);
  });
});
