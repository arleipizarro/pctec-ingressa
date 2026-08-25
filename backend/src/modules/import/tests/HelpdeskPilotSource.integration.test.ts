/**
 * Integração da FONTE Helpdesk — MariaDB real, somente leitura.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e as variáveis `HELPDESK_DB_*`
 * (arquivo `/app/.config/pctec-ingressa/helpdesk-source.env`).
 *
 * **Nenhuma linha do Helpdesk é alterada.** As tentativas de escrita
 * usam `WHERE id = -1`, que não casa com registro nenhum: o teste prova
 * que o privilégio nega a operação, e mesmo que um dia não negasse,
 * zero linhas seriam afetadas. Um teste de segurança não pode ser o
 * único ponto do sistema capaz de causar o dano que ele investiga.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadHelpdeskSourceConfig } from "../infrastructure/source/HelpdeskSourceConfig.js";
import { MariaDbHelpdeskReadOnlySource } from "../infrastructure/source/MariaDbHelpdeskReadOnlySource.js";
import { NEGATIVE_CONTROL_USER_ID, PILOT_USER_IDS } from "../domain/pilot/HelpdeskPilotScope.js";

const shouldRun = shouldRunIntegrationTests() && process.env["HELPDESK_DB_USER"] !== undefined;

describe.skipIf(!shouldRun)("fonte Helpdesk — integração read-only", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool(loadHelpdeskSourceConfig());
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lê os dois usuários do escopo com os campos da decisão", async () => {
    const registros = await new MariaDbHelpdeskReadOnlySource(pool).readUsersByIds(PILOT_USER_IDS);

    expect(registros.map((r) => r.id).sort()).toEqual([...PILOT_USER_IDS].sort());
    for (const registro of registros) {
      expect(registro.role).toBe("cliente");
      expect(registro.active).toBe(true);
      expect(registro.clientId).not.toBeNull();
      expect(Object.keys(registro).sort()).toEqual(
        ["active", "clientId", "email", "id", "name", "role"].sort()
      );
    }
  });

  it("o controle negativo nunca volta da consulta do escopo", async () => {
    const registros = await new MariaDbHelpdeskReadOnlySource(pool).readUsersByIds(PILOT_USER_IDS);
    expect(registros.some((r) => r.id === NEGATIVE_CONTROL_USER_ID)).toBe(false);
  });

  it("o principal da fonte não consegue sequer SELECIONAR a coluna de senha", async () => {
    await expect(pool.execute("SELECT password FROM users WHERE id = ?", [35])).rejects.toThrow(
      /command denied|SELECT command denied|Unknown column|denied to user/i
    );
  });

  it.each([
    ["UPDATE", "UPDATE users SET name = name WHERE id = -1"],
    ["DELETE", "DELETE FROM users WHERE id = -1"],
    ["INSERT", "INSERT INTO clients (id, name) SELECT -1, 'x' FROM clients WHERE 1 = 0"]
  ])("%s no Helpdesk é negado pelo banco", async (_rotulo, sql) => {
    await expect(pool.execute(sql)).rejects.toThrow(/command denied|denied to user/i);
  });

  it("o principal da fonte não alcança o schema do Ingressa", async () => {
    await expect(pool.execute("SELECT COUNT(*) FROM pctec_ingressa_dev.identities")).rejects.toThrow(
      /denied|does not exist/i
    );
  });

  it("o principal da fonte não alcança tickets nem grupos de cliente", async () => {
    await expect(pool.execute("SELECT COUNT(*) FROM tickets")).rejects.toThrow(/denied|doesn't exist/i);
  });
});
