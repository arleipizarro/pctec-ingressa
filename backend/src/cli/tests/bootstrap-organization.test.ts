import { describe, it, expect } from "vitest";
import { parseArgs, evaluateOrganizationWriteGate } from "../bootstrap-organization.js";

describe("parseArgs", () => {
  it("COMPANY: exige type + legalName; sem flags = execute=false, tradeName/documentNumber/actor undefined (nunca default para 'SYSTEM' — revisão pré-commit)", () => {
    expect(parseArgs(["COMPANY", "Empresa Fixture LTDA"])).toEqual({
      type: "COMPANY",
      legalName: "Empresa Fixture LTDA",
      tradeName: undefined,
      documentNumber: undefined,
      execute: false,
      actorPublicId: undefined
    });
  });

  it("BUSINESS_GROUP: mesmo parsing, type diferente", () => {
    const args = parseArgs(["BUSINESS_GROUP", "Grupo Fixture"]);
    expect(args.type).toBe("BUSINESS_GROUP");
    expect(args.legalName).toBe("Grupo Fixture");
  });

  it("documentNumber opcional: reconhece --document-number quando presente, undefined quando ausente", () => {
    const withDoc = parseArgs(["COMPANY", "Empresa X", "--document-number", "11.222.333/0001-81"]);
    expect(withDoc.documentNumber).toBe("11.222.333/0001-81");

    const withoutDoc = parseArgs(["COMPANY", "Empresa X"]);
    expect(withoutDoc.documentNumber).toBeUndefined();
  });

  it("reconhece --trade-name", () => {
    const args = parseArgs(["COMPANY", "Empresa Fixture LTDA", "--trade-name", "Fixture"]);
    expect(args.tradeName).toBe("Fixture");
  });

  it("actor: usa --actor quando informado explicitamente; ausente = undefined, NUNCA um default textual (revisão pré-commit — 'SYSTEM' não é Actor canônico do domínio de Organization, auditoria confirmou)", () => {
    const withActor = parseArgs(["COMPANY", "Empresa X", "--actor", "0b13f6f0-8f3a-4a1e-9c2d-000000000099"]);
    expect(withActor.actorPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");

    const withoutActor = parseArgs(["COMPANY", "Empresa X"]);
    expect(withoutActor.actorPublicId).toBeUndefined();
  });

  it("reconhece --execute combinado com as demais flags, em qualquer ordem", () => {
    const args = parseArgs([
      "COMPANY",
      "Empresa X",
      "--execute",
      "--trade-name",
      "Fixture",
      "--document-number",
      "11.222.333/0001-81",
      "--actor",
      "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    ]);
    expect(args).toEqual({
      type: "COMPANY",
      legalName: "Empresa X",
      tradeName: "Fixture",
      documentNumber: "11.222.333/0001-81",
      execute: true,
      actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    });
  });

  it("lança erro quando type ou legalName estão ausentes", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
    expect(() => parseArgs(["COMPANY"])).toThrow(/Uso:/);
  });

  it("lança erro se --trade-name/--document-number/--actor não forem seguidos de um valor", () => {
    expect(() => parseArgs(["COMPANY", "Empresa X", "--trade-name"])).toThrow(/--trade-name exige/);
    expect(() => parseArgs(["COMPANY", "Empresa X", "--document-number"])).toThrow(/--document-number exige/);
    expect(() => parseArgs(["COMPANY", "Empresa X", "--actor"])).toThrow(/--actor exige/);
  });

  it("erro de type inválido NÃO é responsabilidade de parseArgs — parseArgs aceita qualquer string como type; a validação real (BUSINESS_GROUP/COMPANY) é feita por OrganizationType dentro de CreateOrganizationService, no domínio, nunca reimplementada aqui", () => {
    // parseArgs é só parsing de argv, nunca duplica a validação de
    // domínio — mesmo princípio de todas as demais CLIs deste
    // repositório (a validação real do conjunto fechado de valores
    // acontece no Value Object, não na camada de CLI).
    expect(() => parseArgs(["TIPO_INVENTADO", "Empresa X"])).not.toThrow();
    expect(parseArgs(["TIPO_INVENTADO", "Empresa X"]).type).toBe("TIPO_INVENTADO");
  });
});

describe("evaluateOrganizationWriteGate — mesmo princípio do gate duplo das demais CLIs de bootstrap, MAIS a exigência de --actor em execute (revisão pré-commit)", () => {
  const baseArgsWithActor = {
    type: "COMPANY",
    legalName: "Empresa X",
    tradeName: undefined,
    documentNumber: undefined,
    execute: true,
    actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
  };

  it("bloqueia SEMPRE em NODE_ENV=production, mesmo com --actor e env var true", () => {
    expect(evaluateOrganizationWriteGate(baseArgsWithActor, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("dry-run sem --actor É PERMITIDO — actor só é exigido quando execute=true (nada é escrito em dry-run, não há o que auditar)", () => {
    const dryRunWithoutActor = { ...baseArgsWithActor, execute: false, actorPublicId: undefined };
    // Bloqueado pelo motivo "missing_execute_flag" (dry-run é o padrão
    // seguro), NUNCA por causa do actor ausente — parseArgs já aceitou
    // isso sem erro, e o gate não exige actor fora de execute=true.
    expect(evaluateOrganizationWriteGate(dryRunWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "missing_execute_flag"
    });
  });

  it("execute SEM --actor -> REJEITADO com motivo próprio (missing_actor_for_execute), mesmo com env var true — nunca um default silencioso para uma mutação real do Cadastro Mestre", () => {
    const executeWithoutActor = { ...baseArgsWithActor, actorPublicId: undefined };
    expect(evaluateOrganizationWriteGate(executeWithoutActor, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "missing_actor_for_execute"
    });
  });

  it("execute COM --actor, mas sem BOOTSTRAP_ALLOW_WRITE=true -> ainda bloqueado (o gate de --actor não substitui o gate de env var, ambos são exigidos)", () => {
    expect(evaluateOrganizationWriteGate(baseArgsWithActor, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("execute COM --actor -> PERMITIDO quando as demais condições também são satisfeitas (não produção, env var true) — e o actorPublicId retornado é o mesmo informado, já estreitado para string", () => {
    const decision = evaluateOrganizationWriteGate(baseArgsWithActor, { nodeEnv: "development", allowWriteEnvVar: true });
    expect(decision).toEqual({ allowed: true, actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099" });
  });
});

describe("estrutura do arquivo — reaproveita CreateOrganizationService, nenhuma query/insert manual", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const sourcePath = fileURLToPath(new URL("../bootstrap-organization.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf-8");

  it("importa e usa CreateOrganizationService", () => {
    expect(source).toContain("CreateOrganizationService");
  });

  it("nunca contém SQL bruto (INSERT/UPDATE/DELETE) fora do que o repository já existente encapsula — este arquivo não deveria ter nenhuma dessas palavras", () => {
    const sourceUpper = source.toUpperCase();
    expect(sourceUpper).not.toContain("INSERT INTO");
    expect(sourceUpper).not.toContain("UPDATE ORGANIZATIONS");
    expect(sourceUpper).not.toContain("DELETE FROM");
  });

  it("revisão pré-commit: nunca contém a string literal 'SYSTEM' como valor de fallback no código executável (só em comentário explicando a decisão de NÃO usá-la)", () => {
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sourceWithoutComments).not.toContain('"SYSTEM"');
  });
});
