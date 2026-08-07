import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Trava de regressão para o bug real corrigido nesta entrega: o teste de
 * integração da Identity Query API tentava preparar schema
 * (MigrationRunner/applyPending/CREATE) usando o usuário runtime, que
 * não tem esse privilégio por design (princípio de menor privilégio).
 *
 * Este teste NUNCA conecta a nenhum banco — só lê o texto-fonte do
 * arquivo de integração e garante estruturalmente que essa classe de bug
 * não pode reaparecer silenciosamente.
 */
describe("identityRoutes.integration.test.ts — auditoria estrutural (sem banco)", () => {
  const source = readFileSync(
    new URL("../modules/identity/http/tests/identityRoutes.integration.test.ts", import.meta.url),
    "utf-8"
  );

  /**
   * Remove comentários de bloco (`/* ... *\/`) e de linha (`//...`) antes
   * de checar termos proibidos — necessário porque a prosa explicativa
   * deste arquivo (documentando POR QUE MigrationRunner/migrator NÃO são
   * usados) legitimamente menciona esses termos. Preserva `://` (ex.:
   * `http://127.0.0.1`) — só remove `//` quando não precedido de `:`.
   */
  function stripComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
  }

  const codeOnly = stripComments(source);

  it("nunca importa nem instancia MigrationRunner/applyPending (fora de comentários explicativos)", () => {
    expect(codeOnly).not.toContain("MigrationRunner");
    expect(codeOnly).not.toContain("applyPending");
    expect(codeOnly).not.toContain("loadMigrationDefinitions");
  });

  it("nunca executa CREATE/ALTER/DROP (mesmo dentro de uma string de query)", () => {
    expect(source.toUpperCase()).not.toMatch(/\bCREATE\s+TABLE\b/);
    expect(source.toUpperCase()).not.toMatch(/\bALTER\s+TABLE\b/);
    expect(source.toUpperCase()).not.toMatch(/\bDROP\s+TABLE\b/);
  });

  it("nunca hardcoda uma credencial de usuário — sempre lê de env.DB_USER (runtime), nunca um literal tipo migrator", () => {
    expect(source).toContain("user: env.DB_USER");
    const userAssignmentsWithLiteral = source.match(/user:\s*["'][^"']*["']/g) ?? [];
    expect(userAssignmentsWithLiteral).toEqual([]);
  });

  it("usa uma chave de fixture FIXA (nunca aleatória por execução) — necessário para o cleanup conseguir recuperar de uma falha anterior", () => {
    expect(source).toContain("FIXTURE_PUBLIC_ID");
    expect(source).not.toContain("Date.now()");
    expect(source).not.toContain("randomUUID()");
  });

  it("nunca usa DELETE genérico sem filtro por chave específica", () => {
    const deleteStatements = source.match(/DELETE FROM \w+[^;]*/g) ?? [];
    for (const statement of deleteStatements) {
      expect(statement.toUpperCase()).toContain("WHERE");
    }
  });

  it("usa a checagem de pré-condição de schema (read-only) antes de qualquer INSERT de fixture", () => {
    const schemaCheckIndex = source.indexOf("assertIntegrationSchemaReady(");
    const firstInsertIndex = source.indexOf("repository.insert(");
    expect(schemaCheckIndex).toBeGreaterThan(-1);
    expect(firstInsertIndex).toBeGreaterThan(-1);
    expect(schemaCheckIndex).toBeLessThan(firstInsertIndex);
  });

  it("usa cleanupIntegrationTest (tolerante a setup parcial) no afterAll, não um cleanup ad hoc", () => {
    expect(source).toContain("cleanupIntegrationTest(state)");
  });

  it("e-mail fictício usa domínio reservado (.invalid, RFC 2606), nunca um domínio real", () => {
    expect(source).toContain("@example.invalid");
  });

  it("nenhum CPF (real ou fictício) aparece no arquivo — a fixture não define CPF", () => {
    expect(source.toLowerCase()).not.toContain("cpf");
  });
});
