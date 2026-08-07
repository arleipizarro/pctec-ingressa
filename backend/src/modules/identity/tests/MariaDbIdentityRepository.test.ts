import { describe, it, expect } from "vitest";
import { MariaDbIdentityRepository } from "../infrastructure/persistence/MariaDbIdentityRepository.js";
import { FakeQueryable } from "../../../shared/database/tests/FakeQueryable.js";
import { Identity } from "../domain/Identity.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import { IdentityVersionConflictError } from "../domain/errors/IdentityErrors.js";

const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000002";

/**
 * Estes testes nunca abrem uma conexão de rede/MariaDB real — usam
 * FakeQueryable, que responde em memória a chamadas `execute()`
 * programadas. Isso prova o comportamento de mapeamento e de construção
 * de SQL parametrizado sem depender do ambiente DEV.
 */
describe("MariaDbIdentityRepository", () => {
  it("findByPublicId retorna undefined quando nenhuma linha é encontrada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identities") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbIdentityRepository(fake);

    const result = await repository.findByPublicId(PublicId.generate());

    expect(result).toBeUndefined();
  });

  it("findByPublicId reconstrói uma Identity a partir da linha encontrada", async () => {
    const publicId = PublicId.generate().toString();
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identities") && sql.includes("public_id = ?"),
      () => [
        [
          {
            id: 7,
            public_id: publicId,
            type: "HUMAN",
            full_name: "Pessoa Teste",
            email: "pessoa@example.com",
            email_normalized: "pessoa@example.com",
            cpf: null,
            cpf_normalized: null,
            status: "PENDING",
            login_enabled: 0,
            version: 1,
            created_at: new Date("2026-01-01T00:00:00Z"),
            created_by_identity_public_id: "SYSTEM",
            updated_at: new Date("2026-01-01T00:00:00Z"),
            updated_by_identity_public_id: "SYSTEM",
            deleted_at: null,
            deleted_by_identity_public_id: null,
            deletion_reason: null
          }
        ],
        []
      ]
    );
    const repository = new MariaDbIdentityRepository(fake);

    const result = await repository.findByPublicId(PublicId.fromString(publicId));

    expect(result).toBeInstanceOf(Identity);
    expect(result?.getPublicId().toString()).toBe(publicId);
    expect(result?.getEmail().toString()).toBe("pessoa@example.com");
    expect(result?.getStatus().toString()).toBe("PENDING");
    // internalId foi carregado, mas não é exposto por nenhum getter
    // público de leitura comum — apenas pelo método de infraestrutura.
    expect(result?.getInternalIdForPersistence()).toBe(7);
  });

  it("findByPublicId usa parâmetro preparado (?), nunca concatena o publicId diretamente no SQL", async () => {
    const publicId = PublicId.generate();
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identities") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbIdentityRepository(fake);

    await repository.findByPublicId(publicId);

    const call = fake.calls.find((c) => c.sql.includes("FROM identities"));
    expect(call?.sql).not.toContain(publicId.toString());
    expect(call?.params).toContain(publicId.toString());
  });

  it("findByPublicId nunca usa SELECT * — só colunas explícitas, e nunca 'id' cru sem alias/uso controlado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("FROM identities") && sql.includes("public_id = ?"),
      () => [[], []]
    );
    const repository = new MariaDbIdentityRepository(fake);

    await repository.findByPublicId(PublicId.generate());

    const call = fake.calls.find((c) => c.sql.includes("FROM identities"));
    expect(call?.sql).not.toMatch(/SELECT\s+\*/i);
    expect(call?.sql).toContain("SELECT id, public_id");
  });

  it("existsByNormalizedEmail retorna true quando há linha correspondente", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("email_normalized = ?"),
      () => [[{ 1: 1 }], []]
    );
    const repository = new MariaDbIdentityRepository(fake);

    await expect(repository.existsByNormalizedEmail("pessoa@example.com")).resolves.toBe(true);
  });

  it("existsByNormalizedEmail retorna false quando não há linha correspondente", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("email_normalized = ?"),
      () => [[], []]
    );
    const repository = new MariaDbIdentityRepository(fake);

    await expect(repository.existsByNormalizedEmail("ninguem@example.com")).resolves.toBe(false);
  });

  it("insert usa SQL parametrizado (sem concatenação) e atribui o internalId retornado", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("INSERT INTO IDENTITIES"),
      () => [{ insertId: 99, affectedRows: 1 }, []]
    );
    const repository = new MariaDbIdentityRepository(fake);
    const identity = Identity.create({
      type: "HUMAN",
      fullName: "Nova Pessoa",
      email: "nova@example.com",
      actor: SYSTEM_ACTOR,
      correlationId: CORRELATION_ID
    });

    await repository.insert(identity);

    expect(identity.getInternalIdForPersistence()).toBe(99);
    const insertCall = fake.calls.find((call) => call.sql.toUpperCase().includes("INSERT INTO IDENTITIES"));
    expect(insertCall?.sql).not.toMatch(/nova@example\.com/); // valor nunca concatenado no SQL
    expect(insertCall?.sql).toContain("?");
    expect(insertCall?.params).toContain("nova@example.com"); // valor vai como parâmetro
  });

  it("update aplica optimistic locking: sucesso quando a versão bate", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("UPDATE IDENTITIES"),
      () => [{ affectedRows: 1 }, []]
    );
    const repository = new MariaDbIdentityRepository(fake);
    const identity = Identity.create({
      type: "HUMAN",
      fullName: "Pessoa Update",
      email: "update@example.com",
      actor: SYSTEM_ACTOR,
      correlationId: CORRELATION_ID
    });
    identity.activate({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID });

    await expect(repository.update(identity, 1)).resolves.toBeUndefined();
    const updateCall = fake.calls.find((call) => call.sql.toUpperCase().includes("UPDATE IDENTITIES"));
    expect(updateCall?.sql).toContain("WHERE public_id = ?");
    expect(updateCall?.sql).toContain("AND version = ?");
  });

  it("update lança IDENTITY_VERSION_CONFLICT quando nenhuma linha é afetada", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.trim().toUpperCase().startsWith("UPDATE IDENTITIES"),
      () => [{ affectedRows: 0 }, []]
    );
    const repository = new MariaDbIdentityRepository(fake);
    const identity = Identity.create({
      type: "HUMAN",
      fullName: "Pessoa Conflito",
      email: "conflito@example.com",
      actor: SYSTEM_ACTOR,
      correlationId: CORRELATION_ID
    });

    await expect(repository.update(identity, 1)).rejects.toThrow(IdentityVersionConflictError);
  });
});
