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

  it("nunca menciona ApplicationAccess nem PCTEC_INGRESSA como CONCEITO usado (referências de comentário ao nome de outro arquivo de teste são aceitáveis)", () => {
    // A única menção aceitável é o comentário citando o NOME DO ARQUIVO
    // `BootstrapFirstApplicationAccessService.integration.test.ts` como
    // padrão seguido — isso é documentação, não uso real do conceito.
    // Removemos essa referência específica antes de checar qualquer
    // outro uso da palavra "ApplicationAccess" no arquivo.
    const withoutFileNameReference = source.replace(
      /BootstrapFirstApplicationAccessService\.integration\.test\.ts/g,
      ""
    );
    expect(withoutFileNameReference).not.toContain("ApplicationAccess");
    expect(source).not.toContain("application_accesses");
    expect(source).not.toContain("PCTEC_INGRESSA");
  });

  it("todo DELETE no cleanup é parametrizado por public_id específico — nunca um DELETE genérico sem WHERE ou por critério amplo", () => {
    const deleteStatements = source.match(/DELETE FROM [a-z_]+ WHERE [^`]+`/g) ?? [];
    expect(deleteStatements.length).toBeGreaterThan(0);
    for (const statement of deleteStatements) {
      expect(statement).toMatch(/WHERE (public_id|aggregate_public_id) = \?/);
    }
    expect(source).not.toMatch(/DELETE FROM [a-z_]+\s*`/);
  });

  it("cleanup só apaga credentials/audit_events/identities — nunca applications/application_accesses", () => {
    const deleteTargets = [...source.matchAll(/DELETE FROM ([a-z_]+)/g)].map((match) => match[1]);
    expect(deleteTargets.length).toBeGreaterThan(0);
    for (const target of deleteTargets) {
      expect(["credentials", "audit_events", "identities"]).toContain(target);
    }
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
