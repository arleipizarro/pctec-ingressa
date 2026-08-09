import { describe, it, expect } from "vitest";
import { MariaDbCredentialRepository } from "../infrastructure/persistence/MariaDbCredentialRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { Credential } from "../domain/Credential.js";
import { CredentialType } from "../domain/value-objects/CredentialType.js";
import { PasswordHash } from "../domain/value-objects/PasswordHash.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const VALID_PHC = "$argon2id$v=19$m=65536,p=4,t=3$c29tZXNhbHR2YWx1ZQ$c29tZWhhc2h2YWx1ZTEyMzQ1Ng";

describe("MariaDbCredentialRepository", () => {
  it("existsAnyByType retorna true quando há qualquer linha do tipo (guard global)", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM credentials") && sql.includes("type = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbCredentialRepository(fake);

    await expect(repository.existsAnyByType(CredentialType.localPassword())).resolves.toBe(true);
  });

  it("11. guard global vazio (nenhuma linha) permite prosseguir", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM credentials") && sql.includes("type = ?"),
      () => [[], []]
    );
    const repository = new MariaDbCredentialRepository(fake);

    await expect(repository.existsAnyByType(CredentialType.localPassword())).resolves.toBe(false);
  });

  it("findByIdentityAndType retorna undefined quando não encontrado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM credentials") && sql.includes("identity_public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbCredentialRepository(fake);

    const result = await repository.findByIdentityAndType(IDENTITY_PUBLIC_ID, CredentialType.localPassword());

    expect(result).toBeUndefined();
  });

  it("findByIdentityAndType reconstrói uma Credential a partir da linha encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM credentials") && sql.includes("identity_public_id = ?"),
      () => [
        [
          {
            id: 5,
            public_id: "33333333-3333-3333-3333-333333333333",
            identity_public_id: IDENTITY_PUBLIC_ID,
            type: "LOCAL_PASSWORD",
            password_hash: VALID_PHC,
            status: "ACTIVE",
            last_authenticated_at: null,
            version: 1,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z")
          }
        ],
        []
      ]
    );
    const repository = new MariaDbCredentialRepository(fake);

    const result = await repository.findByIdentityAndType(IDENTITY_PUBLIC_ID, CredentialType.localPassword());

    expect(result).toBeInstanceOf(Credential);
    expect(result?.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
  });

  it("insert usa SQL parametrizado (sem concatenação) e atribui o internalId retornado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("INSERT INTO CREDENTIALS"),
      () => [{ insertId: 7, affectedRows: 1 }, []]
    );
    const repository = new MariaDbCredentialRepository(fake);
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: PasswordHash.fromPhcString(VALID_PHC),
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000080"
    });

    await repository.insert(credential);

    expect(credential.getInternalIdForPersistence()).toBe(7);
    const insertCall = fake.calls.find((c) => c.sql.toUpperCase().includes("INSERT INTO CREDENTIALS"));
    expect(insertCall?.sql).not.toContain(IDENTITY_PUBLIC_ID); // valor nunca concatenado no SQL
    expect(insertCall?.sql).not.toContain(VALID_PHC); // hash nunca concatenado no SQL
    expect(insertCall?.params).toContain(IDENTITY_PUBLIC_ID);
    expect(insertCall?.params).toContain(VALID_PHC);
  });
});
