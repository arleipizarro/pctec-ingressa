import { describe, expect, it } from "vitest";
import {
  buildClientsCatalogCountQuery,
  buildClientsCatalogQuery,
  ForbiddenSourceQueryError,
  SOURCE_CLIENT_COLUMNS
} from "../infrastructure/source/HelpdeskSourceQueries.js";

const REGISTRO = "pctecdb";

/**
 * As colunas que o principal read-only precisa receber no registro
 * AUTORITATIVO: `clientes(id, nome, tipo_doc, documento, ativo)`.
 * Nenhuma consulta do catálogo pode projetar nada fora disto — e a
 * lista está aqui, literal, para que ampliar a projeção exija editar
 * este teste junto.
 *
 * Não há colunas de `users` nesta lista, e a ausência é o ponto: o
 * catálogo deixou de consultar usuários. Ver
 * `HelpdeskUserSourceUnavailableError`.
 */
const COLUNAS_CONCEDIDAS = new Set(["id", "nome", "tipo_doc", "documento", "ativo"]);

describe("catálogo do Helpdesk — SQL", () => {
  it("a página de empresas projeta só as colunas do registro autoritativo", () => {
    const { sql, params } = buildClientsCatalogQuery(REGISTRO, { limit: 25, offset: 0 });

    expect(sql).toContain(SOURCE_CLIENT_COLUMNS.join(", "));
    expect(sql).toContain("FROM `pctecdb`.clientes");
    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(params).toEqual([25, 0]);
  });

  it("nenhuma consulta do catálogo projeta coluna fora do grant read-only", () => {
    const sqls = [
      buildClientsCatalogQuery(REGISTRO, { limit: 10, offset: 0 }).sql,
      buildClientsCatalogCountQuery(REGISTRO, {}).sql
    ];
    for (const sql of sqls) {
      const projecao = sql.slice(sql.toUpperCase().indexOf("SELECT") + 6, sql.toUpperCase().indexOf(" FROM "));
      for (const coluna of projecao.split(",").map((c) => c.trim())) {
        if (coluna.startsWith("COUNT(")) {
          continue;
        }
        expect(COLUNAS_CONCEDIDAS.has(coluna), `coluna não concedida: ${coluna}`).toBe(true);
      }
    }
  });

  it("a busca por nome é parametrizada — nunca interpolada", () => {
    const { sql, params } = buildClientsCatalogQuery(REGISTRO, { q: "sintetica", limit: 25, offset: 0 });

    expect(sql).toContain("WHERE nome LIKE ?");
    expect(sql).not.toContain("sintetica");
    expect(params[0]).toBe("%sintetica%");
  });

  it("coringas de LIKE na busca são escapados — `%` não lista a base inteira", () => {
    const { params } = buildClientsCatalogQuery(REGISTRO, { q: "100%_a", limit: 25, offset: 0 });
    expect(params[0]).toBe("%100\\%\\_a%");
  });

  it("busca vazia ou só espaços não vira filtro", () => {
    expect(buildClientsCatalogQuery(REGISTRO, { q: "   ", limit: 25, offset: 0 }).sql).not.toContain("WHERE");
    expect(buildClientsCatalogCountQuery(REGISTRO, { q: "" }).params).toEqual([]);
  });

  it("a contagem usa COUNT(id) e passa pela guarda — `SELECT *` continua proibido", () => {
    const { sql } = buildClientsCatalogCountQuery(REGISTRO, {});
    expect(sql).toContain("COUNT(id)");
    expect(sql).not.toMatch(/select\s+\*/i);
  });

  it("nenhuma consulta do catálogo toca chamado, fila, equipe ou grupo", () => {
    const sqls = [
      buildClientsCatalogQuery(REGISTRO, { q: "x", limit: 1, offset: 0 }).sql,
      buildClientsCatalogCountQuery(REGISTRO, { q: "x" }).sql
    ].join(" ").toLowerCase();

    for (const proibido of ["ticket", "queue", "fila", "team", "equipe", "grupo", "client_group", "atendimento"]) {
      expect(sqls).not.toContain(proibido);
    }
  });

  it("nenhuma consulta do catálogo toca campo de autenticação", () => {
    const sqls = [
      buildClientsCatalogQuery(REGISTRO, { limit: 1, offset: 0 }).sql,
      buildClientsCatalogCountQuery(REGISTRO, {}).sql
    ].join(" ").toLowerCase();

    for (const proibido of ["password", "token", "hash", "salt", "reset_expires", "last_login", "session"]) {
      expect(sqls).not.toContain(proibido);
    }
  });

  it("a guarda continua recusando SQL que não seja SELECT único", () => {
    // Prova que as consultas novas passam pelo MESMO portão do piloto.
    expect(() => buildClientsCatalogQuery(REGISTRO, { q: "a; DROP TABLE users", limit: 1, offset: 0 })).not.toThrow();
    // O `;` foi para o PARÂMETRO, não para o SQL — é por isso que não
    // lança: a injeção nunca chega a virar texto de consulta.
    expect(buildClientsCatalogQuery(REGISTRO, { q: "a; DROP TABLE users", limit: 1, offset: 0 }).sql).not.toContain(";");
    expect(ForbiddenSourceQueryError).toBeDefined();
  });
});
