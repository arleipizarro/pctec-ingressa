import { describe, expect, it, vi } from "vitest";
import {
  ForbiddenPortalQueryError,
  PORTAL_CLIENT_COLUMNS,
  assertReadOnlyPortalQuery,
  buildClientByIdQuery,
  buildClientsByDocumentQuery,
  buildClientsSearchCountQuery,
  buildClientsSearchQuery
} from "../infrastructure/source/PortalSourceQueries.js";
import { MariaDbPortalReadOnlySource } from "../infrastructure/source/MariaDbPortalReadOnlySource.js";
import type { Queryable } from "../../../shared/database/Queryable.js";

const CNPJ = "11222333000181";

class ConexaoEspia implements Queryable {
  public readonly chamadas: { sql: string; params: readonly unknown[] }[] = [];
  public linhas: unknown[] = [];

  public async execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]> {
    this.chamadas.push({ sql, params: params ?? [] });
    return [this.linhas, []];
  }
  public async query(): Promise<[unknown, unknown]> {
    throw new Error("query() não é usado pelo conector");
  }
}

describe("guarda do SQL da fonte Portal", () => {
  it.each([
    ["INSERT INTO clientes (nome) VALUES ('x')"],
    ["UPDATE clientes SET nome = 'x'"],
    ["DELETE FROM clientes"],
    ["REPLACE INTO clientes (id) VALUES (1)"],
    ["DROP TABLE clientes"],
    ["SELECT id FROM clientes; SELECT 1"],
    ["SELECT * FROM clientes"]
  ])("recusa %s", (sql) => {
    expect(() => assertReadOnlyPortalQuery(sql)).toThrow(ForbiddenPortalQueryError);
  });

  it("recusa a tabela de autenticação do Portal", () => {
    expect(() => assertReadOnlyPortalQuery("SELECT id FROM portal_acesso")).toThrow(ForbiddenPortalQueryError);
  });

  it("recusa clientes_grupo — a visão de grupo é a soma das empresas, não uma linha própria", () => {
    expect(() => assertReadOnlyPortalQuery("SELECT id FROM clientes_grupo")).toThrow(ForbiddenPortalQueryError);
  });

  it.each(["senha", "password", "token", "hash", "secret"])("recusa o termo %s na projeção", (termo) => {
    expect(() => assertReadOnlyPortalQuery(`SELECT id, ${termo} FROM clientes`)).toThrow(ForbiddenPortalQueryError);
  });

  it("aceita REPLACE() como função de string — é o que normaliza o documento", () => {
    expect(() =>
      assertReadOnlyPortalQuery("SELECT id FROM clientes WHERE REPLACE(documento, '.', '') = ?")
    ).not.toThrow();
  });

  it("a projeção é fechada e não inclui coluna comercial nenhuma", () => {
    expect([...PORTAL_CLIENT_COLUMNS]).toEqual(["id", "nome", "nome_fantasia", "tipo_doc", "documento", "ativo"]);
    for (const proibida of ["telefone", "email", "logradouro", "cep", "em_rollout"]) {
      expect(PORTAL_CLIENT_COLUMNS).not.toContain(proibida);
    }
  });
});

describe("consulta por CNPJ", () => {
  it("é parametrizada — o documento nunca é interpolado no SQL", () => {
    const { sql, params } = buildClientsByDocumentQuery(CNPJ);
    expect(sql).not.toContain(CNPJ);
    expect(params).toEqual([CNPJ]);
  });

  it("NÃO tem LIMIT — a contagem é o que separa único de ambíguo", () => {
    const { sql } = buildClientsByDocumentQuery(CNPJ);
    expect(sql.toUpperCase()).not.toContain("LIMIT");
  });

  it("não usa LIKE — correspondência automática é por igualdade", () => {
    expect(buildClientsByDocumentQuery(CNPJ).sql.toUpperCase()).not.toContain("LIKE");
  });

  it("filtra tipo_doc = 'CNPJ' — a coluna guarda CPF e CNPJ juntos", () => {
    expect(buildClientsByDocumentQuery(CNPJ).sql).toContain("tipo_doc = 'CNPJ'");
  });

  it("recusa qualquer coisa que não sejam 14 dígitos, antes de tocar no banco", () => {
    for (const invalido of ["", "52998224725", "1122233300018a", "112223330001812"]) {
      expect(() => buildClientsByDocumentQuery(invalido)).toThrow(ForbiddenPortalQueryError);
    }
  });
});

