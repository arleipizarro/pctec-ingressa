import { describe, expect, it } from "vitest";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { MariaDbHelpdeskReadOnlySource } from "../infrastructure/source/MariaDbHelpdeskReadOnlySource.js";
import { ForbiddenSourceQueryError } from "../infrastructure/source/HelpdeskSourceQueries.js";
import { HelpdeskUserSourceUnavailableError } from "../domain/errors/HelpdeskUserSourceErrors.js";
import {
  loadHelpdeskSourceConfig,
  InvalidHelpdeskRegistryDatabaseError,
  MissingHelpdeskSourceConfigError
} from "../infrastructure/source/HelpdeskSourceConfig.js";

const REGISTRO = "pctecdb";

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
  return new MariaDbHelpdeskReadOnlySource(new ConexaoEspia(rows), registro);
}

describe("conector read-only do Helpdesk — empresas", () => {
  it("lê do schema AUTORITATIVO, qualificado, e nunca da tabela local", async () => {
    const conexao = new ConexaoEspia([linha()]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO);

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
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO);

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
      ["constructor", "readClientById", "readClients", "readUsersByClientId", "readUsersByIds", "select"].sort()
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
    await new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO).readClientById(71);

    expect(conexao.sqls).toHaveLength(1);
    expect(conexao.sqls[0]).toContain("documento");
    expect(conexao.sqls[0]).toContain("tipo_doc");
  });
});

/**
 * Usuários — a recusa.
 *
 * Não há caminho feliz aqui de propósito: enquanto o Helpdesk não
 * concluir a migração da autoridade de usuários, a única resposta
 * correta é recusar. Ver `HelpdeskUserSourceUnavailableError`.
 */
describe("conector read-only do Helpdesk — fonte de usuários indisponível", () => {
  it("`readUsersByIds` recusa com o código estável, sem tocar na conexão", async () => {
    const conexao = new ConexaoEspia();
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO);

    await expect(source.readUsersByIds([35, 44])).rejects.toThrow(HelpdeskUserSourceUnavailableError);
    await expect(source.readUsersByIds([35, 44])).rejects.toMatchObject({
      code: "HELPDESK_USER_SOURCE_UNAVAILABLE"
    });
    expect(conexao.sqls).toHaveLength(0);
  });

  it("`readUsersByClientId` recusa igual, sem tocar na conexão", async () => {
    const conexao = new ConexaoEspia();
    const source = new MariaDbHelpdeskReadOnlySource(conexao, REGISTRO);

    await expect(source.readUsersByClientId(71)).rejects.toMatchObject({
      code: "HELPDESK_USER_SOURCE_UNAVAILABLE"
    });
    expect(conexao.sqls).toHaveLength(0);
  });

  it("NUNCA devolve lista vazia — a recusa não pode ser confundida com 'não há usuários'", async () => {
    const source = conector();

    const resultado = await source.readUsersByClientId(71).then(
      (r) => ({ tipo: "resolveu" as const, valor: r }),
      (e: unknown) => ({ tipo: "recusou" as const, valor: e })
    );

    expect(resultado.tipo).toBe("recusou");
  });

  it("a recusa não menciona tabela, schema nem usuário de banco", async () => {
    const erro = await conector()
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
    const source = new MariaDbHelpdeskReadOnlySource(conexao, "pctecdb; DROP DATABASE alvo");

    await expect(source.readClientById(71)).rejects.toThrow(ForbiddenSourceQueryError);
    expect(conexao.sqls).toHaveLength(0);
  });
});
