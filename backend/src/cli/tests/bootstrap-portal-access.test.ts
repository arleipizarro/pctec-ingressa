import { describe, it, expect } from "vitest";
import { parseArgs, evaluatePortalAccessWriteGate } from "../bootstrap-portal-access.js";

describe("parseArgs (G3.1 — access-only)", () => {
  it("exige somente identityPublicId; sem flags = execute=false, actor=identityPublicId", () => {
    expect(parseArgs(["66231e51-66fb-466d-af4f-ac7b925ca9ec"])).toEqual({
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      execute: false,
      actorPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec"
    });
  });

  it("reconhece --execute e --actor", () => {
    const args = parseArgs([
      "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      "--execute",
      "--actor",
      "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    ]);
    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("lança erro sem identityPublicId", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
  });

  it("lança erro se --actor não for seguido de um valor", () => {
    expect(() => parseArgs(["id1", "--actor"])).toThrow(/--actor exige/);
  });

  it("NUNCA mais aceita organizationPublicId/profile/scope como argumentos posicionais — a assinatura não tem espaço para eles (G3.1, correção de escopo)", () => {
    // Passar 4 argumentos posicionais (como a versão G3 antiga exigia)
    // resulta em identityPublicId = primeiro argumento, e os demais
    // são simplesmente ignorados (nunca interpretados como
    // organization/profile/scope) — a assinatura não tem parâmetro
    // para eles.
    const args = parseArgs(["id-1", "org-1", "CUSTOMER", "ORGANIZATION_ONLY"]);
    expect(args).toEqual({ identityPublicId: "id-1", execute: false, actorPublicId: "id-1" });
    expect(Object.keys(args)).not.toContain("organizationPublicId");
    expect(Object.keys(args)).not.toContain("profile");
    expect(Object.keys(args)).not.toContain("scope");
  });
});

describe("evaluatePortalAccessWriteGate — mesmo princípio do gate duplo de G2/G3", () => {
  const baseArgs = { identityPublicId: "id1", execute: true, actorPublicId: "id1" };

  it("A) bloqueia SEMPRE em NODE_ENV=production — dry-run implícito, nunca escreve", () => {
    expect(evaluatePortalAccessWriteGate(baseArgs, { nodeEnv: "production", allowWriteEnvVar: true })).toEqual({
      allowed: false,
      reason: "production"
    });
  });

  it("A) bloqueia sem --execute (dry-run é o padrão) — nunca escreve", () => {
    expect(
      evaluatePortalAccessWriteGate({ ...baseArgs, execute: false }, { nodeEnv: "development", allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("E) bloqueia com --execute mas sem BOOTSTRAP_ALLOW_WRITE=true — os dois gates continuam exigidos", () => {
    expect(evaluatePortalAccessWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: false })).toEqual({
      allowed: false,
      reason: "missing_env_var"
    });
  });

  it("B) permite SOMENTE com as duas condições e NODE_ENV != production — condição para de fato chamar GrantApplicationAccessService", () => {
    expect(evaluatePortalAccessWriteGate(baseArgs, { nodeEnv: "development", allowWriteEnvVar: true })).toEqual({
      allowed: true
    });
  });
});

describe("estrutura do arquivo — prova B/C do requisito 10 (não é possível testar via mock de módulo porque main() não é exportado/injetável, mesmo padrão de outros CLIs deste repositório; prova estrutural é a garantia real aqui)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const sourcePath = fileURLToPath(new URL("../bootstrap-portal-access.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf-8");

  it("B) importa e usa GrantApplicationAccessService", () => {
    expect(source).toContain("GrantApplicationAccessService");
  });

  it("C) NUNCA importa nem referencia CreateMembershipService como CÓDIGO — impossível chamá-lo, não é uma checagem em runtime que poderia ser burlada, é ausência estrutural (menções em comentário explicando a decisão são aceitáveis)", () => {
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sourceWithoutComments).not.toContain("CreateMembershipService");
    expect(sourceWithoutComments).not.toContain("MariaDbMembershipRepository");
    expect(sourceWithoutComments).not.toContain("MariaDbOrganizationRepository");
  });

  it("nunca recebe/usa organizationPublicId/profile/scope no CÓDIGO executável (fora de comentários explicativos)", () => {
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sourceWithoutComments).not.toContain("organizationPublicId");
    expect(sourceWithoutComments).not.toContain("args.profile");
    expect(sourceWithoutComments).not.toContain("args.scope");
  });
});
