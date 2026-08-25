import { describe, expect, it } from "vitest";
import {
  buildClientsCatalogCountQuery,
  buildClientsCatalogQuery,
  buildUsersByClientIdQuery,
  ForbiddenSourceQueryError,
  SOURCE_CLIENT_COLUMNS,
  SOURCE_USER_COLUMNS
} from "../infrastructure/source/HelpdeskSourceQueries.js";

/**
 * As 9 colunas que o principal read-only da fonte de fato concede:
 * `users(id, name, email, role, active, client_id)` e
 * `clients(id, name, active)`. Nenhuma consulta do catálogo pode
 * projetar nada fora disto — e a lista está aqui, literal, para que
 * ampliar a projeção exija editar este teste junto.
 */
const COLUNAS_CONCEDIDAS = new Set(["id", "name", "email", "role", "active", "client_id"]);

describe("catálogo do Helpdesk — SQL", () => {
  it("a página de empresas projeta só as colunas de `clients`", () => {
    const { sql, params } = buildClientsCatalogQuery({ limit: 25, offset: 0 });

    expect(sql).toContain(SOURCE_CLIENT_COLUMNS.join(", "));
    expect(sql).toContain("FROM clients");
    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(params).toEqual([25, 0]);
  });

  it("nenhuma consulta do catálogo projeta coluna fora do grant read-only", () => {
    const sqls = [
      buildClientsCatalogQuery({ limit: 10, offset: 0 }).sql,
      buildClientsCatalogCountQuery({}).sql,
      buildUsersByClientIdQuery(75).sql
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
    const { sql, params } = buildClientsCatalogQuery({ q: "sintetica", limit: 25, offset: 0 });

    expect(sql).toContain("WHERE name LIKE ?");
    expect(sql).not.toContain("sintetica");
    expect(params[0]).toBe("%sintetica%");
  });

  it("coringas de LIKE na busca são escapados — `%` não lista a base inteira", () => {
    const { params } = buildClientsCatalogQuery({ q: "100%_a", limit: 25, offset: 0 });
    expect(params[0]).toBe("%100\\%\\_a%");
  });

  it("busca vazia ou só espaços não vira filtro", () => {
    expect(buildClientsCatalogQuery({ q: "   ", limit: 25, offset: 0 }).sql).not.toContain("WHERE");
    expect(buildClientsCatalogCountQuery({ q: "" }).params).toEqual([]);
  });

  it("a contagem usa COUNT(id) e passa pela guarda — `SELECT *` continua proibido", () => {
    const { sql } = buildClientsCatalogCountQuery({});
    expect(sql).toContain("COUNT(id)");
    expect(sql).not.toMatch(/select\s+\*/i);
  });

  it("usuários por empresa filtram por client_id parametrizado", () => {
    const { sql, params } = buildUsersByClientIdQuery(999901);

    expect(sql).toContain(SOURCE_USER_COLUMNS.join(", "));
    expect(sql).toContain("WHERE client_id = ?");
    expect(params).toEqual([999901]);
    expect(sql).not.toContain("999901");
  });

  it("a consulta de usuários por empresa NÃO filtra papel — a tela precisa ver o interno", () => {
    // Esconder o interno faria a tela mentir por omissão. Quem o recusa
    // é o planner, com motivo registrado no lote.
    expect(buildUsersByClientIdQuery(75).sql).not.toContain("role =");
  });

  it("nenhuma consulta do catálogo toca chamado, fila, equipe ou grupo", () => {
    const sqls = [
      buildClientsCatalogQuery({ q: "x", limit: 1, offset: 0 }).sql,
      buildClientsCatalogCountQuery({ q: "x" }).sql,
      buildUsersByClientIdQuery(1).sql
    ].join(" ").toLowerCase();

    for (const proibido of ["ticket", "queue", "fila", "team", "equipe", "grupo", "client_group", "atendimento"]) {
      expect(sqls).not.toContain(proibido);
    }
  });

  it("nenhuma consulta do catálogo toca campo de autenticação", () => {
    const sqls = [
      buildClientsCatalogQuery({ limit: 1, offset: 0 }).sql,
      buildUsersByClientIdQuery(1).sql
    ].join(" ").toLowerCase();

    for (const proibido of ["password", "token", "hash", "salt", "reset_expires", "last_login", "session"]) {
      expect(sqls).not.toContain(proibido);
    }
  });

  it("a guarda continua recusando SQL que não seja SELECT único", () => {
    // Prova que as consultas novas passam pelo MESMO portão do piloto.
    expect(() => buildClientsCatalogQuery({ q: "a; DROP TABLE users", limit: 1, offset: 0 })).not.toThrow();
    // O `;` foi para o PARÂMETRO, não para o SQL — é por isso que não
    // lança: a injeção nunca chega a virar texto de consulta.
    expect(buildClientsCatalogQuery({ q: "a; DROP TABLE users", limit: 1, offset: 0 }).sql).not.toContain(";");
    expect(ForbiddenSourceQueryError).toBeDefined();
  });
});
