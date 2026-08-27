import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Auditoria estrutural do teste de integração preparado do Credential
 * Bootstrap — mesma filosofia de `identityIntegrationTestAudit.test.ts`.
 * NUNCA conecta a nenhum banco — só lê o texto-fonte e garante
 * estruturalmente as propriedades de segurança exigidas (revisão
 * crítica, item 7).
 */
describe("BootstrapFirstCredentialService.integration.test.ts — auditoria estrutural (sem banco)", () => {
  const source = readFileSync(
    new URL("../modules/security/tests/BootstrapFirstCredentialService.integration.test.ts", import.meta.url),
    "utf-8"
  );

  const REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

  it("NUNCA contém o publicId real da Identity fundacional hardcoded, em nenhuma forma", () => {
    expect(source).not.toContain(REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID);
  });

  /**
   * DECISÃO SUPERSEDIDA (v1.0, ADR-027 emenda).
   *
   * Até a v0.5.x este teste exigia que o arquivo de integração NÃO
   * mencionasse `ApplicationAccess`/`PCTEC_INGRESSA`, porque o guard do
   * bootstrap de Credential era global-por-tipo e deliberadamente
   * independente do conceito de acesso administrativo.
   *
   * A emenda v1.0 reverte essa independência de propósito: a primeira
   * Credential passou a exigir que a Identity possua o ADMIN fundacional
   * de PCTEC_INGRESSA — sem esse vínculo, um `publicId` trocado no passo
   * 3 faria a plataforma nascer com a senha numa conta sem acesso e a
   * conta ADMIN sem como entrar.
   *
   * O acoplamento agora é a invariante, então proibi-lo tornaria este
   * arquivo um guardião de uma decisão que não vale mais. O que
   * permanece auditado é o que continua verdadeiro: a fixture usa o
   * conceito para SATISFAZER a pré-condição, nunca para tomar atalho
   * sobre a Identity fundacional real.
   */
  it("usa ApplicationAccess/PCTEC_INGRESSA apenas para satisfazer a pré-condição da fixture", () => {
    expect(source).toContain("ApplicationAccess");
    expect(source).toContain("PCTEC_INGRESSA");
    // A concessão é criada pela fábrica de domínio oficial, nunca por
    // INSERT manual montado à mão dentro do teste.
    expect(source).toContain("grantFoundationalAdminAccess");
    expect(source).not.toMatch(/INSERT\s+INTO\s+application_accesses/iu);
  });

  it("todo DELETE no cleanup é parametrizado por public_id específico — nunca um DELETE genérico sem WHERE ou por critério amplo", () => {
    const deleteStatements = source.match(/DELETE FROM [a-z_]+ WHERE [^`]+`/g) ?? [];
    expect(deleteStatements.length).toBeGreaterThan(0);
    for (const statement of deleteStatements) {
      expect(statement).toMatch(/WHERE (public_id|aggregate_public_id) = \?/);
    }
    expect(source).not.toMatch(/DELETE FROM [a-z_]+\s*`/);
  });

  it("cleanup só apaga o que a própria fixture criou — nunca a tabela applications", () => {
    const deleteTargets = [...source.matchAll(/DELETE FROM ([a-z_]+)/g)].map((match) => match[1]);
    expect(deleteTargets.length).toBeGreaterThan(0);
    for (const target of deleteTargets) {
      // `application_accesses` entrou na lista com a emenda v1.0: a
      // fixture passou a criar uma concessão própria e precisa removê-la.
      // `applications` continua FORA — a Application PCTEC_INGRESSA vem
      // do seed 0007 e nenhum teste pode apagá-la.
      expect(["credentials", "audit_events", "identities", "application_accesses"]).toContain(target);
    }
    expect(deleteTargets).not.toContain("applications");
  });

  it("cria sua própria Identity fixture via Identity.create() — nunca reutiliza um publicId fixo/hardcoded como fixture", () => {
    expect(source).toContain("Identity.create(");
    expect(source).toContain("fixtureIdentity.getPublicId().toString()");
  });

  it("usa exclusivamente env.DB_USER (runtime) — nunca um usuário migrator hardcoded", () => {
    expect(source).toContain("user: env.DB_USER");
    const userAssignmentsWithLiteral = source.match(/user:\s*["'][^"']*["']/g) ?? [];
    expect(userAssignmentsWithLiteral).toEqual([]);
  });

  it("nunca executa CREATE/ALTER/DROP nem MigrationRunner — não prepara schema", () => {
    expect(source.toUpperCase()).not.toMatch(/\bCREATE\s+TABLE\b/);
    expect(source.toUpperCase()).not.toMatch(/\bALTER\s+TABLE\b/);
    expect(source.toUpperCase()).not.toMatch(/\bDROP\s+TABLE\b/);
    expect(source).not.toContain("MigrationRunner");
    expect(source).not.toContain("applyPending");
  });

  it("é controlado por RUN_INTEGRATION_TESTS (shouldRunIntegrationTests) — nunca roda incondicionalmente", () => {
    expect(source).toContain("shouldRunIntegrationTests");
    expect(source).toContain("describe.skipIf(!shouldRun)");
  });

  it("verifica precondição de guard global antes de criar a fixture — nunca mascara um estado divergente pré-existente", () => {
    expect(source).toContain("existsAnyByType");
    expect(source.toLowerCase()).toContain("já existe uma credential local_password");
  });
});
