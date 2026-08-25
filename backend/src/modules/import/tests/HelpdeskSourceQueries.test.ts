import { describe, expect, it } from "vitest";
import {
  assertReadOnlySourceQuery,
  buildClientByIdQuery,
  buildUsersByIdsQuery,
  ForbiddenSourceQueryError,
  SOURCE_USER_COLUMNS
} from "../infrastructure/source/HelpdeskSourceQueries.js";

/**
 * Trava da PROJEÇÃO — o teste-guarda pedido para esta fatia.
 *
 * `users` do Helpdesk guarda `password`, `reset_token` e `reset_expires`
 * na mesma linha do cadastro. A prova de que eles não saem do banco não
 * pode depender de alguém reler a query no code review.
 */
describe("consulta à fonte Helpdesk — projeção", () => {
  const CAMPOS_DE_AUTENTICACAO = [
    "password",
    "passwd",
    "senha",
    "hash",
    "salt",
    "token",
    "reset_token",
    "reset_expires",
    "secret",
    "credential",
    "api_key",
    "authorization",
    "session",
    "last_login"
  ];

  it("não seleciona nenhum campo de autenticação, sessão ou recuperação", () => {
    const { sql } = buildUsersByIdsQuery([35, 44]);
    const normalizado = sql.toLowerCase();
    for (const proibido of CAMPOS_DE_AUTENTICACAO) {
      expect(normalizado).not.toContain(proibido);
    }
  });

  it("projeta exatamente as seis colunas necessárias à decisão", () => {
    const { sql } = buildUsersByIdsQuery([35, 44]);
    expect(SOURCE_USER_COLUMNS).toEqual(["id", "name", "email", "role", "active", "client_id"]);
    for (const coluna of SOURCE_USER_COLUMNS) {
      expect(sql).toContain(coluna);
    }
    expect(sql).not.toContain("*");
  });

  it("parametriza os ids em vez de interpolá-los", () => {
    const { sql, params } = buildUsersByIdsQuery([35, 44]);
    expect(sql).toContain("IN (?, ?)");
    expect(sql).not.toContain("35");
    expect(params).toEqual([35, 44]);
  });

  it("recusa leitura sem escopo — a fonte nunca é lida por inteiro", () => {
    expect(() => buildUsersByIdsQuery([])).toThrow(ForbiddenSourceQueryError);
  });

  it("lê o cliente só pelos três campos que importam", () => {
    const { sql, params } = buildClientByIdQuery(75);
    expect(sql).toContain("SELECT id, name, active");
    expect(params).toEqual([75]);
  });
});

describe("guarda de SQL da fonte", () => {
  it.each([
    ["UPDATE users SET active = 0", "escrita"],
    ["DELETE FROM users WHERE id = 35", "escrita"],
    ["INSERT INTO users (id) VALUES (1)", "escrita"],
    ["SELECT id, password FROM users WHERE id = 35", "campo sensível"],
    ["SELECT * FROM users WHERE id = 35", "SELECT *"],
    ["SELECT id FROM users WHERE id = 35; DROP TABLE users", "múltiplas instruções"],
    ["SELECT id FROM tickets WHERE user_id = 35", "tabela proibida"],
    ["SELECT client_group_id FROM users WHERE id = 35", "grupo não autoriza"]
  ])("recusa %s (%s)", (sql) => {
    expect(() => assertReadOnlySourceQuery(sql)).toThrow(ForbiddenSourceQueryError);
  });

  it("aceita a consulta legítima do piloto", () => {
    expect(() => assertReadOnlySourceQuery(buildUsersByIdsQuery([35, 44]).sql)).not.toThrow();
  });
});
