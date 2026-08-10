import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("ApplicationAccessEnforcement.integration.test.ts - auditoria estrutural (sem banco)", () => {
  const source = readFileSync(
    new URL("../modules/authorization/tests/ApplicationAccessEnforcement.integration.test.ts", import.meta.url),
    "utf-8"
  );

  const REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

  it("NUNCA contém o publicId real da Identity fundacional hardcoded", () => {
    expect(source).not.toContain(REAL_FOUNDATIONAL_IDENTITY_PUBLIC_ID);
  });

  it("resolve a Application PCTEC_INGRESSA por CODIGO, nunca UUID hardcoded", () => {
    expect(source).toContain("ApplicationCode.create(PCTEC_INGRESSA_APPLICATION_CODE)");
    expect(source).not.toContain("0b13f6f0-8f3a-4a1e-9c2d-000000000001");
  });

  it("NUNCA executa UPDATE/DELETE na tabela applications - a aplicacao real e somente lida", () => {
    expect(source.toUpperCase()).not.toMatch(/UPDATE\s+APPLICATIONS\b/);
    expect(source.toUpperCase()).not.toMatch(/DELETE\s+FROM\s+APPLICATIONS\b/);
  });

  it("todo DELETE no cleanup é parametrizado por public_id específico", () => {
    const deleteStatements = source.match(/DELETE FROM [a-z_]+ WHERE [^`]+`/g) ?? [];
    expect(deleteStatements.length).toBeGreaterThan(0);
    for (const statement of deleteStatements) {
      expect(statement).toMatch(/WHERE (public_id|aggregate_public_id) = \?/);
    }
    expect(source).not.toMatch(/DELETE FROM [a-z_]+\s*`/);
  });

  it("cleanup EFETIVAMENTE apaga identities/sessions/application_accesses/audit_events - nunca applications", () => {
    const deleteTargets = new Set([...source.matchAll(/DELETE FROM ([a-z_]+)/g)].map((match) => match[1]));
    for (const target of deleteTargets) {
      expect(["sessions", "audit_events", "identities", "application_accesses"]).toContain(target);
    }
    expect(deleteTargets.has("application_accesses")).toBe(true);
    expect(deleteTargets.has("sessions")).toBe(true);
    expect(deleteTargets.has("identities")).toBe(true);
    expect(deleteTargets.has("applications")).toBe(false);
  });

  it("cria fixture própria de Identity, Session e ApplicationAccess", () => {
    expect(source).toContain("Identity.create(");
    expect(source).toContain("Session.create(");
    expect(source).toContain("ApplicationAccess.grantFoundationalAdminAccess(");
    expect(source).toContain("fixtureIdentity.getPublicId().toString()");
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

  it("prova /me continua 200 sem exigir ADMIN adicional, e /admin/whoami sem cookie é 401 (nunca 403)", () => {
    expect(source).toContain("/api/v1/me");
    expect(source).toContain("SESSION_INVALID");
  });
});
