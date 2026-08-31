import { describe, expect, it } from "vitest";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { MariaDbHelpdeskReadOnlySource } from "../infrastructure/source/MariaDbHelpdeskReadOnlySource.js";
import {
  ForbiddenSourceQueryError,
  SOURCE_USER_COLUMNS
} from "../infrastructure/source/HelpdeskSourceQueries.js";
import { HelpdeskUserSourceUnavailableError } from "../domain/errors/HelpdeskUserSourceErrors.js";
import {
  loadHelpdeskSourceConfig,
  InvalidHelpdeskDatabaseError,
  InvalidHelpdeskRegistryDatabaseError,
  MissingHelpdeskSourceConfigError
} from "../infrastructure/source/HelpdeskSourceConfig.js";

const REGISTRO = "pctecdb";
const HELPDESK = "pctec_helpdesk";

class ConexaoEspia implements Queryable {
  public readonly sqls: string[] = [];
  public readonly params: unknown[][] = [];

  public constructor(private readonly rows: unknown[] = []) {}

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.sqls.push(sql);
    this.params.push([...(params ?? [])]);
    return [this.rows, undefined];
  }
}

function linha(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 71, nome: "EMPRESA SINTETICA LTDA", tipo_doc: "cnpj", documento: "11222333000181", ativo: 1, ...overrides };
}

function conector(rows: unknown[] = [linha()], registro = REGISTRO): MariaDbHelpdeskReadOnlySource {
  return new MariaDbHelpdeskReadOnlySource(new ConexaoEspia(rows), registro, HELPDESK);
}

/** Linha crua de `users`, como o driver a entrega. */
function linhaUsuario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 35,
    name: "PESSOA SINTETICA",
    email: "pessoa.sintetica@example.invalid",
    role: "cliente",
    active: 1,
    client_id: 71,
    ...overrides
  };
}

/** Conexão que falha com um erro do driver, para exercitar a tradução. */
class ConexaoQueFalha implements Queryable {
  public chamadas = 0;

  public constructor(private readonly erro: unknown) {}

  public async execute(): Promise<[unknown, unknown]> {
    this.chamadas += 1;
    throw this.erro;
  }
}

function erroDoDriver(errno: number, code: string): Error & { errno: number; code: string } {
  return Object.assign(new Error(`erro sintetico ${code}`), { errno, code });
}

