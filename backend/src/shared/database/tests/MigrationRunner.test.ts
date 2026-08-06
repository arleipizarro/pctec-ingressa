import { describe, it, expect } from "vitest";
import { MigrationRunner, type MigrationDefinition } from "../MigrationRunner.js";
import { FakeQueryable } from "./FakeQueryable.js";

const MIGRATIONS: MigrationDefinition[] = [
  { id: "0001_create_schema_migrations", description: "a", up: "CREATE TABLE a (id INT)", down: "DROP TABLE a" },
  { id: "0002_create_identities", description: "b", up: "CREATE TABLE identities (id INT)", down: "DROP TABLE identities" },
  { id: "0003_create_audit_events", description: "c", up: "CREATE TABLE audit_events (id INT)", down: "DROP TABLE audit_events" }
];

describe("MigrationRunner", () => {
  it("aplica todas as migrations pendentes, em ordem, quando nenhuma foi aplicada ainda", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    const report = await runner.applyPending(MIGRATIONS);

    expect(report.appliedIds).toEqual([
      "0001_create_schema_migrations",
      "0002_create_identities",
      "0003_create_audit_events"
    ]);
    expect(report.alreadyAppliedIds).toEqual([]);
  });

  it("é idempotente: rodar novamente não reaplica migrations já registradas", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);
    const secondReport = await runner.applyPending(MIGRATIONS);

    expect(secondReport.appliedIds).toEqual([]);
    expect(secondReport.alreadyAppliedIds).toEqual([
      "0001_create_schema_migrations",
      "0002_create_identities",
      "0003_create_audit_events"
    ]);
  });

  it("aplica apenas as migrations novas quando algumas já foram registradas", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS.slice(0, 2));
    const report = await runner.applyPending(MIGRATIONS);

    expect(report.appliedIds).toEqual(["0003_create_audit_events"]);
    expect(report.alreadyAppliedIds).toEqual(["0001_create_schema_migrations", "0002_create_identities"]);
  });

  it("nunca executa nenhum SQL contra um banco real — apenas contra o Queryable fake fornecido", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await runner.applyPending(MIGRATIONS);

    // Toda chamada de execute() foi registrada no fake em memória — não
    // há nenhuma conexão de rede/mysql2 real envolvida neste teste.
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.some((call) => call.sql.includes("CREATE TABLE identities"))).toBe(true);
  });
});
