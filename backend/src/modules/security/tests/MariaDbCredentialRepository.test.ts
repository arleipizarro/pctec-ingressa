import { describe, it, expect } from "vitest";
import { MariaDbCredentialRepository } from "../infrastructure/persistence/MariaDbCredentialRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { Credential } from "../domain/Credential.js";
import { CredentialType } from "../domain/value-objects/CredentialType.js";
import { PasswordHash } from "../domain/value-objects/PasswordHash.js";
import { CredentialVersionConflictError } from "../domain/errors/CredentialErrors.js";

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

  it("[PROVA EXATA — revisão crítica, item 3] recordSuccessfulAuthentication() + update(): SET version=2 (absoluto), WHERE version=1 (original), nunca 'version + 1'", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("UPDATE CREDENTIALS"),
      () => [{ affectedRows: 1 }, []]
    );
    const repository = new MariaDbCredentialRepository(fake);
    const credential = Credential.reconstitute({
      internalId: 1,
      publicId: "55555555-5555-5555-5555-555555555555",
      identityPublicId: IDENTITY_PUBLIC_ID,
      type: "LOCAL_PASSWORD",
      passwordHash: VALID_PHC,
      status: "ACTIVE",
      lastAuthenticatedAt: undefined,
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z")
    });

    // Estado inicial: version = 1, lastAuthenticatedAt = undefined.
    expect(credential.getVersion()).toBe(1);
    expect(credential.getLastAuthenticatedAt()).toBeUndefined();
    const originalVersion = credential.getVersion();

    credential.recordSuccessfulAuthentication(new Date("2026-01-02T10:00:00Z"));
    expect(credential.getVersion()).toBe(2); // version final, em memória

    await repository.update(credential, originalVersion);

    const updateCall = fake.calls.find((c) => c.sql.toUpperCase().includes("UPDATE CREDENTIALS"));
    expect(updateCall).toBeDefined();
    expect(updateCall?.sql).not.toContain("version + 1"); // nunca incremento relativo hardcoded
    expect(updateCall?.sql).toContain("version = ?");
    expect(updateCall?.sql).toContain("WHERE public_id = ?");
    expect(updateCall?.sql).toContain("AND version = ?");

    // params: [last_authenticated_at, status, version(SET), updated_at, public_id, expectedVersion(WHERE)]
    expect(updateCall?.params?.[2]).toBe(2); // SET version = 2 (absoluto, final)
    const lastParamIndex = (updateCall?.params?.length ?? 1) - 1;
    expect(updateCall?.params?.[lastParamIndex]).toBe(1); // WHERE version = 1 (original)
    expect(updateCall?.params?.[0]).toEqual(new Date("2026-01-02T10:00:00Z")); // last_authenticated_at setado
  });

  it("update() lança CredentialVersionConflictError quando affectedRows=0 — nada é silenciosamente aceito", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("UPDATE CREDENTIALS"),
      () => [{ affectedRows: 0 }, []]
    );
    const repository = new MariaDbCredentialRepository(fake);
    const credential = Credential.reconstitute({
      internalId: 1,
      publicId: "55555555-5555-5555-5555-555555555555",
      identityPublicId: IDENTITY_PUBLIC_ID,
      type: "LOCAL_PASSWORD",
      passwordHash: VALID_PHC,
      status: "ACTIVE",
      lastAuthenticatedAt: undefined,
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z")
    });
    credential.recordSuccessfulAuthentication();

    await expect(repository.update(credential, 1)).rejects.toThrow(CredentialVersionConflictError);
  });
});