describe("conector read-only do Helpdesk — empresas", () => {
  it("lê do schema AUTORITATIVO, qualificado, e nunca da tabela local", async () => {
    const conexao = new ConexaoEspia([linha()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await source.readClientById(71);
    await source.readClients({ limit: 10, offset: 0 });

    for (const sql of conexao.sqls) {
      expect(sql).toContain("`pctecdb`.clientes");
      // O contrato antigo não pode reaparecer por nenhum caminho — nem
      // como fallback, nem como segunda tentativa depois de um erro.
      expect(sql).not.toMatch(/\bFROM\s+clients\b/);
      expect(sql).not.toMatch(/\bFROM\s+users\b/);
      expect(sql).not.toContain("pctec_helpdesk");
    }
  });

  it("emite apenas SELECT — nenhuma instrução de escrita sai daqui", async () => {
    const conexao = new ConexaoEspia([linha()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await source.readClientById(71);
    await source.readClients({ q: "empresa", limit: 5, offset: 0 });

    expect(conexao.sqls).toHaveLength(3);
    for (const sql of conexao.sqls) {
      expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(sql.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REPLACE|TRUNCATE)\b/);
    }
  });

  it("converte o tinyint(1) da origem em boolean na fronteira", async () => {
    const ativo = await conector([linha({ ativo: 1 })]).readClientById(71);
    const inativo = await conector([linha({ ativo: 0 })]).readClientById(71);

    expect(ativo?.active).toBe(true);
    expect(inativo?.active).toBe(false);
  });

  it("empresa inexistente devolve `undefined`, não um registro vazio", async () => {
    expect(await conector([]).readClientById(999)).toBeUndefined();
  });

  it("não expõe método de escrita nem execução de SQL arbitrário", () => {
    const source = conector();
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(source));
    // Lista fechada. `readClientDocument` saiu: o documento passou a
    // vir na projeção principal, e manter o método vazio deixaria um
    // caminho morto que alguém reativaria sem contexto.
    expect(metodos.sort()).toEqual(
      [
        "constructor",
        "readClientById",
        "readClients",
        "readUsersByClientId",
        "readUsersByIds",
        "select",
        "selectUsuarios"
      ].sort()
    );
    expect((source as unknown as Record<string, unknown>)["execute"]).toBeUndefined();
  });
});

/**
 * Normalização do documento.
 *
 * A coluna do registro guarda CPF e CNPJ na MESMA string, com ou sem
 * máscara. Estes testes fixam a única saída aceitável: 14 dígitos
 * limpos, ou `null`.
 */
describe("conector read-only do Helpdesk — documento", () => {
  it("aceita CNPJ COM máscara, normalizando para 14 dígitos", async () => {
    const registro = await conector([linha({ documento: "11.222.333/0001-81" })]).readClientById(71);
    expect(registro?.documentNumber).toBe("11222333000181");
  });

  it("aceita CNPJ SEM máscara", async () => {
    const registro = await conector([linha({ documento: "11222333000181" })]).readClientById(71);
    expect(registro?.documentNumber).toBe("11222333000181");
  });

  it("`tipo_doc = 'cpf'` NUNCA vira documento — nem com 14 dígitos na coluna", async () => {
    const registro = await conector([linha({ tipo_doc: "cpf", documento: "11222333000181" })]).readClientById(71);
    // Se isto passasse, uma pessoa física entraria como candidata a
    // correspondência de EMPRESA no catálogo do Portal.
    expect(registro?.documentNumber).toBeNull();
  });

  it.each([
    ["ausente (null)", null],
    ["vazio", ""],
    ["só máscara", "../-"],
    ["curto demais (13 dígitos)", "1122233300018"],
    ["longo demais (15 dígitos)", "112223330001811"],
    ["CPF mascarado", "111.222.333-81"]
  ])("documento %s resulta em null — nunca em um valor 'quase' certo", async (_rotulo, documento) => {
    const registro = await conector([linha({ documento })]).readClientById(71);
    expect(registro?.documentNumber).toBeNull();
  });

  it("`tipo_doc` ausente ou desconhecido também resulta em null", async () => {
    expect((await conector([linha({ tipo_doc: null })]).readClientById(71))?.documentNumber).toBeNull();
    expect((await conector([linha({ tipo_doc: "outro" })]).readClientById(71))?.documentNumber).toBeNull();
  });

  it("`tipo_doc` é comparado sem depender de caixa nem de espaços", async () => {
    const registro = await conector([linha({ tipo_doc: " CNPJ " })]).readClientById(71);
    expect(registro?.documentNumber).toBe("11222333000181");
  });

  it("o documento vem na projeção PRINCIPAL — uma consulta só, não duas", async () => {
    const conexao = new ConexaoEspia([linha()]);
    await new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK).readClientById(71);

    expect(conexao.sqls).toHaveLength(1);
    expect(conexao.sqls[0]).toContain("documento");
    expect(conexao.sqls[0]).toContain("tipo_doc");
  });
});

/**
 * Usuários — a leitura restaurada.
 *
 * A recusa incondicional que existia aqui nascera de uma premissa
 * falsa: a de que `migration_005` do Helpdesk havia removido a tabela.
 * Ela está em quarentena no manifesto do Helpdesk e nunca foi aplicada
 * — a tabela existe e é a autoridade de autenticação de lá. Ver
 * `docs/import/FONTE-HELPDESK-CONTRATO-ATUAL.md`.
 *
 * O que estes testes protegem agora é a PROJEÇÃO (seis colunas, nada de
 * credencial) e a FRONTEIRA (tinyint vira boolean, NULL vira null).
 */
describe("conector read-only do Helpdesk — usuários", () => {
  it("lê pelos ids do escopo, no schema do HELPDESK — nunca no do registro", async () => {
    const conexao = new ConexaoEspia([linhaUsuario()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await source.readUsersByIds([35, 44]);

    expect(conexao.sqls).toHaveLength(1);
    expect(conexao.sqls[0]).toContain("`pctec_helpdesk`.users");
    // O qualificador do registro apontaria para um `pctecdb.users` que
    // não existe. São dois schemas com papéis diferentes.
    expect(conexao.sqls[0]).not.toContain("`pctecdb`.users");
  });

  it("lê pelo client_id da empresa, parametrizado", async () => {
    const conexao = new ConexaoEspia([linhaUsuario()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await source.readUsersByClientId(71);

    expect(conexao.sqls[0]).toContain("`pctec_helpdesk`.users");
    expect(conexao.sqls[0]).toContain("client_id = ?");
    expect(conexao.params[0]).toEqual([71]);
  });

  it("projeta exatamente as seis colunas da decisão — e nenhum campo sensível", async () => {
    const conexao = new ConexaoEspia([linhaUsuario()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await source.readUsersByIds([35]);
    await source.readUsersByClientId(71);

    for (const sql of conexao.sqls) {
      expect(sql).toContain(SOURCE_USER_COLUMNS.join(", "));
      expect(sql).not.toContain("*");
      // Credencial, sessão e recuperação de senha moram na MESMA linha
      // do cadastro. Nenhuma delas pode sair do banco.
      for (const proibido of [
        "password",
        "reset_token",
        "reset_expires",
        "last_login",
        "pctecdb_id",
        "is_dispatcher",
        "created_at",
        "client_group_id"
      ]) {
        expect(sql).not.toContain(proibido);
      }
    }
    expect(SOURCE_USER_COLUMNS).toEqual(["id", "name", "email", "role", "active", "client_id"]);
  });

  it("parametriza os ids — nunca os interpola no texto da consulta", async () => {
    const conexao = new ConexaoEspia([linhaUsuario()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await source.readUsersByIds([35, 44, 45]);

    expect(conexao.sqls[0]).toContain("IN (?, ?, ?)");
    expect(conexao.sqls[0]).not.toContain("35");
    expect(conexao.params[0]).toEqual([35, 44, 45]);
  });

  it("emite apenas SELECT — nenhuma instrução de escrita sai daqui", async () => {
    const conexao = new ConexaoEspia([linhaUsuario()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await source.readUsersByIds([35]);
    await source.readUsersByClientId(71);

    for (const sql of conexao.sqls) {
      expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(sql.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REPLACE|TRUNCATE)\b/);
    }
  });

  it("lista de ids VAZIA é recusada sem tocar na conexão — a base nunca é lida por inteiro", async () => {
    const conexao = new ConexaoEspia([linhaUsuario()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await expect(source.readUsersByIds([])).rejects.toThrow(ForbiddenSourceQueryError);
    expect(conexao.sqls).toHaveLength(0);
  });

  it("converte o tinyint(1) da origem em boolean na fronteira", async () => {
    const [ativo] = await conector([linhaUsuario({ active: 1 })]).readUsersByIds([35]);
    const [inativo] = await conector([linhaUsuario({ active: 0 })]).readUsersByIds([35]);
    const [nulo] = await conector([linhaUsuario({ active: null })]).readUsersByIds([35]);

    expect(ativo?.active).toBe(true);
    expect(inativo?.active).toBe(false);
    // `active` é NULL-able na origem. NULL não é "ativo" — e o domínio
    // nunca deve receber um terceiro estado para interpretar.
    expect(nulo?.active).toBe(false);
  });

  it("`client_id` NULL vira `null` — nunca 0, que seria uma empresa", async () => {
    const [semEmpresa] = await conector([linhaUsuario({ client_id: null })]).readUsersByIds([35]);
    const [comEmpresa] = await conector([linhaUsuario({ client_id: 71 })]).readUsersByIds([35]);

    expect(semEmpresa?.clientId).toBeNull();
    expect(comEmpresa?.clientId).toBe(71);
  });

  it("devolve exatamente os campos do contrato — nada a mais chega ao domínio", async () => {
    const [usuario] = await conector([
      // A linha crua traz colunas que a projeção não pede. Mesmo que um
      // dia elas viessem, não podem atravessar a fronteira.
      linhaUsuario({ password: "$2b$10$nao-deveria-estar-aqui", reset_token: "abc", client_group_id: 9 })
    ]).readUsersByIds([35]);

    expect(Object.keys(usuario ?? {}).sort()).toEqual(
      ["active", "clientId", "email", "id", "name", "role"].sort()
    );
  });

  it("lista vazia da origem é lista vazia — a empresa pode simplesmente não ter ninguém", async () => {
    // Distinto da RECUSA: aqui a pergunta FOI feita e respondida.
    await expect(conector([]).readUsersByClientId(71)).resolves.toEqual([]);
  });
});

/**
 * Falha REAL de acesso à fonte.
 *
 * `HELPDESK_USER_SOURCE_UNAVAILABLE` deixou de ser incondicional, mas
 * não deixou de existir: ele é a diferença entre "não consegui
 * perguntar" e "perguntei e não há ninguém". A lista de códigos é
 * fechada de propósito — traduzir qualquer exceção em 503 esconderia
 * defeito de programação atrás de uma mensagem tranquilizadora.
 */
describe("conector read-only do Helpdesk — falha de acesso à fonte de usuários", () => {
  it.each([
    ["privilégio de tabela negado", 1142, "ER_TABLEACCESS_DENIED_ERROR"],
    ["privilégio de coluna negado", 1143, "ER_COLUMNACCESS_DENIED_ERROR"],
    ["tabela inexistente", 1146, "ER_NO_SUCH_TABLE"],
    ["coluna inexistente", 1054, "ER_BAD_FIELD_ERROR"],
    ["schema inexistente", 1049, "ER_BAD_DB_ERROR"],
    ["acesso ao schema negado", 1044, "ER_DBACCESS_DENIED_ERROR"],
    ["credencial recusada", 1045, "ER_ACCESS_DENIED_ERROR"]
  ])("%s vira HELPDESK_USER_SOURCE_UNAVAILABLE", async (_rotulo, errno, code) => {
    const conexao = new ConexaoQueFalha(erroDoDriver(errno, code));
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await expect(source.readUsersByIds([35])).rejects.toMatchObject({
      code: "HELPDESK_USER_SOURCE_UNAVAILABLE"
    });
    await expect(source.readUsersByClientId(71)).rejects.toThrow(HelpdeskUserSourceUnavailableError);
  });

  it.each([
    ["conexão recusada", "ECONNREFUSED"],
    ["tempo esgotado", "ETIMEDOUT"],
    ["host não resolvido", "ENOTFOUND"],
    ["conexão perdida", "PROTOCOL_CONNECTION_LOST"]
  ])("falha de transporte (%s) também vira HELPDESK_USER_SOURCE_UNAVAILABLE", async (_rotulo, code) => {
    const conexao = new ConexaoQueFalha(Object.assign(new Error("transporte"), { code }));
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await expect(source.readUsersByIds([35])).rejects.toThrow(HelpdeskUserSourceUnavailableError);
  });

  it("a recusa NUNCA vira lista vazia", async () => {
    const conexao = new ConexaoQueFalha(erroDoDriver(1146, "ER_NO_SUCH_TABLE"));
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    const resultado = await source.readUsersByClientId(71).then(
      (r) => ({ tipo: "resolveu" as const, valor: r }),
      (e: unknown) => ({ tipo: "recusou" as const, valor: e })
    );

    expect(resultado.tipo).toBe("recusou");
  });

  it("a recusa não menciona tabela, schema nem usuário de banco", async () => {
    const conexao = new ConexaoQueFalha(
      erroDoDriver(1142, "ER_TABLEACCESS_DENIED_ERROR")
    );
    const erro = await new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK)
      .readUsersByIds([1])
      .then(
        () => undefined,
        (e: unknown) => e as Error
      );
    const texto = (erro as Error).message.toLowerCase();

    for (const proibido of ["users", "helpdesk_usuarios", "pctecdb", "pctec_helpdesk", "select", "@"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("erro de PROGRAMAÇÃO sobe cru — 503 tranquilizador esconderia um defeito nosso", async () => {
    // SQL malformado é bug do Ingressa. Responder "a origem está
    // indisponível" mandaria quem opera investigar o Helpdesk à toa.
    const conexao = new ConexaoQueFalha(erroDoDriver(1064, "ER_PARSE_ERROR"));
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await expect(source.readUsersByIds([35])).rejects.toMatchObject({ code: "ER_PARSE_ERROR" });
  });

  it("exceção sem código de banco também sobe crua", async () => {
    const conexao = new ConexaoQueFalha(new TypeError("undefined is not a function"));
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await expect(source.readUsersByIds([35])).rejects.toThrow(TypeError);
  });

  it("a falha de EMPRESAS não é traduzida — ela não tem significado de negócio", async () => {
    // Só a fonte de usuários tem um erro de domínio próprio. Inventar um
    // para empresas esconderia o defeito em vez de explicá-lo.
    const conexao = new ConexaoQueFalha(erroDoDriver(1142, "ER_TABLEACCESS_DENIED_ERROR"));
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, HELPDESK);

    await expect(source.readClientById(71)).rejects.toMatchObject({
      code: "ER_TABLEACCESS_DENIED_ERROR"
    });
  });
});

describe("configuração da fonte", () => {
  const COMPLETA = {
    HELPDESK_DB_HOST: "127.0.0.1",
    HELPDESK_DB_PORT: "3306",
    HELPDESK_DB_NAME: "pctec_helpdesk",
    HELPDESK_DB_USER: "pctec_helpdesk_ingressa_ro",
    HELPDESK_DB_PASSWORD: "irrelevante-para-o-teste",
    HELPDESK_REGISTRY_DB_NAME: "pctecdb"
  };

  it("carrega as seis variáveis com prefixo próprio", () => {
    const config = loadHelpdeskSourceConfig(COMPLETA as NodeJS.ProcessEnv);
    expect(config.database).toBe("pctec_helpdesk");
    expect(config.registryDatabase).toBe("pctecdb");
    expect(config.user).toBe("pctec_helpdesk_ingressa_ro");
    expect(config.port).toBe(3306);
  });

  it.each(Object.keys(COMPLETA))("falha fechado sem %s — nunca cai em default", (chave) => {
    const parcial = { ...COMPLETA } as Record<string, string>;
    delete parcial[chave];
    expect(() => loadHelpdeskSourceConfig(parcial as NodeJS.ProcessEnv)).toThrow(MissingHelpdeskSourceConfigError);
  });

  it("`HELPDESK_REGISTRY_DB_NAME` não tem default silencioso", () => {
    const semRegistro = { ...COMPLETA } as Record<string, string>;
    delete semRegistro["HELPDESK_REGISTRY_DB_NAME"];

    // A ausência precisa FALHAR, não virar "pctecdb" por conveniência:
    // um default aqui seria o nome do schema fixo no código por outro
    // caminho, e é assim que se lê o banco errado sem perceber.
    expect(() => loadHelpdeskSourceConfig(semRegistro as NodeJS.ProcessEnv)).toThrow(
      MissingHelpdeskSourceConfigError
    );
  });

  it.each([
    ["com espaço", "pctec db"],
    ["com ponto e vírgula", "pctecdb; DROP DATABASE x"],
    ["com crase", "pctec`db"],
    ["com hífen", "pctec-db"],
    ["começando com dígito", "1pctecdb"],
    ["com aspas", 'pctecdb"'],
    ["longo demais", "a".repeat(65)]
  ])("recusa nome de database inválido (%s) antes de montar qualquer SQL", (_rotulo, nome) => {
    expect(() =>
      loadHelpdeskSourceConfig({ ...COMPLETA, HELPDESK_REGISTRY_DB_NAME: nome } as NodeJS.ProcessEnv)
    ).toThrow(InvalidHelpdeskRegistryDatabaseError);
  });

  it.each([
    ["com espaço", "pctec helpdesk"],
    ["com ponto e vírgula", "pctec_helpdesk; DROP DATABASE x"],
    ["com crase", "pctec`helpdesk"],
    ["com hífen", "pctec-helpdesk"],
    ["começando com dígito", "1pctec_helpdesk"],
    ["longo demais", "a".repeat(65)]
  ])("recusa `HELPDESK_DB_NAME` inválido (%s) — ele também entra no texto do SQL", (_rotulo, nome) => {
    // Desde a restauração da fonte de usuários, o schema da conexão é
    // qualificado na consulta em vez de ficar implícito no pool. Dois
    // nomes viram texto de SQL, então os dois passam pela lista branca.
    expect(() =>
      loadHelpdeskSourceConfig({ ...COMPLETA, HELPDESK_DB_NAME: nome } as NodeJS.ProcessEnv)
    ).toThrow(InvalidHelpdeskDatabaseError);
  });

  it("a recusa do `HELPDESK_DB_NAME` cita a variável, nunca o valor", () => {
    try {
      loadHelpdeskSourceConfig({
        ...COMPLETA,
        HELPDESK_DB_NAME: "pctec_helpdesk; DROP DATABASE alvo"
      } as NodeJS.ProcessEnv);
      expect.unreachable("deveria ter falhado");
    } catch (error) {
      const mensagem = (error as Error).message;
      expect(mensagem).toContain("HELPDESK_DB_NAME");
      expect(mensagem).not.toContain("DROP DATABASE");
    }
  });

  it("a recusa do nome inválido NÃO ecoa o valor recebido", () => {
    try {
      loadHelpdeskSourceConfig({
        ...COMPLETA,
        HELPDESK_REGISTRY_DB_NAME: "pctecdb; DROP DATABASE alvo"
      } as NodeJS.ProcessEnv);
      expect.unreachable("deveria ter falhado");
    } catch (error) {
      const mensagem = (error as Error).message;
      expect(mensagem).toContain("HELPDESK_REGISTRY_DB_NAME");
      // Ecoar o valor propagaria a tentativa de injeção para o log em
      // vez de contê-la.
      expect(mensagem).not.toContain("DROP DATABASE");
    }
  });

  it("a mensagem de erro cita nomes de variável, nunca valores", () => {
    try {
      loadHelpdeskSourceConfig({ ...COMPLETA, HELPDESK_DB_PASSWORD: "" } as NodeJS.ProcessEnv);
      expect.unreachable("deveria ter falhado");
    } catch (error) {
      const mensagem = (error as Error).message;
      expect(mensagem).toContain("HELPDESK_DB_PASSWORD");
      expect(mensagem).not.toContain("irrelevante-para-o-teste");
    }
  });

  it("não reaproveita as variáveis DB_* do Ingressa", () => {
    expect(() =>
      loadHelpdeskSourceConfig({
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_NAME: "pctec_ingressa_dev",
        DB_USER: "pctec_ingressa_dev_app",
        DB_PASSWORD: "x"
      } as NodeJS.ProcessEnv)
    ).toThrow(MissingHelpdeskSourceConfigError);
  });
});

describe("conector read-only do Helpdesk — defesa em profundidade do schema", () => {
  it("um schema inválido que escape do loader ainda é recusado no ponto de montagem", async () => {
    const conexao = new ConexaoEspia([linha()]);
    // Instância construída SEM passar pelo loader — é o caminho que um
    // teste, um CLI ou uma composição futura poderiam tomar.
    const source = new MariaDbHelpdeskReadOnlySource(conexao, "pctecdb; DROP DATABASE alvo", HELPDESK);

    await expect(source.readClientById(71)).rejects.toThrow(ForbiddenSourceQueryError);
    expect(conexao.sqls).toHaveLength(0);
  });

  it("o schema do HELPDESK tem a mesma defesa — e a recusa não é confundida com fonte indisponível", async () => {
    const conexao = new ConexaoEspia([linhaUsuario()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO, "pctec_helpdesk`.users -- ");

    // `ForbiddenSourceQueryError`, e não `HelpdeskUserSourceUnavailableError`:
    // SQL que este código montaria errado é defeito nosso, não
    // indisponibilidade da origem.
    await expect(source.readUsersByIds([35])).rejects.toThrow(ForbiddenSourceQueryError);
    await expect(source.readUsersByClientId(71)).rejects.toThrow(ForbiddenSourceQueryError);
    expect(conexao.sqls).toHaveLength(0);
  });
});
