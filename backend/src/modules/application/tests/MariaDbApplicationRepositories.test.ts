import { describe, it, expect } from "vitest";
import { MariaDbApplicationRepository } from "../infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { ApplicationCode } from "../domain/value-objects/ApplicationCode.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { Application } from "../domain/Application.js";
import { ApplicationAccess } from "../domain/ApplicationAccess.js";

const APPLICATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

describe("MariaDbApplicationRepository", () => {
  it("findByCode retorna undefined quando nenhuma linha é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM applications") && sql.includes("code = ?"),
      () => [[], []]
    );
    const repository = new MariaDbApplicationRepository(fake);

    const result = await repository.findByCode(ApplicationCode.create("PCTEC_INGRESSA"));

    expect(result).toBeUndefined();
  });

  it("findByCode reconstrói uma Application a partir da linha encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM applications") && sql.includes("code = ?"),
      () => [
        [
          {
            id: 1,
            public_id: APPLICATION_PUBLIC_ID,
            code: "PCTEC_INGRESSA",
            name: "PCTEC Ingressa",
            status: "ACTIVE",
            version: 1,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbApplicationRepository(fake);

    const result = await repository.findByCode(ApplicationCode.create("PCTEC_INGRESSA"));

    expect(result).toBeInstanceOf(Application);
    expect(result?.getPublicId().toString()).toBe(APPLICATION_PUBLIC_ID);
  });

  it("findByPublicId usa SQL parametrizado (sem concatenação)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM applications") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbApplicationRepository(fake);

    await repository.findByPublicId(PublicId.fromString(APPLICATION_PUBLIC_ID));

    const call = fake.calls.find((c) => c.sql.includes("public_id = ?"));
    expect(call?.sql).not.toContain(APPLICATION_PUBLIC_ID);
    expect(call?.params).toContain(APPLICATION_PUBLIC_ID);
  });
});

describe("MariaDbApplicationAccessRepository", () => {
  it("existsGrantedByApplicationAndProfile retorna true quando há linha correspondente", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("application_public_id = ?") && !sql.includes("identity_public_id = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbApplicationAccessRepository(fake);

    await expect(
      repository.existsGrantedByApplicationAndProfile(APPLICATION_PUBLIC_ID, "ADMIN")
    ).resolves.toBe(true);
  });

  it("existsGrantedByIdentityApplicationAndProfile retorna false quando não há linha correspondente", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("identity_public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbApplicationAccessRepository(fake);

    await expect(
      repository.existsGrantedByIdentityApplicationAndProfile(IDENTITY_PUBLIC_ID, APPLICATION_PUBLIC_ID, "ADMIN")
    ).resolves.toBe(false);
  });

  it("insert usa SQL parametrizado e atribui o internalId retornado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("INSERT INTO APPLICATION_ACCESSES"),
      () => [{ insertId: 42, affectedRows: 1 }, []]
    );
    const repository = new MariaDbApplicationAccessRepository(fake);
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000060"
    });

    await repository.insert(applicationAccess);

    expect(applicationAccess.getInternalIdForPersistence()).toBe(42);
    const insertCall = fake.calls.find((c) => c.sql.toUpperCase().includes("INSERT INTO APPLICATION_ACCESSES"));
    expect(insertCall?.sql).not.toContain(IDENTITY_PUBLIC_ID); // valor nunca concatenado no SQL
    expect(insertCall?.params).toContain(IDENTITY_PUBLIC_ID); // valor vai como parâmetro
    expect(insertCall?.params?.[6]).toBeNull(); // granted_by_identity_public_id
  });
});
