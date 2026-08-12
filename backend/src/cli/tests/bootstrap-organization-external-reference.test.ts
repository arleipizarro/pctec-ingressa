import { describe, it, expect } from "vitest";
import { parseArgs, evaluateExternalReferenceWriteGate } from "../bootstrap-organization-external-reference.js";

describe("parseArgs", () => {
  it("exige organizationPublicId, systemCode, entityType, legacyId; sem flags = execute=false, actor=undefined", () => {
    expect(parseArgs(["0b13f6f0-8f3a-4a1e-9c2d-000000000001", "PCTEC_PORTAL", "clientes", "75"])).toEqual({
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: "75",
      execute: false,
      actorPublicId: undefined
    });
  });

  it("aceita entityType='clientes_grupo' (referência de rastreabilidade do grupo legado)", () => {
    const args = parseArgs(["0b13f6f0-8f3a-4a1e-9c2d-000000000001", "PCTEC_PORTAL", "clientes_grupo", "27"]);
    expect(args.entityType).toBe("clientes_grupo");
    expect(args.legacyId).toBe("27");
  });

  it("reconhece --execute e --actor", () => {
    const args = parseArgs([
      "org-1",
      "PCTEC_PORTAL",
      "clientes",
      "75",
      "--execute",
      "--actor",
      "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    ]);
    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("lança erro quando algum argumento obrigatório está ausente", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
    expect(() => parseArgs(["org-1", "PCTEC_PORTAL"])).toThrow(/Uso:/);
    expect(() => parseArgs(["org-1", "PCTEC_PORTAL", "clientes"])).toThrow(/Uso:/);
  });

  it("lança erro se --actor não for seguido de um valor", () => {
    expect(() => parseArgs(["org-1", "PCTEC_PORTAL", "clientes", "75", "--actor"])).toThrow(/--actor exige/);
  });

  it("erro de systemCode inválido NÃO é responsabilidade de parseArgs — a validação real (PCTEC_HUB/PCTEC_HELPDESK/PCTEC_PORTAL) é feita por SystemCode dentro de CreateOrganizationExternalReferenceService, no domínio, nunca reimplementada aqui", () => {
    expect(() => parseArgs(["org-1", "SISTEMA_INVENTADO", "clientes", "75"])).not.toThrow();
    expect(parseArgs(["org-1", "SISTEMA_INVENTADO", "clientes", "75"]).systemCode).toBe("SISTEMA_INVENTADO");
  });
});

describe("evaluateExternalReferenceWriteGate — mesmo gate duplo + --actor obrigatório em execute", () => {
  const baseArgsWithActor = {
    organizationPublicId: "org-1",
    systemCode: "PCTEC_PORTAL",
    entityType: "clientes",
    legacyId: "75",
    execute: true,
    actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
  };

  it("bloqueia SEMPRE em NODE_ENV=production, mesmo com --actor e env var true", () => {
    expect(
      evaluateExternalReferenceWriteGate(baseArgsWithActor, { nodeEnv: "production", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "production" });
  });

  it("dry-run sem --actor É PERMITIDO — actor só é exigido quando execute=true", () => {
    const dryRunWithoutActor = { ...baseArgsWithActor, execute: false, actorPublicId: undefined };
    expect(
      evaluateExternalReferenceWriteGate(dryRunWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("execute SEM --actor -> REJEITADO com motivo próprio (missing_actor_for_execute)", () => {
    const executeWithoutActor = { ...baseArgsWithActor, actorPublicId: undefined };
    expect(
      evaluateExternalReferenceWriteGate(executeWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_actor_for_execute" });
  });

  it("execute COM --actor, mas sem BOOTSTRAP_ALLOW_WRITE=true -> ainda bloqueado", () => {
    expect(
      evaluateExternalReferenceWriteGate(baseArgsWithActor, { nodeEnv: "development", allowWriteEnvVar: false })
    ).toEqual({ allowed: false, reason: "missing_env_var" });
  });

  it("execute COM --actor -> PERMITIDO quando as demais condições também são satisfeitas", () => {
    const decision = evaluateExternalReferenceWriteGate(baseArgsWithActor, {
      nodeEnv: "development",
      allowWriteEnvVar: true
    });
    expect(decision).toEqual({ allowed: true, actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099" });
  });
});

describe("estrutura do arquivo — reaproveita CreateOrganizationExternalReferenceService, nenhuma query/insert manual", () => {
  it("importa e usa CreateOrganizationExternalReferenceService, nunca SQL bruto", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("../bootstrap-organization-external-reference.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).toContain("CreateOrganizationExternalReferenceService");

    const sourceUpper = source.toUpperCase();
    expect(sourceUpper).not.toContain("INSERT INTO");
    expect(sourceUpper).not.toContain("UPDATE ORGANIZATION_EXTERNAL_REFERENCES");
    expect(sourceUpper).not.toContain("DELETE FROM");
  });
});
