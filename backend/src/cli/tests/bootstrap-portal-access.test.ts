import { describe, it, expect } from "vitest";
import { parseArgs, evaluatePortalAccessWriteGate } from "../bootstrap-portal-access.js";

describe("parseArgs", () => {
  it("exige identityPublicId, organizationPublicId, profile, scope", () => {
    expect(
      parseArgs(["66231e51-66fb-466d-af4f-ac7b925ca9ec", "0b13f6f0-8f3a-4a1e-9c2d-000000000001", "CUSTOMER", "ORGANIZATION_ONLY"])
    ).toEqual({
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      execute: false,
      actorPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec"
    });
  });

  it("reconhece --execute e --actor", () => {
    const args = parseArgs([
      "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
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
    expect(() =>
      parseArgs(["id1", "id2", "CUSTOMER", "ORGANIZATION_ONLY", "--actor"])
    ).toThrow(/--actor exige/);
  });
});

describe("evaluatePortalAccessWriteGate — mesmo princípio do gate duplo de G2", () => {
  const baseArgs = {
    identityPublicId: "id1",
    organizationPublicId: "id2",
    profile: "CUSTOMER",
    scope: "ORGANIZATION_ONLY",
    execute: true,
    actorPublicId: "id1"
  };

  it("bloqueia SEMPRE em NODE_ENV=production", () => {
    expect(evaluatePortalAccessWriteGate(baseArgs, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("bloqueia sem --execute", () => {
    expect(
      evaluatePortalAccessWriteGate({ ...baseArgs, execute: false }, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("bloqueia com --execute mas sem BOOTSTRAP_ALLOW_WRITE=true", () => {
    expect(evaluatePortalAccessWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("permite SOMENTE com as duas condições e NODE_ENV != production", () => {
    expect(evaluatePortalAccessWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: true
    });
  });
});
