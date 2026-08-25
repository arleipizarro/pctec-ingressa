import { describe, expect, it } from "vitest";
import { parseArgs, ActivateFederatedIdentityUsageError } from "../activate-federated-identity.js";

const APROVADOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

describe("CLI de ativação federada — argumentos", () => {
  it("exige --legacy-user-id inteiro positivo", () => {
    expect(() => parseArgs([])).toThrow(ActivateFederatedIdentityUsageError);
    expect(() => parseArgs(["--legacy-user-id=0"])).toThrow(/inteiro positivo/);
    expect(() => parseArgs(["--legacy-user-id=abc"])).toThrow(/inteiro positivo/);
  });

  it("sem --execute é simulação, e não exige aprovador", () => {
    const args = parseArgs(["--legacy-user-id=35"]);
    expect(args).toEqual({ legacyUserId: 35, execute: false, approvedByIdentityPublicId: undefined });
  });

  it("--execute exige --approved-by como publicId", () => {
    expect(() => parseArgs(["--legacy-user-id=35", "--execute"])).toThrow(/--approved-by/);
    expect(() => parseArgs(["--legacy-user-id=35", "--execute", "--approved-by=admin"])).toThrow(
      ActivateFederatedIdentityUsageError
    );
  });

  it("aceita execução completa", () => {
    expect(parseArgs(["--legacy-user-id=44", "--execute", `--approved-by=${APROVADOR}`])).toEqual({
      legacyUserId: 44,
      execute: true,
      approvedByIdentityPublicId: APROVADOR
    });
  });
});
