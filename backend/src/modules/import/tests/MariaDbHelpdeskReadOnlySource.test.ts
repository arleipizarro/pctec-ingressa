import { describe, expect, it } from "vitest";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { MariaDbHelpdeskReadOnlySource } from "../infrastructure/source/MariaDbHelpdeskReadOnlySource.js";
import { ForbiddenSourceQueryError } from "../infrastructure/source/HelpdeskSourceQueries.js";
import { loadHelpdeskSourceConfig, MissingHelpdeskSourceConfigError } from "../infrastructure/source/HelpdeskSourceConfig.js";

class ConexaoEspia implements Queryable {
  public readonly sqls: string[] = [];

  public constructor(private readonly rows: unknown[] = []) {}

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.sqls.push(sql);
    void params;
    return [this.rows, undefined];
  }
}

describe("conector read-only do Helpdesk", () => {
  it("emite apenas SELECT — nenhuma instrução de escrita sai daqui", async () => {
    const conexao = new ConexaoEspia([
      { id: 35, name: "Piloto Um", email: "piloto.um@example.invalid", role: "cliente", active: 1, client_id: 75 }
    ]);
    const source = new MariaDbHelpdeskReadOnlySource(conexao);

    await source.readUsersByIds([35, 44]);
    await source.readClientById(75);

    expect(conexao.sqls).toHaveLength(2);
    for (const sql of conexao.sqls) {
      expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(sql.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT)\b/);
    }
  });

  it("converte o tinyint(1) da origem em boolean na fronteira", async () => {
    const conexao = new ConexaoEspia([
      { id: 35, name: "Piloto Um", email: "piloto.um@example.invalid", role: "cliente", active: 1, client_id: 75 },
      { id: 44, name: "Piloto Dois", email: "piloto.dois@example.invalid", role: "cliente", active: 0, client_id: null }
    ]);
    const registros = await new MariaDbHelpdeskReadOnlySource(conexao).readUsersByIds([35, 44]);

    expect(registros[0]?.active).toBe(true);
    expect(registros[1]?.active).toBe(false);
    expect(registros[1]?.clientId).toBeNull();
  });

  it("não expõe método de escrita nem execução de SQL arbitrário", () => {
    const source = new MariaDbHelpdeskReadOnlySource(new ConexaoEspia());
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(source));
    // Lista fechada: o assistente (v0.10.x) acrescentou `readClients` e
    // `readUsersByClientId`, e a correspondência com o Portal (v0.12.x)
    // acrescentou `readClientDocument` — todos SELECT. Qualquer método
    // novo que apareça aqui sem passar por esta linha quebra o teste —
    // que é o ponto, porque é assim que um `execute` público entraria
    // sem ninguém decidir que devia entrar.
    expect(metodos.sort()).toEqual(
      [
        "constructor",
        "readClientById",
        "readClientDocument",
        "readClients",
        "readUsersByClientId",
        "readUsersByIds",
        "select"
      ].sort()
    );
    expect((source as unknown as Record<string, unknown>)["execute"]).toBeUndefined();
  });

  it("recusa escopo vazio antes de tocar na conexão", async () => {
    const conexao = new ConexaoEspia();
    await expect(new MariaDbHelpdeskReadOnlySource(conexao).readUsersByIds([])).rejects.toThrow(
      ForbiddenSourceQueryError
    );
    expect(conexao.sqls).toHaveLength(0);
  });
});

