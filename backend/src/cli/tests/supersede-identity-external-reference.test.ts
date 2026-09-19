import { describe, it, expect } from "vitest";
import { parseArgs, evaluateSupersedeWriteGate } from "../supersede-identity-external-reference.js";

const REFERENCIA = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ATOR = "0b13f6f0-8f3a-4a1e-9c2d-000000000099";

describe("supersede-identity-external-reference — parse de argumentos", () => {
  it("parseia os dois posicionais; sem flags: dry-run e sem substituição", () => {
    expect(parseArgs([REFERENCIA, "MATCH_CORRECTION"])).toEqual({
      referencePublicId: REFERENCIA,
      reason: "MATCH_CORRECTION",
      execute: false,
      actorPublicId: undefined,
      replacementLegacyId: undefined,
      replacementMatchMethod: undefined
    });
  });

  it("exige os dois posicionais", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
    expect(() => parseArgs([REFERENCIA])).toThrow(/Uso:/);
  });

  it("reconhece --execute, --actor e a substituição completa", () => {
    const args = parseArgs([
      REFERENCIA,
      "MATCH_CORRECTION",
      "--replace-with-legacy-id",
      "42",
      "--match-method",
      "MATCHED_MANUAL_CONFIRMED",
      "--execute",
      "--actor",
      ATOR
    ]);

    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe(ATOR);
    expect(args.replacementLegacyId).toBe("42");
    expect(args.replacementMatchMethod).toBe("MATCHED_MANUAL_CONFIRMED");
  });

  it("substituição é tudo-ou-nada: legacyId sem matchMethod é recusado", () => {
    expect(() => parseArgs([REFERENCIA, "MATCH_CORRECTION", "--replace-with-legacy-id", "42"])).toThrow(
      /andam juntos/
    );
    expect(() =>
      parseArgs([REFERENCIA, "MATCH_CORRECTION", "--match-method", "MATCHED_MANUAL_CONFIRMED"])
    ).toThrow(/andam juntos/);
  });

  it("flags que exigem valor não engolem a flag seguinte", () => {
    expect(() => parseArgs([REFERENCIA, "MATCH_CORRECTION", "--actor", "--execute"])).toThrow(/--actor exige/);
    expect(() => parseArgs([REFERENCIA, "MATCH_CORRECTION", "--replace-with-legacy-id", "--execute"])).toThrow(
      /--replace-with-legacy-id exige/
    );
  });

  it("NÃO existe flag de exclusão — supersede nunca apaga", () => {
    const args = parseArgs([REFERENCIA, "MATCH_CORRECTION", "--delete", "--force"]);
    // Flags desconhecidas viram posicionais e são ignoradas depois dos
    // dois primeiros; nada nesta CLI aciona remoção.
    expect(args.referencePublicId).toBe(REFERENCIA);
    expect(Object.keys(args)).not.toContain("delete");
  });
});

describe("supersede-identity-external-reference — gate de escrita", () => {
  const base = parseArgs([REFERENCIA, "MATCH_CORRECTION", "--execute", "--actor", ATOR]);

  it("production recusa SEMPRE, mesmo com todas as demais condições satisfeitas", () => {
    expect(evaluateSupersedeWriteGate(base, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("sem --execute, é dry-run", () => {
    const semExecute = parseArgs([REFERENCIA, "MATCH_CORRECTION", "--actor", ATOR]);
    expect(evaluateSupersedeWriteGate(semExecute, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "missing_execute_flag"
    });
  });

  it("--execute sem --actor é recusado — nunca ator implícito numa correção de vínculo", () => {
    const semAtor = parseArgs([REFERENCIA, "MATCH_CORRECTION", "--execute"]);
    expect(evaluateSupersedeWriteGate(semAtor, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "missing_actor_for_execute"
    });
  });

  it("sem BOOTSTRAP_ALLOW_WRITE=true é recusado", () => {
    expect(evaluateSupersedeWriteGate(base, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("com as quatro condições satisfeitas, autoriza e devolve o ator explícito", () => {
    expect(evaluateSupersedeWriteGate(base, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: true,
      actorPublicId: ATOR
    });
  });
});