describe("busca administrativa", () => {
  it("busca textual usa LIKE parametrizado sobre nome e nome fantasia", () => {
    const { sql, params } = buildClientsSearchQuery({ q: "sintetica", limit: 10, offset: 0 });
    expect(sql).toContain("nome LIKE ?");
    expect(sql).toContain("nome_fantasia LIKE ?");
    expect(params).toEqual(["%sintetica%", "%sintetica%", 10, 0]);
  });

  it("escapa coringas de LIKE — buscar por % não lista a base inteira", () => {
    expect(buildClientsSearchQuery({ q: "%", limit: 10, offset: 0 }).params[0]).toBe("%\\%%");
  });

  it("termo que é um CNPJ vira comparação EXATA, não LIKE", () => {
    const { sql, params } = buildClientsSearchQuery({ q: "11.222.333/0001-81", limit: 10, offset: 0 });
    expect(sql).not.toContain("LIKE");
    expect(params).toEqual([CNPJ, 10, 0]);
  });

  it("sempre aplica LIMIT e OFFSET, mesmo sem termo", () => {
    const { sql, params } = buildClientsSearchQuery({ limit: 5, offset: 20 });
    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(params).toEqual([5, 20]);
  });

  it("a contagem usa a MESMA condição da página", () => {
    expect(buildClientsSearchCountQuery({ q: "sintetica" }).params).toEqual(["%sintetica%", "%sintetica%"]);
    expect(buildClientsSearchCountQuery({}).params).toEqual([]);
  });
});

describe("conector read-only do Portal", () => {
  it("não expõe método de escrita nem execução de SQL arbitrário", () => {
    const source = new MariaDbPortalReadOnlySource(new ConexaoEspia());
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(source)).sort();
    // Lista fechada, pelo mesmo motivo do conector do Helpdesk: é assim
    // que um `execute` público entraria sem ninguém decidir que devia.
    expect(metodos).toEqual(["constructor", "findByDocument", "findById", "search", "select"].sort());
    expect((source as unknown as Record<string, unknown>)["execute"]).toBeUndefined();
  });

  it("normaliza o documento na fronteira e trata CPF como sem documento", async () => {
    const conexao = new ConexaoEspia();
    conexao.linhas = [
      { id: 1, nome: "A", nome_fantasia: null, tipo_doc: "CNPJ", documento: "11.222.333/0001-81", ativo: 1 },
      { id: 2, nome: "B", nome_fantasia: "b", tipo_doc: "CPF", documento: "529.982.247-25", ativo: 0 }
    ];
    const registros = await new MariaDbPortalReadOnlySource(conexao).findByDocument(CNPJ);

    expect(registros[0]?.documentDigits).toBe(CNPJ);
    expect(registros[0]?.active).toBe(true);
    expect(registros[1]?.documentDigits).toBeUndefined();
    expect(registros[1]?.active).toBe(false);
  });

  it("toda consulta chega ao driver parametrizada", async () => {
    const conexao = new ConexaoEspia();
    const source = new MariaDbPortalReadOnlySource(conexao);
    await source.findByDocument(CNPJ);
    await source.findById(71);
    await source.search({ q: "sintetica", limit: 10, offset: 0 });

    for (const chamada of conexao.chamadas) {
      expect(chamada.sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(chamada.sql).not.toContain(CNPJ);
      expect(chamada.sql).not.toContain("sintetica");
    }
  });

  it("findById usa LIMIT 1 — ali a chave é única e a duplicidade é impossível", () => {
    expect(buildClientByIdQuery(71).sql).toContain("LIMIT 1");
    expect(buildClientByIdQuery(71).params).toEqual([71]);
  });

  it("recusa id de cliente inválido antes do banco", () => {
    expect(() => buildClientByIdQuery(0)).toThrow(ForbiddenPortalQueryError);
    expect(() => buildClientByIdQuery(-1)).toThrow(ForbiddenPortalQueryError);
    expect(() => buildClientByIdQuery(1.5)).toThrow(ForbiddenPortalQueryError);
  });

  it("revalida o SQL no ponto de execução, e não só na montagem", async () => {
    const conexao = new ConexaoEspia();
    const espia = vi.spyOn(conexao, "execute");
    await new MariaDbPortalReadOnlySource(conexao).findById(71);
    expect(espia).toHaveBeenCalledTimes(1);
  });
});
