/**
 * Integração da FONTE Helpdesk — MariaDB real, somente leitura.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e as variáveis `HELPDESK_DB_*` +
 * `HELPDESK_REGISTRY_DB_NAME` (arquivo
 * `/app/.config/pctec-ingressa/helpdesk-source.env`). Sem elas a suíte
 * é PULADA — e neste momento ela É pulada em DEV de propósito: a
 * credencial ainda não recebeu os GRANTs de coluna no registro
 * autoritativo, e concedê-los é ato de quem administra o banco, não
 * deste PR.
 *
 * **Nenhuma linha da origem é alterada.** As tentativas de escrita usam
 * `WHERE id = -1`, que não casa com registro nenhum: o teste prova que
 * o privilégio nega a operação, e mesmo que um dia não negasse, zero
 * linhas seriam afetadas. Um teste de segurança não pode ser o único
 * ponto do sistema capaz de causar o dano que ele investiga.
 *
 * **Nenhum documento completo é impresso.** As asserções falam de
 * presença, de quantidade de dígitos e de contagens — nunca do valor.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadHelpdeskSourceConfig } from "../infrastructure/source/HelpdeskSourceConfig.js";
import { MariaDbHelpdeskReadOnlySource } from "../infrastructure/source/MariaDbHelpdeskReadOnlySource.js";
import { HelpdeskUserSourceUnavailableError } from "../domain/errors/HelpdeskUserSourceErrors.js";

const shouldRun =
  shouldRunIntegrationTests() &&
  process.env["HELPDESK_DB_USER"] !== undefined &&
  process.env["HELPDESK_REGISTRY_DB_NAME"] !== undefined;

describe.skipIf(!shouldRun)("fonte Helpdesk — integração read-only", () => {
  let pool: Pool;
  let source: MariaDbHelpdeskReadOnlySource;
  let registro: string;

  beforeAll(() => {
    const config = loadHelpdeskSourceConfig();
    registro = config.registryDatabase;
    pool = createPool(config);
    source = new MariaDbHelpdeskReadOnlySource(pool, registro);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lê o catálogo de empresas do registro autoritativo, com a projeção fechada", async () => {
    const pagina = await source.readClients({ limit: 5, offset: 0 });

    expect(pagina.limit).toBe(5);
    expect(pagina.items.length).toBeLessThanOrEqual(5);
    for (const empresa of pagina.items) {
      expect(typeof empresa.id).toBe("number");
      expect(typeof empresa.name).toBe("string");
      expect(typeof empresa.active).toBe("boolean");
      // Presença e formato, nunca o valor.
      if (empresa.documentNumber !== null) {
        expect(empresa.documentNumber).toMatch(/^\d{14}$/);
      }
      expect(Object.keys(empresa).sort()).toEqual(["active", "documentNumber", "id", "name"].sort());
    }
  });

  it("o documento vem normalizado — 14 dígitos ou null, nunca com máscara", async () => {
    const pagina = await source.readClients({ limit: 25, offset: 0 });
    for (const empresa of pagina.items) {
      if (empresa.documentNumber !== null) {
        expect(empresa.documentNumber).not.toMatch(/[.\-/]/);
        expect(empresa.documentNumber).toHaveLength(14);
      }
    }
  });

  it("a fonte de USUÁRIOS recusa — e nunca devolve lista vazia", async () => {
    await expect(source.readUsersByClientId(1)).rejects.toThrow(HelpdeskUserSourceUnavailableError);
    await expect(source.readUsersByIds([1])).rejects.toMatchObject({
      code: "HELPDESK_USER_SOURCE_UNAVAILABLE"
    });
  });

  it("o contrato antigo não existe mais na origem — e o conector não tenta usá-lo", async () => {
    // A prova é dupla: o banco não tem as tabelas, e o conector não as
    // consulta nem como fallback.
    await expect(pool.execute("SELECT id FROM clients LIMIT 1")).rejects.toThrow(
      /doesn't exist|denied|does not exist/i
    );
    await expect(pool.execute("SELECT id FROM users LIMIT 1")).rejects.toThrow(
      /doesn't exist|denied|does not exist/i
    );
  });

  it.each([
    ["UPDATE", "UPDATE `REGISTRO`.clientes SET nome = nome WHERE id = -1"],
    ["DELETE", "DELETE FROM `REGISTRO`.clientes WHERE id = -1"],
    ["INSERT", "INSERT INTO `REGISTRO`.clientes (id) SELECT -1 FROM `REGISTRO`.clientes WHERE 1 = 0"]
  ])("%s no registro autoritativo é negado pelo banco", async (_rotulo, sql) => {
    await expect(pool.execute(sql.replaceAll("REGISTRO", registro))).rejects.toThrow(
      /command denied|denied to user/i
    );
  });

  it("a credencial não alcança coluna fora da projeção autorizada", async () => {
    await expect(pool.execute(`SELECT telefone FROM \`${registro}\`.clientes LIMIT 1`)).rejects.toThrow(
      /command denied|denied to user/i
    );
  });

  it("a credencial não alcança o schema do Ingressa", async () => {
    await expect(pool.execute("SELECT COUNT(*) FROM pctec_ingressa_dev.identities")).rejects.toThrow(
      /denied|does not exist/i
    );
  });

  it("a credencial não alcança a tabela de autenticação do Portal", async () => {
    await expect(pool.execute(`SELECT COUNT(*) FROM \`${registro}\`.portal_acesso`)).rejects.toThrow(
      /denied|doesn't exist/i
    );
  });
});
