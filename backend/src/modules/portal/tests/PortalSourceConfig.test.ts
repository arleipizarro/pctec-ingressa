import { describe, expect, it } from "vitest";
import {
  MissingPortalSourceConfigError,
  loadPortalSourceConfig
} from "../infrastructure/source/PortalSourceConfig.js";
import { MariaDbPortalReconciliationReadRepository } from "../infrastructure/persistence/MariaDbPortalReconciliationReadRepository.js";
import type { Queryable } from "../../../shared/database/Queryable.js";

const COMPLETO = {
  PORTAL_SOURCE_DB_HOST: "127.0.0.1",
  PORTAL_SOURCE_DB_PORT: "3306",
  PORTAL_SOURCE_DB_NAME: "banco_sintetico",
  PORTAL_SOURCE_DB_USER: "usuario_sintetico",
  PORTAL_SOURCE_DB_PASSWORD: "segredo-sintetico-de-teste"
} as unknown as NodeJS.ProcessEnv;

describe("configuração da fonte Portal", () => {
  it("carrega quando todas as variáveis estão presentes", () => {
    expect(loadPortalSourceConfig(COMPLETO)).toEqual({
      host: "127.0.0.1",
      port: 3306,
      database: "banco_sintetico",
      user: "usuario_sintetico",
      password: "segredo-sintetico-de-teste"
    });
  });

  it("não tem default nenhum — faltando qualquer variável, falha", () => {
    for (const chave of Object.keys(COMPLETO)) {
      const parcial = { ...COMPLETO };
      delete (parcial as Record<string, unknown>)[chave];
      expect(() => loadPortalSourceConfig(parcial)).toThrow(MissingPortalSourceConfigError);
    }
    expect(() => loadPortalSourceConfig({} as NodeJS.ProcessEnv)).toThrow(MissingPortalSourceConfigError);
  });

  it("nunca reaproveita as variáveis DB_* do Ingressa", () => {
    const soDoIngressa = {
      DB_HOST: "127.0.0.1",
      DB_PORT: "3306",
      DB_NAME: "pctec_ingressa_dev",
      DB_USER: "ingressa",
      DB_PASSWORD: "nao-pode-ser-usado"
    } as unknown as NodeJS.ProcessEnv;

    // Herdar `DB_*` faria o catálogo ler o banco do Ingressa e não achar
    // cliente nenhum — "configuração ausente" virando "conectou no lugar
    // errado", que é a falha que este desenho recusa repetir.
    expect(() => loadPortalSourceConfig(soDoIngressa)).toThrow(MissingPortalSourceConfigError);
  });

  it("a mensagem lista NOMES de variável e nenhum valor", () => {
    let mensagem = "";
    try {
      loadPortalSourceConfig({ PORTAL_SOURCE_DB_HOST: "10.9.8.7" } as unknown as NodeJS.ProcessEnv);
    } catch (erro) {
      mensagem = (erro as Error).message;
    }

    expect(mensagem).toContain("PORTAL_SOURCE_DB_PASSWORD");
    expect(mensagem).not.toContain("10.9.8.7");
    expect(mensagem).not.toContain("segredo");
  });
});

class ConexaoEspia implements Queryable {
  public readonly chamadas: { sql: string; params: readonly unknown[] }[] = [];
  public constructor(private readonly rows: unknown[] = []) {}
  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.chamadas.push({ sql, params: params ?? [] });
    return [this.rows, undefined];
  }
}

describe("leitura das candidatas à reconciliação", () => {
  it("consulta só COMPANY ACTIVE, paginada e parametrizada", async () => {
    const conexao = new ConexaoEspia([{ total: 0 }]);
    await new MariaDbPortalReconciliationReadRepository(conexao).listCandidates({ limit: 25, offset: 50 });

    const pagina = conexao.chamadas[1]!;
    expect(pagina.sql).toContain("o.type = 'COMPANY' AND o.status = 'ACTIVE'");
    expect(pagina.sql).toContain("LIMIT ? OFFSET ?");
    expect(pagina.params).toEqual(["PCTEC_PORTAL", "clientes", 25, 50]);
  });

  it("somente SELECT — nenhuma escrita sai deste repositório", async () => {
    const conexao = new ConexaoEspia([{ total: 0 }]);
    const repositorio = new MariaDbPortalReconciliationReadRepository(conexao);
    await repositorio.listCandidates({ limit: 10, offset: 0 });
    await repositorio.findCandidates(["aaaaaaaa-1111-4111-8111-111111111111"]);

    for (const chamada of conexao.chamadas) {
      expect(chamada.sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(chamada.sql.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT)\b/);
    }
  });

  it("lista vazia não vira consulta — e não vira `IN ()`", async () => {
    const conexao = new ConexaoEspia();
    const resultado = await new MariaDbPortalReconciliationReadRepository(conexao).findCandidates([]);

    expect(resultado).toEqual([]);
    expect(conexao.chamadas).toHaveLength(0);
  });

  it("os publicId entram como placeholders, nunca interpolados", async () => {
    const conexao = new ConexaoEspia();
    const ids = ["aaaaaaaa-1111-4111-8111-111111111111", "bbbbbbbb-2222-4222-8222-222222222222"];
    await new MariaDbPortalReconciliationReadRepository(conexao).findCandidates(ids);

    const chamada = conexao.chamadas[0]!;
    expect(chamada.sql).toContain("IN (?, ?)");
    for (const id of ids) {
      expect(chamada.sql).not.toContain(id);
    }
    expect(chamada.params).toEqual(["PCTEC_PORTAL", "clientes", ...ids]);
  });
});
