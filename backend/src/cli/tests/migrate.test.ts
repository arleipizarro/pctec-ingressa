import { describe, expect, it } from "vitest";
import { parseArgs, executeMigrateCommand, type DestructiveGateEnv } from "../migrate.js";
import { MigrationRunner, type MigrationDefinition } from "../../shared/database/MigrationRunner.js";
import { FakeQueryable } from "../../shared/database/tests/FakeQueryable.js";

const MIGRATIONS: MigrationDefinition[] = [
  { id: "0001_a", description: "a", up: "CREATE TABLE a (id INT)", down: "DROP TABLE a" },
  { id: "0002_b", description: "b", up: "CREATE TABLE b (id INT)", down: "DROP TABLE b" }
];

describe("parseArgs", () => {
  it("aceita status/up/down/down-all", () => {
    expect(parseArgs(["status"]).command).toBe("status");
    expect(parseArgs(["up"]).command).toBe("up");
    expect(parseArgs(["down"]).command).toBe("down");
    expect(parseArgs(["down-all"]).command).toBe("down-all");
  });

  it("reconhece --dry-run e --yes independente da ordem", () => {
    expect(parseArgs(["up", "--dry-run"])).toEqual({ command: "up", dryRun: true, yes: false });
    expect(parseArgs(["down", "--yes"])).toEqual({ command: "down", dryRun: false, yes: true });
    expect(parseArgs(["down-all", "--dry-run", "--yes"])).toEqual({ command: "down-all", dryRun: true, yes: true });
  });

  it("comando desconhecido ou ausente lança erro claro", () => {
    expect(() => parseArgs([])).toThrow(/Comando desconhecido/);
    expect(() => parseArgs(["destruir-tudo"])).toThrow(/Comando desconhecido/);
  });
});

describe("executeMigrateCommand — status", () => {
  it("retorna 0 quando não há checksum_mismatch", async () => {
    const runner = new MigrationRunner(new FakeQueryable());
    const exitCode = await executeMigrateCommand(runner, MIGRATIONS, { command: "status", dryRun: false, yes: false });
    expect(exitCode).toBe(0);
  });

  it("retorna 1 quando há checksum_mismatch (sinaliza drift para quem chama o CLI)", async () => {
    const fake = new FakeQueryable();
    fake.seedAppliedMigration("0001_a", { checksum: "0".repeat(64) });
    const runner = new MigrationRunner(fake);

    const exitCode = await executeMigrateCommand(runner, MIGRATIONS, { command: "status", dryRun: false, yes: false });
    expect(exitCode).toBe(1);
  });

  it("nunca escreve nada no banco (comando de leitura pura)", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await executeMigrateCommand(runner, MIGRATIONS, { command: "status", dryRun: false, yes: false });

    const writeCalls = fake.calls.filter((call) => /^(INSERT|UPDATE|DELETE)/i.test(call.sql.trim()));
    expect(writeCalls).toEqual([]);
  });
});

describe("executeMigrateCommand — up", () => {
  it("--dry-run nunca aplica nada, só reporta o que seria aplicado", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    const logs: string[] = [];

    await executeMigrateCommand(runner, MIGRATIONS, { command: "up", dryRun: true, yes: false }, (line) => logs.push(line));

    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state === "pending")).toBe(true);
    expect(logs.join("\n")).toContain("dry-run");
    expect(logs.join("\n")).toContain("0001_a");
  });

  it("sem --dry-run, aplica de verdade as pendentes", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);

    await executeMigrateCommand(runner, MIGRATIONS, { command: "up", dryRun: false, yes: false });

    const status = await runner.status(MIGRATIONS);
    // Este conjunto de teste não inclui uma migration que crie a coluna
    // checksum (equivalente à 0004 real) — então, mesmo aplicadas com
    // sucesso, ficam "checksum_unknown" (sem coluna para registrar o
    // checksum), nunca "applied". O que importa aqui é que nenhuma ficou
    // "pending".
    expect(status.every((entry) => entry.state !== "pending")).toBe(true);
  });
});

