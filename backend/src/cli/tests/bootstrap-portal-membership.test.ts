import { describe, it, expect } from "vitest";
import { parseArgs, evaluatePortalMembershipWriteGate } from "../bootstrap-portal-membership.js";

describe("parseArgs (piloto AFIP — correção de escopo: --actor nunca tem default silencioso)", () => {
  it("exige identityPublicId, organizationPublicId, profile, scope; sem flags = execute=false, actor=undefined (NUNCA default para identityPublicId)", () => {
    expect(
      parseArgs(["66231e51-66fb-466d-af4f-ac7b925ca9ec", "0b13f6f0-8f3a-4a1e-9c2d-000000000001", "CUSTOMER", "ORGANIZATION_ONLY"])
    ).toEqual({
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      execute: false,
      actorPublicId: undefined
    });
  });

  it("reconhece --execute e --actor", () => {
    const args = parseArgs([
      "id1",
      "org1",
      "CUSTOMER",
      "ORGANIZATION_ONLY",
      "--execute",
      "--actor",
      "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    ]);
    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("lança erro quando algum argumento obrigatório está ausente", () => {
    expect(() => parseArgs(["só-um-arg"])).toThrow(/Uso:/);
    expect(() => parseArgs([])).toThrow(/Uso:/);
  });

  it("lança erro se --actor não for seguido de um valor", () => {
    expect(() => parseArgs(["id1", "id2", "CUSTOMER", "ORGANIZATION_ONLY", "--actor"])).toThrow(/--actor exige/);
  });
});

describe("evaluatePortalMembershipWriteGate — gate duplo MAIS a exigência de --actor em execute (correção, piloto AFIP)", () => {
  const baseArgsWithActor = {
    identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
    organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
    profile: "CUSTOMER",
    scope: "ORGANIZATION_AND_DESCENDANTS",
    execute: true,
    actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
  };

  it("bloqueia SEMPRE em NODE_ENV=production, mesmo com --actor e env var true", () => {
    expect(evaluatePortalMembershipWriteGate(baseArgsWithActor, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("dry-run sem --actor É PERMITIDO — actor só é exigido quando execute=true", () => {
    const dryRunWithoutActor = { ...baseArgsWithActor, execute: false, actorPublicId: undefined };
    expect(
      evaluatePortalMembershipWriteGate(dryRunWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("execute SEM --actor -> REJEITADO com motivo próprio (missing_actor_for_execute) — NUNCA mais usa identityPublicId como fallback silencioso de actor", () => {
    const executeWithoutActor = { ...baseArgsWithActor, actorPublicId: undefined };
    expect(
      evaluatePortalMembershipWriteGate(executeWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_actor_for_execute" });
  });

  it("execute COM --actor, mas sem BOOTSTRAP_ALLOW_WRITE=true -> ainda bloqueado", () => {
    expect(evaluatePortalMembershipWriteGate(baseArgsWithActor, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("execute COM --actor -> PERMITIDO quando as demais condições também são satisfeitas, e o actorPublicId retornado é o mesmo informado (nunca o identityPublicId, mesmo sendo o mesmo valor por coincidência neste teste — a fonte é sempre --actor)", () => {
    const decision = evaluatePortalMembershipWriteGate(baseArgsWithActor, { nodeEnv: "development", allowWriteEnvVar: true });
    expect(decision).toEqual({ allowed: true, actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099" });
  });
});

describe("estrutura do arquivo — nunca consulta/exige ApplicationAccess (independência real, não só ausência de chamada)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const sourcePath = fileURLToPath(new URL("../bootstrap-portal-membership.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf-8");

  it("importa e usa CreateMembershipService", () => {
    expect(source).toContain("CreateMembershipService");
  });

  it("NUNCA importa GrantApplicationAccessService/MariaDbApplicationAccessRepository/MariaDbApplicationRepository — nunca consulta ApplicationAccess de forma alguma", () => {
    expect(source).not.toContain("GrantApplicationAccessService");
    expect(source).not.toContain("MariaDbApplicationAccessRepository");
    expect(source).not.toContain("MariaDbApplicationRepository");
    expect(source).not.toContain("PCTEC_PORTAL_APPLICATION_CODE");
  });

  it("correção pós-piloto-AFIP: nunca contém 'actorPublicId ?? identityPublicId' (o fallback antigo) no código executável", () => {
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sourceWithoutComments).not.toContain("actorPublicId ?? identityPublicId");
  });
});
