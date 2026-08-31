/**
 * Integração da FONTE Helpdesk — MariaDB real, somente leitura.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e as variáveis `HELPDESK_DB_*` +
 * `HELPDESK_REGISTRY_DB_NAME` (arquivo
 * `/app/.config/pctec-ingressa/helpdesk-source.env`). Sem elas a suíte
 * é PULADA.
 *
 * Ela lê as DUAS autoridades: empresas no registro
 * (`HELPDESK_REGISTRY_DB_NAME`.`clientes`) e usuários no schema do
 * Helpdesk (`HELPDESK_DB_NAME`.`users`).
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
import type { Pool } from "mysql2/promise";
import { createPool } from "../../../shared/database/Pool.js";
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
  let helpdesk: string;

  beforeAll(() => {
    const config = loadHelpdeskSourceConfig();
    registro = config.registryDatabase;
    // O MESMO helper que a produção usa. Ele projeta explicitamente os
    // cinco campos de conexão, então `registryDatabase` não chega ao
    // driver — o mysql2 avisa sobre opção desconhecida hoje e promete
    // lançar em versões futuras. Entregar a configuração inteira ao
    // `mysql2.createPool` também faria este teste divergir do caminho
    // real de composição, que é justamente o que ele deveria exercitar.
    pool = createPool(config);
    // Os DOIS nomes de schema vão para o ADAPTER, que os qualifica no
    // texto da consulta: empresas no registro autoritativo, usuários no
    // schema do Helpdesk. É o único lugar que precisa deles.
    helpdesk = config.database;
    source = new MariaDbHelpdeskReadOnlySource(pool, registro, helpdesk);
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

  /**
   * Um `client_id` que de fato tem usuários, descoberto em vez de fixado.
   *
   * Fixar um id aqui amarraria a suíte a uma linha específica do
   * cadastro; e é um id, não dado pessoal. A consulta é agregada de
   * propósito — nenhum nome, e-mail ou documento sai daqui.
   */
  async function umClienteComUsuarios(): Promise<number | undefined> {
    const [linhas] = await pool.execute(
      `SELECT client_id FROM \`${helpdesk}\`.users ` +
        `WHERE client_id IS NOT NULL GROUP BY client_id ORDER BY client_id LIMIT 1`
    );
    const primeira = (linhas as unknown as ReadonlyArray<{ client_id: number }>)[0];
    return primeira === undefined ? undefined : Number(primeira.client_id);
  }

  it("lê usuários de uma empresa, com a projeção fechada e nada além do contrato", async () => {
    const clientId = await umClienteComUsuarios();
    expect(clientId, "a origem deveria ter ao menos um usuário vinculado a empresa").toBeDefined();

    const usuarios = await source.readUsersByClientId(clientId as number);

    expect(usuarios.length).toBeGreaterThan(0);
    for (const usuario of usuarios) {
      // Forma, nunca valor: nada de nome, e-mail ou documento impresso.
      expect(typeof usuario.id).toBe("number");
      expect(typeof usuario.name).toBe("string");
      expect(typeof usuario.email).toBe("string");
      expect(typeof usuario.role).toBe("string");
      expect(typeof usuario.active).toBe("boolean");
      expect(usuario.clientId === null || typeof usuario.clientId === "number").toBe(true);
      // O contrato inteiro, e SÓ ele: nenhuma coluna de credencial
      // atravessa a fronteira nem por acidente de projeção.
      expect(Object.keys(usuario).sort()).toEqual(
        ["active", "clientId", "email", "id", "name", "role"].sort()
      );
    }
  });

  it("lê pelos ids do escopo, devolvendo exatamente os pedidos", async () => {
    const clientId = await umClienteComUsuarios();
    const daEmpresa = await source.readUsersByClientId(clientId as number);
    const ids = daEmpresa.slice(0, 2).map((u) => u.id);

    const porId = await source.readUsersByIds(ids);

    expect(porId.map((u) => u.id).sort()).toEqual([...ids].sort());
  });

  it("empresa sem usuários devolve lista VAZIA — a pergunta foi feita e respondida", async () => {
    // Distinto da recusa: aqui a origem respondeu. `-1` não é id válido
    // de cadastro, então a resposta correta é "ninguém", não um erro.
    await expect(source.readUsersByClientId(-1)).resolves.toEqual([]);
  });

  it("a contagem agregada da origem bate com o que o conector devolve", async () => {
    const clientId = await umClienteComUsuarios();
    const [linhas] = await pool.execute(
      `SELECT COUNT(id) AS total FROM \`${helpdesk}\`.users WHERE client_id = ?`,
      [clientId]
    );
    const total = Number((linhas as unknown as ReadonlyArray<{ total: number | string }>)[0]?.total ?? 0);

    const usuarios = await source.readUsersByClientId(clientId as number);

    expect(usuarios).toHaveLength(total);
  });

  it("schema inexistente vira HELPDESK_USER_SOURCE_UNAVAILABLE — não um 500", async () => {
    // Tradução exercitada contra o driver REAL, não contra um dublê: é
    // a diferença entre "não consegui perguntar" e um defeito nosso.
    const inalcancavel = new MariaDbHelpdeskReadOnlySource(pool, registro, "schema_que_nao_existe_no_servidor");

    await expect(inalcancavel.readUsersByClientId(1)).rejects.toThrow(HelpdeskUserSourceUnavailableError);
    await expect(inalcancavel.readUsersByIds([1])).rejects.toMatchObject({
      code: "HELPDESK_USER_SOURCE_UNAVAILABLE"
    });
  });

  it("a tabela LOCAL de empresas não é consultada pelo conector", async () => {
    // `clients` continua existindo no schema do Helpdesk, mas deixou de
    // ser autoridade: empresas vêm do registro. A prova é que nenhuma
    // consulta do conector a nomeia — ver os testes unitários da
    // projeção. Aqui basta garantir que o catálogo NÃO veio dela.
    const pagina = await source.readClients({ limit: 1, offset: 0 });
    const [doRegistro] = await pool.execute(
      `SELECT COUNT(id) AS total FROM \`${registro}\`.clientes`
    );
    const totalRegistro = Number((doRegistro as unknown as ReadonlyArray<{ total: number | string }>)[0]?.total ?? 0);

    expect(pagina.total).toBe(totalRegistro);
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

  it.each([
    ["UPDATE", "UPDATE `HELPDESK`.users SET active = active WHERE id = -1"],
    ["DELETE", "DELETE FROM `HELPDESK`.users WHERE id = -1"]
  ])("%s na tabela de usuários é negado pelo banco", async (_rotulo, sql) => {
    await expect(pool.execute(sql.replaceAll("HELPDESK", helpdesk))).rejects.toThrow(
      /command denied|denied to user/i
    );
  });

  it("a credencial não alcança coluna fora da projeção autorizada", async () => {
    await expect(pool.execute(`SELECT telefone FROM \`${registro}\`.clientes LIMIT 1`)).rejects.toThrow(
      /command denied|denied to user/i
    );
  });

  it("a credencial não alcança as colunas de credencial de `users`", async () => {
    // A segunda das duas travas: a projeção fechada no código, e o GRANT
    // de COLUNA no banco. Nenhuma confia na outra.
    //
    // Em DEV o principal tem grant de COLUNA e isto passa. Em PRD a
    // concessão ainda é de schema inteiro; este teste é o que torna a
    // redução planejada do GRANT verificável em vez de prometida.
    for (const coluna of ["password", "reset_token"]) {
      await expect(
        pool.execute(`SELECT ${coluna} FROM \`${helpdesk}\`.users LIMIT 1`)
      ).rejects.toThrow(/command denied|denied to user/i);
    }
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
