import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Auditoria estrutural do teste de integração preparado de login
 * (v0.6.0, Fase D) — mesma filosofia de
 * `identityIntegrationTestAudit.test.ts`/`credentialIntegrationTestAudit.test.ts`.
 * NUNCA conecta a nenhum banco — só lê o texto-fonte e garante
 * estruturalmente as propriedades de segurança exigidas.
 */
describe("SessionAuth.integration.test.ts — auditoria estrutural (sem banco)", () => {
  const source = readFileSync(
    new URL("../modules/security/tests/SessionAuth.integration.test.ts", import.meta.url),
    "utf-8"
  );

  const REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

  it("NUNCA contém o publicId real da Identity fundacional hardcoded", () => {
    expect(source).not.toContain(REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID);
  });

  it("nunca usa ApplicationAccess/PCTEC_INGRESSA/BootstrapFirstCredentialService como CÓDIGO real (menções em comentário explicando o que NÃO é usado são aceitáveis)", () => {
    expect(source).not.toContain("import { ApplicationAccess");
    expect(source).not.toContain("new ApplicationAccess");
    expect(source).not.toContain("application_accesses");
    expect(source).not.toContain("PCTEC_INGRESSA");
    // BootstrapFirstCredentialService é mencionado só em comentário
    // explicando por que NÃO é usado — nunca importado/instanciado.
    expect(source).not.toContain("import { BootstrapFirstCredentialService");
    expect(source).not.toContain("new BootstrapFirstCredentialService");
  });

  it("todo DELETE no cleanup é parametrizado por public_id específico", () => {
    const deleteStatements = source.match(/DELETE FROM [a-z_]+ WHERE [^`]+`/g) ?? [];
    expect(deleteStatements.length).toBeGreaterThan(0);
    for (const statement of deleteStatements) {
      expect(statement).toMatch(/WHERE (public_id|aggregate_public_id|identity_public_id) = \?/);
    }
    expect(source).not.toMatch(/DELETE FROM [a-z_]+\s*`/);
  });

  it("cleanup só apaga sessions/credentials/audit_events/identities — nunca applications/application_accesses", () => {
    const deleteTargets = [...source.matchAll(/DELETE FROM ([a-z_]+)/g)].map((match) => match[1]);
    expect(deleteTargets.length).toBeGreaterThan(0);
    for (const target of deleteTargets) {
      expect(["sessions", "credentials", "audit_events", "identities"]).toContain(target);
    }
  });

  it("[revisão crítica, item 17] cleanup EFETIVAMENTE apaga os 4 recursos (Session/Credential/AuditEvent/Identity fixtures) — não apenas 'seria permitido se aparecesse'", () => {
    const deleteTargets = new Set([...source.matchAll(/DELETE FROM ([a-z_]+)/g)].map((match) => match[1]));
    expect(deleteTargets.has("sessions")).toBe(true);
    expect(deleteTargets.has("credentials")).toBe(true);
    expect(deleteTargets.has("audit_events")).toBe(true);
    expect(deleteTargets.has("identities")).toBe(true);
  });

  it("cria fixture própria de Identity e Credential — nunca reutiliza publicId fixo", () => {
    expect(source).toContain("Identity.create(");
    expect(source).toContain("Credential.createFoundational(");
    expect(source).toContain("fixtureIdentity.getPublicId().toString()");
  });

  it("usa exclusivamente env.DB_USER (runtime) — nunca um usuário migrator hardcoded", () => {
    expect(source).toContain("user: env.DB_USER");
    const userAssignmentsWithLiteral = source.match(/user:\s*["'][^"']*["']/g) ?? [];
    expect(userAssignmentsWithLiteral).toEqual([]);
  });

  it("nunca executa CREATE/ALTER/DROP nem MigrationRunner", () => {
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

  it("a senha da fixture nunca é um valor real/óbvio compartilhado com outros testes de produção", () => {
    expect(source).toContain("FIXTURE_PASSWORD");
  });
});