describe("executeMigrateCommand — down / down-all (gate duplo: --yes E MIGRATIONS_ALLOW_DESTRUCTIVE=true)", () => {
  const DEV: DestructiveGateEnv = { nodeEnv: "development", allowDestructiveEnvVar: true };

  it("sem --yes (mesmo com a variável true): não reverte nada, só mostra preview, exit code 1", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    const logs: string[] = [];

    const exitCode = await executeMigrateCommand(
      runner,
      MIGRATIONS,
      { command: "down", dryRun: false, yes: false },
      (line) => logs.push(line),
      DEV
    );

    expect(exitCode).toBe(1);
    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state !== "pending")).toBe(true);
    expect(logs.join("\n")).toContain("--yes");
    expect(fake.calls.some((c) => c.sql.includes("DROP TABLE"))).toBe(false);
  });

  it("com --yes mas SEM MIGRATIONS_ALLOW_DESTRUCTIVE=true: não reverte nada, exit code 1", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    const logs: string[] = [];

    const exitCode = await executeMigrateCommand(
      runner,
      MIGRATIONS,
      { command: "down", dryRun: false, yes: true },
      (line) => logs.push(line),
      { nodeEnv: "development", allowDestructiveEnvVar: false }
    );

    expect(exitCode).toBe(1);
    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state !== "pending")).toBe(true);
    expect(logs.join("\n")).toContain("MIGRATIONS_ALLOW_DESTRUCTIVE");
    expect(fake.calls.some((c) => c.sql.includes("DROP TABLE"))).toBe(false);
  });

  it("--yes E MIGRATIONS_ALLOW_DESTRUCTIVE=true, em development: reverte de fato, exit code 0", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);

    const exitCode = await executeMigrateCommand(runner, MIGRATIONS, { command: "down", dryRun: false, yes: true }, undefined, DEV);

    expect(exitCode).toBe(0);
    const status = await runner.status(MIGRATIONS);
    expect(status.find((e) => e.id === "0002_b")?.state).toBe("pending");
  });

  it("NODE_ENV=production: recusa SEMPRE, mesmo com --yes E MIGRATIONS_ALLOW_DESTRUCTIVE=true, exit code 2, nenhum SQL down executado", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    const logs: string[] = [];

    const exitCode = await executeMigrateCommand(
      runner,
      MIGRATIONS,
      { command: "down", dryRun: false, yes: true },
      (line) => logs.push(line),
      { nodeEnv: "production", allowDestructiveEnvVar: true }
    );

    expect(exitCode).toBe(2);
    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state !== "pending")).toBe(true);
    expect(logs.join("\n")).toContain("production");
    expect(fake.calls.some((c) => c.sql.includes("DROP TABLE"))).toBe(false);
  });

  it("--dry-run nunca reverte, mesmo com --yes E MIGRATIONS_ALLOW_DESTRUCTIVE=true", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);

    await executeMigrateCommand(runner, MIGRATIONS, { command: "down", dryRun: true, yes: true }, undefined, DEV);

    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state !== "pending")).toBe(true);
  });

  it("down-all com os dois gates: reverte todas, em ordem reversa", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);

    await executeMigrateCommand(runner, MIGRATIONS, { command: "down-all", dryRun: false, yes: true }, undefined, DEV);

    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state === "pending")).toBe(true);
  });

  it("down-all sem os gates: preview lista TODAS as aplicadas, mas não reverte nenhuma", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    const logs: string[] = [];

    await executeMigrateCommand(runner, MIGRATIONS, { command: "down-all", dryRun: false, yes: false }, (line) => logs.push(line));

    expect(logs.join("\n")).toContain("0001_a");
    expect(logs.join("\n")).toContain("0002_b");
    const status = await runner.status(MIGRATIONS);
    expect(status.every((entry) => entry.state !== "pending")).toBe(true);
  });

  it("nenhuma senha/credencial aparece em nenhum log emitido pelo CLI, em qualquer cenário destrutivo", async () => {
    const fake = new FakeQueryable();
    const runner = new MigrationRunner(fake);
    await runner.applyPending(MIGRATIONS);
    const logs: string[] = [];

    await executeMigrateCommand(runner, MIGRATIONS, { command: "down-all", dryRun: false, yes: true }, (line) => logs.push(line), {
      nodeEnv: "production",
      allowDestructiveEnvVar: true
    });

    const allLogs = logs.join("\n").toLowerCase();
    expect(allLogs).not.toContain("password");
    expect(allLogs).not.toContain("senha");
  });
});
