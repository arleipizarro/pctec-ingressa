import { describe, expect, it } from "vitest";
import {
  assertReadOnlySourceQuery,
  buildClientByIdQuery,
  ForbiddenSourceQueryError,
  qualificarRegistro,
  SOURCE_CLIENT_COLUMNS
} from "../infrastructure/source/HelpdeskSourceQueries.js";

const REGISTRO = "pctecdb";

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
    const { sql } = buildClientByIdQuery(REGISTRO, 75);
    const normalizado = sql.toLowerCase();
    for (const proibido of CAMPOS_DE_AUTENTICACAO) {
      expect(normalizado).not.toContain(proibido);
    }
  });

  it("projeta exatamente as cinco colunas do cadastro necessárias à decisão", () => {
    const { sql, params } = buildClientByIdQuery(REGISTRO, 75);
    expect(SOURCE_CLIENT_COLUMNS).toEqual(["id", "nome", "tipo_doc", "documento", "ativo"]);
    for (const coluna of SOURCE_CLIENT_COLUMNS) {
      expect(sql).toContain(coluna);
    }
    expect(sql).not.toContain("*");
    expect(params).toEqual([75]);
  });

  it("o documento vem na projeção principal — não há mais consulta separada", () => {
    const { sql } = buildClientByIdQuery(REGISTRO, 75);
    expect(sql).toContain("documento");
    expect(sql).toContain("tipo_doc");
  });

  it("parametriza o id em vez de interpolá-lo", () => {
    const { sql, params } = buildClientByIdQuery(REGISTRO, 75);
    expect(sql).toContain("id = ?");
    expect(sql).not.toContain("75");
    expect(params).toEqual([75]);
  });

  it("NÃO consulta o contrato antigo — nem `clients`, nem `users`", () => {
    const { sql } = buildClientByIdQuery(REGISTRO, 75);
    expect(sql).not.toMatch(/\bFROM\s+clients\b/);
    expect(sql).not.toMatch(/\bFROM\s+users\b/);
    expect(sql).not.toContain("pctec_helpdesk");
  });
});

/**
 * Qualificação do schema autoritativo.
 *
 * Este é o único valor de configuração que entra no TEXTO de uma
 * consulta — `?` liga valores, não identificadores. A defesa é lista
 * branca, e ela vive tanto no carregamento quanto aqui.
 */
describe("consulta à fonte Helpdesk — schema autoritativo", () => {
  it("qualifica a tabela com o schema informado, entre crases", () => {
    expect(qualificarRegistro("pctecdb", "clientes")).toBe("`pctecdb`.clientes");
  });

  it("o nome do schema NÃO é fixo no código — trocar a configuração troca a consulta", () => {
    const { sql } = buildClientByIdQuery("outro_registro", 75);
    expect(sql).toContain("`outro_registro`.clientes");
    expect(sql).not.toContain("pctecdb");
  });

  it.each([
    ["ponto e vírgula", "pctecdb; DROP DATABASE alvo"],
    ["crase", "pctec`db"],
    ["espaço", "pctec db"],
    ["hífen", "pctec-db"],
    ["vazio", ""],
    ["começando com dígito", "1pctecdb"]
  ])("recusa schema inválido (%s) — a consulta nem chega a ser montada", (_rotulo, nome) => {
    expect(() => qualificarRegistro(nome, "clientes")).toThrow(ForbiddenSourceQueryError);
    expect(() => buildClientByIdQuery(nome, 75)).toThrow(ForbiddenSourceQueryError);
  });

  it("a recusa não ecoa o valor recebido", () => {
    try {
      qualificarRegistro("pctecdb; DROP DATABASE alvo", "clientes");
      expect.unreachable("deveria ter falhado");
    } catch (error) {
      expect((error as Error).message).not.toContain("DROP DATABASE");
    }
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

  it("aceita a consulta legítima do cadastro", () => {
    expect(() => assertReadOnlySourceQuery(buildClientByIdQuery(REGISTRO, 75).sql)).not.toThrow();
  });
});
