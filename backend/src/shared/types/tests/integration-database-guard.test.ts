import { describe, expect, it } from "vitest";
import {
  assertIsolatedIntegrationDatabase,
  integrationSuiteEnabled,
  IntegrationDatabaseGuardError,
  fixtureRunId
} from "../integration-database-guard.js";

const LIGADO = { RUN_INTEGRATION_TESTS: "true" } as NodeJS.ProcessEnv;

describe("guarda de isolamento da integração", () => {
  it("aceita banco terminado em _test", () => {
    expect(assertIsolatedIntegrationDatabase({ ...LIGADO, DB_NAME: "pctec_ingressa_test" }).database).toBe(
      "pctec_ingressa_test"
    );
  });

  it.each(["pctec_ingressa_dev", "pctec_ingressa", "pctec_helpdesk"])("recusa o banco real %s", (database) => {
    expect(() => assertIsolatedIntegrationDatabase({ ...LIGADO, DB_NAME: database })).toThrow(
      IntegrationDatabaseGuardError
    );
  });

  it("recusa qualquer nome sem o sufixo _test", () => {
    for (const database of ["producao", "pctec_ingressa_homolog", "test_pctec", "pctec_test_db"]) {
      expect(() => assertIsolatedIntegrationDatabase({ ...LIGADO, DB_NAME: database })).toThrow(/não termina em/);
    }
  });

  it("recusa DB_NAME ausente — nunca assume default", () => {
    expect(() => assertIsolatedIntegrationDatabase(LIGADO)).toThrow(/NUNCA assume um banco por default/);
    expect(() => assertIsolatedIntegrationDatabase({ ...LIGADO, DB_NAME: "   " })).toThrow(/ausente/);
  });

  it("exige RUN_INTEGRATION_TESTS=true", () => {
    expect(() =>
      assertIsolatedIntegrationDatabase({ DB_NAME: "pctec_ingressa_test" } as NodeJS.ProcessEnv)
    ).toThrow(/RUN_INTEGRATION_TESTS/);
    expect(() =>
      assertIsolatedIntegrationDatabase({
        RUN_INTEGRATION_TESTS: "false",
        DB_NAME: "pctec_ingressa_test"
      } as NodeJS.ProcessEnv)
    ).toThrow(/RUN_INTEGRATION_TESTS/);
  });

  it("não existe flag de override — nenhuma variável libera banco proibido", () => {
    for (const extra of [{ FORCE: "true" }, { ALLOW_DEV_WRITES: "true" }, { CI: "true" }]) {
      expect(() =>
        assertIsolatedIntegrationDatabase({ ...LIGADO, DB_NAME: "pctec_ingressa_dev", ...extra } as NodeJS.ProcessEnv)
      ).toThrow(IntegrationDatabaseGuardError);
    }
  });

  it("a mensagem de erro não carrega usuário, senha ou host", () => {
    try {
      assertIsolatedIntegrationDatabase({
        ...LIGADO,
        DB_NAME: "pctec_ingressa_dev",
        DB_USER: "usuario_sintetico",
        DB_PASSWORD: "segredo-sintetico-que-nao-pode-vazar",
        DB_HOST: "10.0.0.1"
      } as NodeJS.ProcessEnv);
      expect.unreachable("deveria recusar");
    } catch (erro) {
      const mensagem = (erro as Error).message;
      expect(mensagem).toContain("pctec_ingressa_dev");
      expect(mensagem).not.toContain("segredo-sintetico-que-nao-pode-vazar");
      expect(mensagem).not.toContain("usuario_sintetico");
      expect(mensagem).not.toContain("10.0.0.1");
    }
  });

  it("integrationSuiteEnabled pula sem falhar quando ninguém pediu integração", () => {
    expect(integrationSuiteEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(integrationSuiteEnabled(LIGADO)).toBe(true);
  });

  it("fixtureRunId muda a cada chamada — duas rodadas nunca colidem", () => {
    expect(new Set(Array.from({ length: 50 }, () => fixtureRunId())).size).toBe(50);
  });
});
