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
    // `readUsersByClientId`, ambos SELECT. Qualquer método novo que
    // apareça aqui sem passar por esta linha quebra o teste — que é o
    // ponto, porque é assim que um `execute` público entraria sem
    // ninguém decidir que devia entrar.
    expect(metodos.sort()).toEqual(
      ["constructor", "readClientById", "readClients", "readUsersByClientId", "readUsersByIds", "select"].sort()
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
