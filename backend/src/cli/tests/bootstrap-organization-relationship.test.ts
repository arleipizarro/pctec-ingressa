import { describe, it, expect } from "vitest";
import { parseArgs, evaluateRelationshipWriteGate } from "../bootstrap-organization-relationship.js";

describe("parseArgs", () => {
  it("exige parentOrganizationPublicId + childOrganizationPublicId; sem flags = execute=false, actor=undefined", () => {
    expect(parseArgs(["0b13f6f0-8f3a-4a1e-9c2d-000000000001", "0b13f6f0-8f3a-4a1e-9c2d-000000000002"])).toEqual({
      parentOrganizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      childOrganizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000002",
      execute: false,
      actorPublicId: undefined
    });
  });

  it("reconhece --execute e --actor", () => {
    const args = parseArgs([
      "org-pai",
      "org-filha",
      "--execute",
      "--actor",
      "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    ]);
    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("lança erro quando parentOrganizationPublicId ou childOrganizationPublicId estão ausentes", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
    expect(() => parseArgs(["só-um-arg"])).toThrow(/Uso:/);
  });

  it("lança erro se --actor não for seguido de um valor", () => {
    expect(() => parseArgs(["org-pai", "org-filha", "--actor"])).toThrow(/--actor exige/);
  });
});

describe("evaluateRelationshipWriteGate — mesmo gate duplo + --actor obrigatório em execute", () => {
  const baseArgsWithActor = {
    parentOrganizationPublicId: "org-pai",
    childOrganizationPublicId: "org-filha",
    execute: true,
    actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
  };

  it("bloqueia SEMPRE em NODE_ENV=production, mesmo com --actor e env var true", () => {
    expect(evaluateRelationshipWriteGate(baseArgsWithActor, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("dry-run sem --actor É PERMITIDO — actor só é exigido quando execute=true", () => {
    const dryRunWithoutActor = { ...baseArgsWithActor, execute: false, actorPublicId: undefined };
    expect(
      evaluateRelationshipWriteGate(dryRunWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("execute SEM --actor -> REJEITADO com motivo próprio (missing_actor_for_execute)", () => {
    const executeWithoutActor = { ...baseArgsWithActor, actorPublicId: undefined };
    expect(
      evaluateRelationshipWriteGate(executeWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_actor_for_execute" });
  });

  it("execute COM --actor, mas sem BOOTSTRAP_ALLOW_WRITE=true -> ainda bloqueado", () => {
    expect(evaluateRelationshipWriteGate(baseArgsWithActor, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("execute COM --actor -> PERMITIDO quando as demais condições também são satisfeitas", () => {
    const decision = evaluateRelationshipWriteGate(baseArgsWithActor, { nodeEnv: "development", allowWriteEnvVar: true });
    expect(decision).toEqual({ allowed: true, actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099" });
  });
});

describe("estrutura do arquivo — reaproveita CreateOrganizationRelationshipService, nenhuma query/insert manual, nunca duplica validação de tipo", () => {
  it("importa e usa CreateOrganizationRelationshipService", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("../bootstrap-organization-relationship.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).toContain("CreateOrganizationRelationshipService");

    const sourceUpper = source.toUpperCase();
    expect(sourceUpper).not.toContain("INSERT INTO");
    expect(sourceUpper).not.toContain("UPDATE ORGANIZATION_RELATIONSHIPS");
    expect(sourceUpper).not.toContain("DELETE FROM");

    // Nunca reimplementa a validação "parent deve ser BUSINESS_GROUP,
    // child deve ser COMPANY" no CÓDIGO EXECUTÁVEL — isso é
    // responsabilidade exclusiva do Application Service. O comentário
    // do arquivo MENCIONA essa regra ao explicar a decisão (por isso a
    // checagem exclui comentários), mas o código em si nunca a
    // reimplementa.
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sourceWithoutComments).not.toContain("BUSINESS_GROUP");
    expect(sourceWithoutComments).not.toContain("isBusinessGroup");
  });
});
