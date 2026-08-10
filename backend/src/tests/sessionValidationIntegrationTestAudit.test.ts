import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("SessionValidation.integration.test.ts - auditoria estrutural (sem banco)", () => {
  const source = readFileSync(
    new URL("../modules/security/tests/SessionValidation.integration.test.ts", import.meta.url),
    "utf-8"
  );

  const REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

  it("NUNCA contém o publicId real da Identity fundacional hardcoded", () => {
    expect(source).not.toContain(REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID);
  });

  it("nunca usa ApplicationAccess/PCTEC_INGRESSA/BootstrapFirstCredentialService como código real", () => {
    expect(source).not.toContain("import { ApplicationAccess");
    expect(source).not.toContain("new ApplicationAccess");
    expect(source).not.toContain("application_accesses");
    expect(source).not.toContain("PCTEC_INGRESSA");
    expect(source).not.toContain("import { BootstrapFirstCredentialService");
    expect(source).not.toContain("new BootstrapFirstCredentialService");
  });

  it("todo DELETE no cleanup é parametrizado por public_id específico", () => {
    const deleteStatements = source.match(/DELETE FROM [a-z_]+ WHERE [^`]+`/g) ?? [];
    expect(deleteStatements.length).toBeGreaterThan(0);
    for (const statement of deleteStatements) {
      expect(statement).toMatch(/WHERE (public_id|aggregate_public_id) = \?/);
    }
    expect(source).not.toMatch(/DELETE FROM [a-z_]+\s*`/);
  });

  it("cleanup EFETIVAMENTE apaga sessions/audit_events/identities - nunca applications/application_accesses/credentials", () => {
    const deleteTargets = new Set([...source.matchAll(/DELETE FROM ([a-z_]+)/g)].map((match) => match[1]));
    for (const target of deleteTargets) {
      expect(["sessions", "audit_events", "identities"]).toContain(target);
    }
    expect(deleteTargets.has("sessions")).toBe(true);
    expect(deleteTargets.has("audit_events")).toBe(true);
    expect(deleteTargets.has("identities")).toBe(true);
  });

  it("cria fixture própria de Identity e Session - nunca reutiliza publicId fixo, nunca precisa de Credential/Argon2id real", () => {
    expect(source).toContain("Identity.create(");
    expect(source).toContain("Session.create(");
    expect(source).toContain("fixtureIdentity.getPublicId().toString()");
    expect(source).not.toContain("Credential.createFoundational");
    expect(source).not.toContain("Argon2PasswordHasher()");
  });

  it("usa exclusivamente env.DB_USER (runtime) - nunca um usuário migrator hardcoded", () => {
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

  it("é controlado por RUN_INTEGRATION_TESTS (shouldRunIntegrationTests) - nunca roda incondicionalmente", () => {
    expect(source).toContain("shouldRunIntegrationTests");
    expect(source).toContain("describe.skipIf(!shouldRun)");
  });

  it("logout é testado de ponta a ponta contra o banco real (revoked + audit + 401 subsequente)", () => {
    expect(source).toContain("DELETE /api/v1/sessions/current");
    expect(source).toContain("REVOKED");
    expect(source).toContain("session.revoked");
  });
});