describe("configuração da fonte", () => {
  const COMPLETA = {
    HELPDESK_DB_HOST: "127.0.0.1",
    HELPDESK_DB_PORT: "3306",
    HELPDESK_DB_NAME: "pctec_helpdesk",
    HELPDESK_DB_USER: "pctec_helpdesk_ingressa_ro",
    HELPDESK_DB_PASSWORD: "irrelevante-para-o-teste"
  };

  it("carrega as cinco variáveis com prefixo próprio", () => {
    const config = loadHelpdeskSourceConfig(COMPLETA as NodeJS.ProcessEnv);
    expect(config.database).toBe("pctec_helpdesk");
    expect(config.user).toBe("pctec_helpdesk_ingressa_ro");
    expect(config.port).toBe(3306);
  });

  it.each(Object.keys(COMPLETA))("falha fechado sem %s — nunca cai em default", (chave) => {
    const parcial = { ...COMPLETA } as Record<string, string>;
    delete parcial[chave];
    expect(() => loadHelpdeskSourceConfig(parcial as NodeJS.ProcessEnv)).toThrow(MissingHelpdeskSourceConfigError);
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

/**
 * Leitura do CNPJ da empresa de origem.
 *
 * O achado que dá razão a estes testes: `pctec_helpdesk.clients` TEM a
 * coluna `cnpj` (`VARCHAR(20)`, no schema do Helpdesk), mas a
 * credencial read-only do Ingressa tem SELECT de COLUNA em
 * `(id, name, active)`. Pedir `cnpj` responde `ERROR 1143`. Ampliar o
 * GRANT é decisão de quem opera; o código precisa se comportar
 * corretamente antes e depois dela.
 */
class ConexaoQueFalha implements Queryable {
  public constructor(private readonly erro: unknown) {}
  public async execute(): Promise<[unknown, unknown]> {
    throw this.erro;
  }
}

function erroDeBanco(errno: number, message: string): Error & { errno: number } {
  return Object.assign(new Error(message), { errno });
}

describe("conector read-only do Helpdesk — CNPJ da empresa", () => {
  it("devolve o documento quando a fonte o fornece", async () => {
    const conexao = new ConexaoEspia([{ id: 75, cnpj: "11.222.333/0001-81" }]);
    const leitura = await new MariaDbHelpdeskReadOnlySource(conexao).readClientDocument(75);

    expect(leitura).toEqual({ available: true, documentNumber: "11.222.333/0001-81" });
    expect(conexao.sqls[0]?.trim().toUpperCase().startsWith("SELECT")).toBe(true);
  });

  it("distingue 'empresa sem CNPJ' de 'fonte não fornece'", async () => {
    const semCnpj = new MariaDbHelpdeskReadOnlySource(new ConexaoEspia([{ id: 75, cnpj: null }]));
    expect(await semCnpj.readClientDocument(75)).toEqual({ available: true, documentNumber: null });

    const semPrivilegio = new MariaDbHelpdeskReadOnlySource(
      new ConexaoQueFalha(
        erroDeBanco(1143, "SELECT command denied to user 'x'@'localhost' for column 'cnpj' in table 'clients'")
      )
    );
    expect(await semPrivilegio.readClientDocument(75)).toEqual({ available: false });
  });

  it("coluna inexistente também é 'não fornece'", async () => {
    const source = new MariaDbHelpdeskReadOnlySource(
      new ConexaoQueFalha(erroDeBanco(1054, "Unknown column 'cnpj' in 'field list'"))
    );
    expect(await source.readClientDocument(75)).toEqual({ available: false });
  });

  it("qualquer outro erro SOBE — falha de infraestrutura não é 'não fornece'", async () => {
    const source = new MariaDbHelpdeskReadOnlySource(
      new ConexaoQueFalha(erroDeBanco(2003, "connect ECONNREFUSED"))
    );
    await expect(source.readClientDocument(75)).rejects.toThrow("connect ECONNREFUSED");
  });

  it("a projeção do CNPJ não traz nome — nada convida a um match por nome", async () => {
    const conexao = new ConexaoEspia([{ id: 75, cnpj: null }]);
    await new MariaDbHelpdeskReadOnlySource(conexao).readClientDocument(75);

    expect(conexao.sqls[0]).toContain("id, cnpj");
    expect(conexao.sqls[0]).not.toContain("name");
  });
});
