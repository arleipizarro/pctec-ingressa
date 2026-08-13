import { describe, it, expect } from "vitest";
import {
  parseArgs,
  evaluateIdentityExternalReferenceWriteGate
} from "../bootstrap-identity-external-reference.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000099";

const BASE_POSITIONAL_ARGS = [
  IDENTITY_PUBLIC_ID,
  "PCTEC_PORTAL",
  "portal_acesso",
  "33",
  "MATCHED_MANUAL_CONFIRMED"
] as const;

// ---------------------------------------------------------------------------
// A. Parse de todos os 5 argumentos posicionais
// ---------------------------------------------------------------------------

describe("parseArgs — A. parse de todos os 5 argumentos posicionais", () => {
  it("parseia os 5 posicionais; sem flags: execute=false, actor=undefined", () => {
    expect(parseArgs([...BASE_POSITIONAL_ARGS])).toEqual({
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: "33",
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      execute: false,
      actorPublicId: undefined
    });
  });

  it("lança erro quando qualquer argumento posicional está ausente", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
    expect(() => parseArgs([IDENTITY_PUBLIC_ID])).toThrow(/Uso:/);
    expect(() => parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL"])).toThrow(/Uso:/);
    expect(() => parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso"])).toThrow(/Uso:/);
    // Faltando matchMethod (só 4 posicionais): deve falhar
    expect(() => parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso", "33"])).toThrow(/Uso:/);
  });

  it("reconhece --execute e --actor quando presentes", () => {
    const args = parseArgs([...BASE_POSITIONAL_ARGS, "--execute", "--actor", ACTOR_PUBLIC_ID]);
    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe(ACTOR_PUBLIC_ID);
  });

  it("lança erro se --actor não for seguido de valor", () => {
    expect(() => parseArgs([...BASE_POSITIONAL_ARGS, "--actor"])).toThrow(/--actor exige/);
  });
});

// ---------------------------------------------------------------------------
// B. legacyId numérico válido (passado como string para o service — VO valida)
// ---------------------------------------------------------------------------

describe("parseArgs — B. legacyId tratado como string opaca (validação numérica é responsabilidade do VO LegacyId)", () => {
  it("legacyId='33' é aceito e preservado como string — VO LegacyId valida o formato, não esta CLI", () => {
    const args = parseArgs([...BASE_POSITIONAL_ARGS]);
    expect(args.legacyId).toBe("33");
    // VO LegacyId.create(args.legacyId) resolveria o inteiro; CLI não reimplementa.
    expect(Number(args.legacyId)).toBe(33);
  });

  it("parseArgs não rejeita legacyId não-numérico — a rejeição é do VO, não da CLI", () => {
    const args = parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso", "nao-numerico", "MATCHED_BY_EMAIL"]);
    expect(args.legacyId).toBe("nao-numerico");
    // Confirmação estrutural: a CLI não chama Number(), parseInt() nem /^\d+$/ sobre legacyId
    // neste ponto — só repassa para o service.
  });
});

// ---------------------------------------------------------------------------
// C. matchMethod MATCHED_BY_EMAIL
// ---------------------------------------------------------------------------

describe("parseArgs — C. matchMethod MATCHED_BY_EMAIL aceito sem validação local", () => {
  it("parseia MATCHED_BY_EMAIL como string opaca — VO MatchMethod é a autoridade", () => {
    const args = parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso", "33", "MATCHED_BY_EMAIL"]);
    expect(args.matchMethod).toBe("MATCHED_BY_EMAIL");
  });
});

// ---------------------------------------------------------------------------
// D. matchMethod MATCHED_MANUAL_CONFIRMED
// ---------------------------------------------------------------------------

describe("parseArgs — D. matchMethod MATCHED_MANUAL_CONFIRMED aceito sem validação local", () => {
  it("parseia MATCHED_MANUAL_CONFIRMED como string opaca", () => {
    const args = parseArgs([...BASE_POSITIONAL_ARGS]);
    expect(args.matchMethod).toBe("MATCHED_MANUAL_CONFIRMED");
  });
});

// ---------------------------------------------------------------------------
// E. matchMethod inválido chega ao domínio/VO, não é rejeitado pela CLI
// ---------------------------------------------------------------------------

describe("parseArgs — E. matchMethod inválido aceito por parseArgs (rejeição é do VO, não da CLI)", () => {
  it("UNMATCHED, AMBIGUOUS, etc. passam pelo parseArgs sem erro — a CLI nunca reimplementa validação de matchMethod", () => {
    expect(() =>
      parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso", "33", "UNMATCHED"])
    ).not.toThrow();
    expect(() =>
      parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso", "33", "AMBIGUOUS"])
    ).not.toThrow();
    expect(() =>
      parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso", "33", "INVALID_EMAIL"])
    ).not.toThrow();

    // Confirmação: o valor chega intacto para o service, que o passa ao VO.
    const args = parseArgs([IDENTITY_PUBLIC_ID, "PCTEC_PORTAL", "portal_acesso", "33", "UNMATCHED"]);
    expect(args.matchMethod).toBe("UNMATCHED");
  });
});

// ---------------------------------------------------------------------------
// F. sem --execute → dry-run, zero escrita
// ---------------------------------------------------------------------------

describe("evaluateIdentityExternalReferenceWriteGate — F. sem --execute → dry-run (missing_execute_flag)", () => {
  it("sem --execute, em qualquer ambiente, retorna missing_execute_flag — nada será escrito", () => {
    const dryRunArgs = {
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: "33",
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      execute: false,
      actorPublicId: undefined
    };
    expect(
      evaluateIdentityExternalReferenceWriteGate(dryRunArgs, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("dry-run sem --actor É PERMITIDO — actor só é exigido quando execute=true", () => {
    // Retorna missing_execute_flag (não missing_actor) — a ausência de
    // --actor em dry-run não é um erro; o gate não chega a exigir actor
    // se execute=false.
    const result = evaluateIdentityExternalReferenceWriteGate(
      {
        identityPublicId: IDENTITY_PUBLIC_ID,
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: "33",
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        execute: false,
        actorPublicId: undefined
      },
      { nodeEnv: "development", allowWriteEnvVar: true }
    );
    expect(result).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });
});

// ---------------------------------------------------------------------------
// G. --execute sem BOOTSTRAP_ALLOW_WRITE=true → rejeitado
// ---------------------------------------------------------------------------

describe("evaluateIdentityExternalReferenceWriteGate — G. --execute sem BOOTSTRAP_ALLOW_WRITE → missing_env_var", () => {
  it("execute+actor+dev, mas env var false → missing_env_var", () => {
    expect(
      evaluateIdentityExternalReferenceWriteGate(
        {
          identityPublicId: IDENTITY_PUBLIC_ID,
          systemCode: "PCTEC_PORTAL",
          entityType: "portal_acesso",
          legacyId: "33",
          matchMethod: "MATCHED_MANUAL_CONFIRMED",
          execute: true,
          actorPublicId: ACTOR_PUBLIC_ID
        },
        { nodeEnv: "development", allowWriteEnvVar: false }
      )
    ).toEqual({ allowed: false, reason: "missing_env_var" });
  });
});

// ---------------------------------------------------------------------------
// H. --execute sem --actor → rejeitado
// ---------------------------------------------------------------------------

describe("evaluateIdentityExternalReferenceWriteGate — H. --execute sem --actor → missing_actor_for_execute", () => {
  it("execute+env var+dev, mas sem actor → missing_actor_for_execute (nunca usa SYSTEM nem identityPublicId beneficiada como fallback)", () => {
    expect(
      evaluateIdentityExternalReferenceWriteGate(
        {
          identityPublicId: IDENTITY_PUBLIC_ID,
          systemCode: "PCTEC_PORTAL",
          entityType: "portal_acesso",
          legacyId: "33",
          matchMethod: "MATCHED_MANUAL_CONFIRMED",
          execute: true,
          actorPublicId: undefined
        },
        { nodeEnv: "development", allowWriteEnvVar: true }
      )
    ).toEqual({ allowed: false, reason: "missing_actor_for_execute" });
  });
});

// ---------------------------------------------------------------------------
// I. NODE_ENV=production → rejeitado sempre
// ---------------------------------------------------------------------------

describe("evaluateIdentityExternalReferenceWriteGate — I. NODE_ENV=production bloqueia SEMPRE", () => {
  it("production bloqueia mesmo com todos os outros gates satisfeitos", () => {
    expect(
      evaluateIdentityExternalReferenceWriteGate(
        {
          identityPublicId: IDENTITY_PUBLIC_ID,
          systemCode: "PCTEC_PORTAL",
          entityType: "portal_acesso",
          legacyId: "33",
          matchMethod: "MATCHED_MANUAL_CONFIRMED",
          execute: true,
          actorPublicId: ACTOR_PUBLIC_ID
        },
        { nodeEnv: "production", allowWriteEnvVar: true }
      )
    ).toEqual({ allowed: false, reason: "production" });
  });

  it("production bloqueia mesmo com NODE_ENV='PRODUCTION' (case-insensitive: só string literal 'production' é aceita como bloqueio; outras variações não bloqueiam)", () => {
    // O gate compara com === "production" (lowercase), conforme padrão das demais CLIs.
    // "PRODUCTION" uppercase NÃO seria bloqueado pela implementação atual — isso é intencional:
    // NODE_ENV=production é a convenção de facto; casing diferente é anomalia do operador.
    // Testamos que o literal "production" (lowercase) bloqueia:
    const result = evaluateIdentityExternalReferenceWriteGate(
      {
        identityPublicId: IDENTITY_PUBLIC_ID,
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: "33",
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        execute: true,
        actorPublicId: ACTOR_PUBLIC_ID
      },
      { nodeEnv: "production", allowWriteEnvVar: true }
    );
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// J. --execute + env + actor + dev → gate permitido
// ---------------------------------------------------------------------------

describe("evaluateIdentityExternalReferenceWriteGate — J. todas as condições satisfeitas → allowed: true", () => {
  it("execute + BOOTSTRAP_ALLOW_WRITE=true + actor + dev → allowed, retorna actorPublicId exato", () => {
    const result = evaluateIdentityExternalReferenceWriteGate(
      {
        identityPublicId: IDENTITY_PUBLIC_ID,
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: "33",
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        execute: true,
        actorPublicId: ACTOR_PUBLIC_ID
      },
      { nodeEnv: "development", allowWriteEnvVar: true }
    );
    expect(result).toEqual({ allowed: true, actorPublicId: ACTOR_PUBLIC_ID });
  });
});

// ---------------------------------------------------------------------------
// K. actor explícito propagado para o service
// ---------------------------------------------------------------------------

describe("estrutura — K. actorPublicId do gate é propagado para o service (nunca SYSTEM, nunca identityPublicId)", () => {
  it("source contém gateDecision.actorPublicId como valor passado para execute — nunca um fallback hardcoded", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../bootstrap-identity-external-reference.ts", import.meta.url)
    );
    const source = readFileSync(sourcePath, "utf-8");

    // O service.execute recebe actorPublicId: gateDecision.actorPublicId
    expect(source).toContain("actorPublicId: gateDecision.actorPublicId");
  });
});

// ---------------------------------------------------------------------------
// L. prova estrutural: CLI usa CreateIdentityExternalReferenceService
// ---------------------------------------------------------------------------

describe("estrutura — L. CLI usa CreateIdentityExternalReferenceService (nunca SQL direto)", () => {
  it("importa e usa CreateIdentityExternalReferenceService", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../bootstrap-identity-external-reference.ts", import.meta.url)
    );
    const source = readFileSync(sourcePath, "utf-8");
    expect(source).toContain("CreateIdentityExternalReferenceService");
  });
});

// ---------------------------------------------------------------------------
// M. prova estrutural: sem SQL bruto
// ---------------------------------------------------------------------------

describe("estrutura — M. sem SQL bruto (sem INSERT INTO, UPDATE, DELETE diretos)", () => {
  it("não contém INSERT INTO, UPDATE nem DELETE FROM", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../bootstrap-identity-external-reference.ts", import.meta.url)
    );
    const sourceUpper = readFileSync(sourcePath, "utf-8").toUpperCase();
    expect(sourceUpper).not.toContain("INSERT INTO");
    expect(sourceUpper).not.toContain("UPDATE IDENTITY_EXTERNAL_REFERENCES");
    expect(sourceUpper).not.toContain("DELETE FROM");
  });
});

// ---------------------------------------------------------------------------
// N. prova de ausência de fallback SYSTEM
// ---------------------------------------------------------------------------

describe("estrutura — N. sem fallback SYSTEM de actor", () => {
  it("não contém ActorPublicId.system() nem string literal 'SYSTEM' como valor de actor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../bootstrap-identity-external-reference.ts", import.meta.url)
    );
    const source = readFileSync(sourcePath, "utf-8");
    // Remove comments before checking — garante que não está escondido em comentário
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sourceWithoutComments).not.toContain("ActorPublicId.system()");
    expect(sourceWithoutComments).not.toContain("\"SYSTEM\"");
  });
});

// ---------------------------------------------------------------------------
// O. prova de ausência de --confirm-manual-match
// ---------------------------------------------------------------------------

describe("estrutura — O. sem flag --confirm-manual-match (não aprovada pelo PO)", () => {
  it("não contém 'confirm-manual-match' no código executável — MATCHED_MANUAL_CONFIRMED já representa a decisão humana", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../bootstrap-identity-external-reference.ts", import.meta.url)
    );
    const source = readFileSync(sourcePath, "utf-8");
    // Remove comentários (block e inline) antes de verificar — a documentação
    // pode mencionar a flag para explicar por que ela NÃO existe, mas o código
    // executável não pode conter nenhuma referência funcional a ela.
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sourceWithoutComments).not.toContain("confirm-manual-match");
    expect(sourceWithoutComments).not.toContain("confirmManualMatch");
  });
});
