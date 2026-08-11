import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  evaluateBootstrapWriteGate,
  loadLegacyRecords,
  formatReport
} from "../bootstrap-organizations-from-legacy.js";
import type { BootstrapOrganizationsResult } from "../../modules/organization/application/BootstrapOrganizationsService.js";

describe("parseArgs", () => {
  it("exige inputFilePath, sem flags = execute/createIfUnmatched=false, actor=SYSTEM", () => {
    expect(parseArgs(["registros.json"])).toEqual({
      inputFilePath: "registros.json",
      execute: false,
      createIfUnmatched: false,
      actorPublicId: "SYSTEM"
    });
  });

  it("reconhece --execute e --create-if-unmatched", () => {
    const args = parseArgs(["registros.json", "--execute", "--create-if-unmatched"]);
    expect(args.execute).toBe(true);
    expect(args.createIfUnmatched).toBe(true);
  });

  it("reconhece --actor <publicId>", () => {
    const args = parseArgs(["registros.json", "--actor", "66231e51-66fb-466d-af4f-ac7b925ca9ec"]);
    expect(args.actorPublicId).toBe("66231e51-66fb-466d-af4f-ac7b925ca9ec");
  });

  it("lança erro sem inputFilePath", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
  });

  it("lança erro se --actor não for seguido de um valor", () => {
    expect(() => parseArgs(["registros.json", "--actor"])).toThrow(/--actor exige/);
  });
});

describe("evaluateBootstrapWriteGate — mesmo princípio de evaluateDestructiveGate (migrate.ts)", () => {
  const baseArgs = { inputFilePath: "x.json", execute: true, createIfUnmatched: false, actorPublicId: "SYSTEM" };

  it("bloqueia SEMPRE em NODE_ENV=production, mesmo com --execute e env var true", () => {
    const decision = evaluateBootstrapWriteGate(baseArgs, { nodeEnv: "production", allowWriteEnvVar: true });
    expect(decision).toEqual({ allowed: false, reason: "production" });
  });

  it("bloqueia sem --execute, mesmo com env var true", () => {
    const decision = evaluateBootstrapWriteGate(
      { ...baseArgs, execute: false },
      { nodeEnv: "development", allowWriteEnvVar: true }
    );
    expect(decision).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("bloqueia com --execute mas SEM a env var BOOTSTRAP_ALLOW_WRITE=true", () => {
    const decision = evaluateBootstrapWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: false });
    expect(decision).toEqual({ allowed: false, reason: "missing_env_var" });
  });

  it("permite escrita SOMENTE com as DUAS condições simultâneas e NODE_ENV != production", () => {
    const decision = evaluateBootstrapWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: true });
    expect(decision).toEqual({ allowed: true });
  });
});

describe("loadLegacyRecords", () => {
  it("lê um array JSON válido de LegacyOrganizationRecord", () => {
    const dir = mkdtempSync(join(tmpdir(), "bootstrap-test-"));
    const filePath = join(dir, "registros.json");
    writeFileSync(
      filePath,
      JSON.stringify([
        { systemCode: "PCTEC_HUB", entityType: "clientes", legacyId: 1, legalName: "Empresa X", type: "COMPANY" }
      ])
    );

    const records = loadLegacyRecords(filePath);

    expect(records).toHaveLength(1);
    expect(records[0]?.systemCode).toBe("PCTEC_HUB");
    rmSync(dir, { recursive: true, force: true });
  });

  it("lança erro se o conteúdo não for um array", () => {
    const dir = mkdtempSync(join(tmpdir(), "bootstrap-test-"));
    const filePath = join(dir, "invalido.json");
    writeFileSync(filePath, JSON.stringify({ foo: "bar" }));

    expect(() => loadLegacyRecords(filePath)).toThrow(/deve conter um array/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("formatReport", () => {
  it("indica claramente DRY-RUN quando dryRun=true", () => {
    const result: BootstrapOrganizationsResult = {
      dryRun: true,
      entries: [
        {
          systemCode: "PCTEC_HUB",
          entityType: "clientes",
          legacyId: "1",
          classification: "MATCHED",
          reason: "teste"
        }
      ],
      summary: { matched: 1, unmatched: 0, conflict: 0 }
    };

    const report = formatReport(result);

    expect(report).toContain("DRY-RUN");
    expect(report).toContain("MATCHED=1 UNMATCHED=0 CONFLICT=0");
  });

  it("indica EXECUÇÃO REAL quando dryRun=false", () => {
    const result: BootstrapOrganizationsResult = {
      dryRun: false,
      entries: [],
      summary: { matched: 0, unmatched: 0, conflict: 0 }
    };

    expect(formatReport(result)).toContain("EXECUÇÃO REAL");
  });
});
