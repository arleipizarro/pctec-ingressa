import { describe, it, expect, vi } from "vitest";
import type { Server } from "node:http";
import { assertIntegrationSchemaReady, cleanupIntegrationTest, type IntegrationTestState } from "./integrationTestSupport.js";
import { FakeQueryable } from "../../../../shared/database/tests/FakeQueryable.js";

describe("assertIntegrationSchemaReady", () => {
  it("nunca executa CREATE/ALTER/DROP — só SELECT contra information_schema.tables", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("information_schema.tables"),
      () => [[{ total: 1 }], []]
    );

    await assertIntegrationSchemaReady(fake, ["identities", "audit_events"]);

    for (const call of fake.calls) {
      expect(call.sql.toUpperCase()).not.toMatch(/\b(CREATE|ALTER|DROP)\b/);
    }
    expect(fake.calls.every((c) => c.sql.toUpperCase().startsWith("SELECT"))).toBe(true);
  });

  it("não lança quando todas as tabelas exigidas existem", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("information_schema.tables"),
      () => [[{ total: 1 }], []]
    );

    await expect(assertIntegrationSchemaReady(fake, ["identities", "audit_events"])).resolves.toBeUndefined();
  });

  it("lança erro claro e orientativo quando uma tabela exigida está ausente — nunca tenta criá-la", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql) => sql.includes("information_schema.tables"),
      () => [[{ total: 0 }], []]
    );

    await expect(assertIntegrationSchemaReady(fake, ["identities"])).rejects.toThrow(
      /Integration schema is not prepared; run migrations separately/
    );
    // Nenhuma tentativa de CREATE TABLE em resposta à ausência.
    expect(fake.calls.some((c) => c.sql.toUpperCase().includes("CREATE TABLE"))).toBe(false);
  });

  it("verifica cada tabela da lista — para no primeiro erro, nomeando a tabela ausente", async () => {
    const fake = new FakeQueryable();
    fake.whenExecute(
      (sql, params) => sql.includes("information_schema.tables") && params?.[0] === "identities",
      () => [[{ total: 1 }], []]
    );
    fake.whenExecute(
      (sql, params) => sql.includes("information_schema.tables") && params?.[0] === "audit_events",
      () => [[{ total: 0 }], []]
    );

    await expect(assertIntegrationSchemaReady(fake, ["identities", "audit_events"])).rejects.toThrow(/audit_events/);
  });
});

describe("cleanupIntegrationTest", () => {
  it("quando server e pool nunca foram definidos (setup falhou antes de criá-los): não lança, não faz nada", async () => {
    const state: IntegrationTestState = {};
    await expect(cleanupIntegrationTest(state)).resolves.toBeUndefined();
  });

  it("quando só o pool foi criado (server nunca chegou a existir): fecha o pool, nunca tenta server.close", async () => {
    const endMock = vi.fn().mockResolvedValue(undefined);
    const state: IntegrationTestState = {
      pool: { execute: vi.fn().mockResolvedValue([[], []]), end: endMock }
    };

    await cleanupIntegrationTest(state);

    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it("remove a fixture pela chave específica (fixturePublicId) antes de encerrar o pool", async () => {
    const calls: string[] = [];
    const executeMock = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      calls.push(`${sql}|${JSON.stringify(params)}`);
      return [[], []] as [unknown, unknown];
    });
    const state: IntegrationTestState = {
      pool: { execute: executeMock, end: vi.fn().mockResolvedValue(undefined) },
      fixturePublicId: "a0000000-0000-4000-8000-000000000001"
    };

    await cleanupIntegrationTest(state);

    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM identities WHERE public_id = ?"),
      ["a0000000-0000-4000-8000-000000000001"]
    );
  });

  it("sem fixturePublicId definido: nunca executa DELETE genérico algum", async () => {
    const executeMock = vi.fn().mockResolvedValue([[], []]);
    const state: IntegrationTestState = {
      pool: { execute: executeMock, end: vi.fn().mockResolvedValue(undefined) }
    };

    await cleanupIntegrationTest(state);

    expect(executeMock).not.toHaveBeenCalled();
  });

  it("quando server.close falha: ainda assim tenta limpar a fixture e fechar o pool (uma etapa falhando não impede as demais)", async () => {
    const closeMock = vi.fn((callback: (err?: Error) => void) => callback(new Error("falha simulada ao fechar servidor")));
    const executeMock = vi.fn().mockResolvedValue([[], []]);
    const endMock = vi.fn().mockResolvedValue(undefined);
    const state: IntegrationTestState = {
      server: { close: closeMock } as unknown as Server,
      pool: { execute: executeMock, end: endMock },
      fixturePublicId: "a0000000-0000-4000-8000-000000000001"
    };

    await expect(cleanupIntegrationTest(state)).resolves.toBeUndefined(); // nunca relança — não mascara o erro original do teste
    expect(executeMock).toHaveBeenCalled();
    expect(endMock).toHaveBeenCalled();
  });

  it("quando a remoção da fixture falha: ainda assim tenta fechar o pool, e nunca lança (não mascara o erro original)", async () => {
    const executeMock = vi.fn().mockRejectedValue(new Error("falha simulada de DELETE"));
    const endMock = vi.fn().mockResolvedValue(undefined);
    const state: IntegrationTestState = {
      pool: { execute: executeMock, end: endMock },
      fixturePublicId: "a0000000-0000-4000-8000-000000000001"
    };

    await expect(cleanupIntegrationTest(state)).resolves.toBeUndefined();
    expect(endMock).toHaveBeenCalled();
  });

  it("é idempotente — chamar duas vezes seguidas não lança", async () => {
    const state: IntegrationTestState = {
      pool: { execute: vi.fn().mockResolvedValue([[], []]), end: vi.fn().mockResolvedValue(undefined) },
      fixturePublicId: "a0000000-0000-4000-8000-000000000001"
    };

    await cleanupIntegrationTest(state);
    await expect(cleanupIntegrationTest(state)).resolves.toBeUndefined();
  });
});
