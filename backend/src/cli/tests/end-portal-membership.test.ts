import { describe, it, expect } from "vitest";
import {
  parseArgs,
  evaluateEndMembershipWriteGate,
  conferirOrganizacaoEsperada
} from "../end-portal-membership.js";

/**
 * Testes da CLI de revogação de vínculo — P1D.1.
 *
 * Mesmo padrão das CLIs de bootstrap: parsing e gate são funções puras,
 * exportadas e testadas sem tocar banco. `main()` não é exercitado aqui
 * (exige MariaDB real).
 */

const MEMBERSHIP = "57559d06-9c26-4a36-911e-bc686fc4dc4b";
const ORGANIZATION = "b5c4358b-c8aa-42a8-9589-7c09c015f5fb";
const ACTOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

const ARGS_BASE = [MEMBERSHIP, "--organization", ORGANIZATION, "--reason", "motivo"];

describe("parseArgs", () => {
  it("A. lê membership, organization e reason", () => {
    const args = parseArgs(ARGS_BASE);
    expect(args.membershipPublicId).toBe(MEMBERSHIP);
    expect(args.expectedOrganizationPublicId).toBe(ORGANIZATION);
    expect(args.reason).toBe("motivo");
    expect(args.execute).toBe(false);
    expect(args.actorPublicId).toBeUndefined();
  });

  it("B. --execute e --actor são lidos quando presentes", () => {
    const args = parseArgs([...ARGS_BASE, "--execute", "--actor", ACTOR]);
    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe(ACTOR);
  });

  it("C. exige membershipPublicId, --organization e --reason", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
    expect(() => parseArgs([MEMBERSHIP])).toThrow(/Uso:/);
    expect(() => parseArgs([MEMBERSHIP, "--organization", ORGANIZATION])).toThrow(/Uso:/);
    expect(() => parseArgs([MEMBERSHIP, "--reason", "x"])).toThrow(/Uso:/);
  });

  it("D. --reason vazio ou só espaços é recusado no parsing", () => {
    for (const vazio of ["", "   "]) {
      expect(() => parseArgs([MEMBERSHIP, "--organization", ORGANIZATION, "--reason", vazio])).toThrow();
    }
  });

  it("E. opção sem valor (seguida de outra flag) é recusada — nunca consome a flag seguinte", () => {
    // `--reason --execute` faria o motivo virar "--execute" silenciosamente.
    expect(() => parseArgs([MEMBERSHIP, "--organization", ORGANIZATION, "--reason", "--execute"])).toThrow(
      /--reason exige um valor/
    );
    expect(() => parseArgs([MEMBERSHIP, "--organization", "--reason", "x"])).toThrow(
      /--organization exige um valor/
    );
    expect(() => parseArgs([...ARGS_BASE, "--actor"])).toThrow(/--actor exige um valor/);
  });

  it("F. nunca inventa um actor por default", () => {
    const args = parseArgs([...ARGS_BASE, "--execute"]);
    expect(args.actorPublicId).toBeUndefined();
  });
});

describe("evaluateEndMembershipWriteGate", () => {
  const args = parseArgs([...ARGS_BASE, "--execute", "--actor", ACTOR]);

  it("G. produção recusa sempre, mesmo com todas as flags", () => {
    expect(evaluateEndMembershipWriteGate(args, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("H. sem --execute → dry-run", () => {
    const semExecute = parseArgs(ARGS_BASE);
    expect(evaluateEndMembershipWriteGate(semExecute, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "missing_execute_flag"
    });
  });

  it("I. --execute sem --actor é recusado — toda revogação tem autor", () => {
    const semActor = parseArgs([...ARGS_BASE, "--execute"]);
    expect(evaluateEndMembershipWriteGate(semActor, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "missing_actor_for_execute"
    });
  });

  it("J. sem BOOTSTRAP_ALLOW_WRITE=true é recusado", () => {
    expect(evaluateEndMembershipWriteGate(args, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("K. só permite com --execute + --actor + env var, fora de produção", () => {
    expect(evaluateEndMembershipWriteGate(args, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: true,
      actorPublicId: ACTOR
    });
  });
});

describe("conferirOrganizacaoEsperada", () => {
  it("L. confere quando o vínculo pertence à Organization informada", () => {
    expect(conferirOrganizacaoEsperada(ORGANIZATION, ORGANIZATION)).toEqual({ confere: true });
  });

  it("M. recusa e informa a Organization real quando diverge", () => {
    // Guarda contra encerrar o vínculo errado por copiar-e-colar de um
    // publicId opaco.
    const outra = "cc9c41b2-425b-48f2-82d9-506d396c2562";
    expect(conferirOrganizacaoEsperada(outra, ORGANIZATION)).toEqual({ confere: false, encontrada: outra });
  });
});

describe("estrutural", () => {
  it("N. a CLI nunca toca ApplicationAccess nem dados comerciais", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const fonte = readFileSync(fileURLToPath(new URL("../end-portal-membership.ts", import.meta.url)), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(fonte).not.toContain("ApplicationAccess");
    expect(fonte).not.toContain("ExternalReference");
    expect(fonte).not.toContain("GrantApplicationAccess");
    expect(fonte).not.toContain("DELETE");
    // O comando que ela executa é exatamente um.
    expect(fonte).toContain("EndMembershipService");
  });
});
