import { describe, it, expect } from "vitest";
import { MariaDbOrganizationRepository } from "../infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { Organization } from "../domain/Organization.js";
import { OrganizationRelationship } from "../domain/OrganizationRelationship.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { OrganizationType } from "../domain/value-objects/OrganizationType.js";

const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const CHILD_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000003";

describe("MariaDbOrganizationRepository", () => {
  it("findByPublicId retorna undefined quando nenhuma linha é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organizations") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(ORGANIZATION_PUBLIC_ID));

    expect(result).toBeUndefined();
  });

  it("findByPublicId reconstrói uma Organization a partir da linha encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organizations") && sql.includes("public_id = ?"),
      () => [
        [
          {
            id: 1,
            public_id: ORGANIZATION_PUBLIC_ID,
            type: "COMPANY",
            legal_name: "Empresa Exemplo LTDA",
            trade_name: null,
            document_number: "11222333000181",
            status: "ACTIVE",
            version: 1,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbOrganizationRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(ORGANIZATION_PUBLIC_ID));

    expect(result).toBeInstanceOf(Organization);
    expect(result?.getPublicId().toString()).toBe(ORGANIZATION_PUBLIC_ID);
    expect(result?.getDocumentNumber()?.toString()).toBe("11222333000181");
  });

  it("findByPublicId usa SQL parametrizado (sem concatenação)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organizations") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationRepository(fake);

    await repository.findByPublicId(PublicId.fromString(ORGANIZATION_PUBLIC_ID));

    const call = fake.calls.find((c) => c.sql.includes("public_id = ?"));
    expect(call?.sql).not.toContain(ORGANIZATION_PUBLIC_ID);
    expect(call?.params).toContain(ORGANIZATION_PUBLIC_ID);
  });

  it("existsByDocumentNumberAndType usa SQL parametrizado e retorna true/false conforme resultado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organizations") && sql.includes("document_number = ?") && sql.includes("type = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbOrganizationRepository(fake);
    const documentNumber = DocumentNumber.createOptional("11.222.333/0001-81")!;
    const type = OrganizationType.company();

    const exists = await repository.existsByDocumentNumberAndType(documentNumber, type);

    expect(exists).toBe(true);
    const call = fake.calls.find((c) => c.sql.includes("document_number = ?"));
    expect(call?.sql).not.toContain("11222333000181");
    expect(call?.params).toEqual(["11222333000181", "COMPANY"]);
  });

  it("insert grava public_id/type/legal_name/document_number/status/version e atribui internalId gerado pelo banco", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("INSERT INTO organizations"),
      () => [{ insertId: 55 }, []]
    );
    const repository = new MariaDbOrganizationRepository(fake);
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Nova",
      documentNumber: "11.222.333/0001-81",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });

    await repository.insert(organization);

    expect(organization.getInternalIdForPersistence()).toBe(55);
    const call = fake.calls.find((c) => c.sql.includes("INSERT INTO organizations"));
    expect(call?.params).toEqual([
      organization.getPublicId().toString(),
      "COMPANY",
      "Empresa Nova",
      null,
      "11222333000181",
      "ACTIVE",
      1,
      organization.getCreatedAt(),
      organization.getUpdatedAt()
    ]);
  });
});

describe("MariaDbOrganizationRelationshipRepository", () => {
  it("existsByChildOrganizationPublicId usa SQL parametrizado e retorna true/false", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organization_relationships") && sql.includes("child_organization_public_id = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbOrganizationRelationshipRepository(fake);

    const exists = await repository.existsByChildOrganizationPublicId(PublicId.fromString(CHILD_PUBLIC_ID));

    expect(exists).toBe(true);
    const call = fake.calls.find((c) => c.sql.includes("child_organization_public_id = ?"));
    expect(call?.sql).not.toContain(CHILD_PUBLIC_ID);
    expect(call?.params).toContain(CHILD_PUBLIC_ID);
  });

  it("existsByChildOrganizationPublicId retorna false quando nenhuma linha é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM organization_relationships") && sql.includes("child_organization_public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbOrganizationRelationshipRepository(fake);

    const exists = await repository.existsByChildOrganizationPublicId(PublicId.fromString(CHILD_PUBLIC_ID));

    expect(exists).toBe(false);
  });

  it("insert grava public_id/parent/child/created_at e atribui internalId gerado pelo banco", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("INSERT INTO organization_relationships"),
      () => [{ insertId: 3 }, []]
    );
    const repository = new MariaDbOrganizationRelationshipRepository(fake);
    const relationship = OrganizationRelationship.create({
      parentOrganizationPublicId: ORGANIZATION_PUBLIC_ID,
      childOrganizationPublicId: CHILD_PUBLIC_ID,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });

    await repository.insert(relationship);

    expect(relationship.getInternalIdForPersistence()).toBe(3);
    const call = fake.calls.find((c) => c.sql.includes("INSERT INTO organization_relationships"));
    expect(call?.params).toEqual([
      relationship.getPublicId().toString(),
      ORGANIZATION_PUBLIC_ID,
      CHILD_PUBLIC_ID,
      relationship.getCreatedAt()
    ]);
  });

  it("insert usa SQL parametrizado (sem concatenar publicIds na string SQL)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("INSERT INTO organization_relationships"),
      () => [{ insertId: 3 }, []]
    );
    const repository = new MariaDbOrganizationRelationshipRepository(fake);
    const relationship = OrganizationRelationship.create({
      parentOrganizationPublicId: ORGANIZATION_PUBLIC_ID,
      childOrganizationPublicId: CHILD_PUBLIC_ID,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });

    await repository.insert(relationship);

    const call = fake.calls.find((c) => c.sql.includes("INSERT INTO organization_relationships"));
    expect(call?.sql).not.toContain(ORGANIZATION_PUBLIC_ID);
    expect(call?.sql).not.toContain(CHILD_PUBLIC_ID);
  });
});
