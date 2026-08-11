import { describe, it, expect } from "vitest";
import { parseArgs, evaluatePortalMembershipWriteGate } from "../bootstrap-portal-membership.js";

describe("parseArgs (G3.1 — bootstrap-portal-membership, CLI irmã)", () => {
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

describe("evaluatePortalMembershipWriteGate — mesmo gate duplo", () => {
  const baseArgs = {
    identityPublicId: "id1",
    organizationPublicId: "id2",
    profile: "CUSTOMER",
    scope: "ORGANIZATION_ONLY",
    execute: true,
    actorPublicId: "id1"
  };

  it("D) bloqueia SEMPRE em NODE_ENV=production", () => {
    expect(evaluatePortalMembershipWriteGate(baseArgs, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("D) bloqueia sem --execute", () => {
    expect(
      evaluatePortalMembershipWriteGate(
        { ...baseArgs, execute: false },
        { nodeEnv: "development", allowWriteEnvVar: true }
      )
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("D) bloqueia com --execute mas sem BOOTSTRAP_ALLOW_WRITE=true", () => {
    expect(evaluatePortalMembershipWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("D) permite SOMENTE com as duas condições e NODE_ENV != production — CLI irmã continua funcionando de forma independente", () => {
    expect(evaluatePortalMembershipWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: true
    });
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
});
