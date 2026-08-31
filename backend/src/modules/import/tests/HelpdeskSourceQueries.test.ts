import { describe, expect, it } from "vitest";
import {
  assertReadOnlySourceQuery,
  buildClientByIdQuery,
  buildUsersByClientIdQuery,
  buildUsersByIdsQuery,
  ForbiddenSourceQueryError,
  qualificarHelpdesk,
  qualificarRegistro,
  SOURCE_CLIENT_COLUMNS,
  SOURCE_USER_COLUMNS
} from "../infrastructure/source/HelpdeskSourceQueries.js";

const REGISTRO = "pctecdb";
const HELPDESK = "pctec_helpdesk";

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

  it("a consulta de EMPRESAS não toca a tabela local nem a de usuários", () => {
    // Empresas vêm do registro autoritativo. A `clients` local deixou de
    // ser autoridade, e `users` responde a outra pergunta.
    const { sql } = buildClientByIdQuery(REGISTRO, 75);
    expect(sql).not.toMatch(/\bFROM\s+clients\b/);
    expect(sql).not.toMatch(/\bFROM\s+`?pctec_helpdesk`?\.?users\b/);
    expect(sql).not.toContain("pctec_helpdesk");
  });
});

/**
 * Trava da projeção de USUÁRIOS.
 *
 * `users` guarda `password`, `reset_token`, `reset_expires` e
 * `last_login` na MESMA linha do cadastro. A prova de que eles não saem
 * do banco não pode depender de alguém reler a query no code review.
 */
describe("consulta à fonte Helpdesk — projeção de usuários", () => {
  const CAMPOS_FORA_DO_CONTRATO = [
    "password",
    "reset_token",
    "reset_expires",
    "last_login",
    "pctecdb_id",
    "is_dispatcher",
    "created_at",
    "client_group_id"
  ];

  it("projeta exatamente as seis colunas da decisão", () => {
    expect(SOURCE_USER_COLUMNS).toEqual(["id", "name", "email", "role", "active", "client_id"]);
    for (const { sql } of [buildUsersByIdsQuery(HELPDESK, [35]), buildUsersByClientIdQuery(HELPDESK, 71)]) {
      for (const coluna of SOURCE_USER_COLUMNS) {
        expect(sql).toContain(coluna);
      }
      expect(sql).not.toContain("*");
    }
  });

  it("nenhum campo de credencial, sessão ou classificação entra no SQL", () => {
    for (const { sql } of [buildUsersByIdsQuery(HELPDESK, [35, 44]), buildUsersByClientIdQuery(HELPDESK, 71)]) {
      for (const proibido of CAMPOS_FORA_DO_CONTRATO) {
        expect(sql).not.toContain(proibido);
      }
    }
  });

  it("qualifica no schema do HELPDESK — nunca no do registro autoritativo", () => {
    expect(qualificarHelpdesk("pctec_helpdesk", "users")).toBe("`pctec_helpdesk`.users");
    for (const { sql } of [buildUsersByIdsQuery(HELPDESK, [35]), buildUsersByClientIdQuery(HELPDESK, 71)]) {
      expect(sql).toContain("`pctec_helpdesk`.users");
      expect(sql).not.toContain("`pctecdb`.users");
    }
  });

  it("o nome do schema NÃO é fixo no código", () => {
    const { sql } = buildUsersByIdsQuery("outro_helpdesk", [35]);
    expect(sql).toContain("`outro_helpdesk`.users");
    expect(sql).not.toContain("pctec_helpdesk");
  });

  it("parametriza os ids em vez de interpolá-los", () => {
    const { sql, params } = buildUsersByIdsQuery(HELPDESK, [35, 44]);
    expect(sql).toContain("IN (?, ?)");
    expect(sql).not.toContain("35");
    expect(params).toEqual([35, 44]);
  });

  it("parametriza o client_id", () => {
    const { sql, params } = buildUsersByClientIdQuery(HELPDESK, 71);
    expect(sql).toContain("client_id = ?");
    expect(sql).not.toContain("71");
    expect(params).toEqual([71]);
  });

  it("lista de ids vazia é recusada — a fonte nunca é lida por inteiro", () => {
    expect(() => buildUsersByIdsQuery(HELPDESK, [])).toThrow(ForbiddenSourceQueryError);
  });

  it("NÃO filtra por papel nem por `active` — a elegibilidade é decisão do domínio", () => {
    // Filtrar aqui apagaria a diferença entre "não é elegível" e "não
    // existe", e a tela deixaria de poder explicar por que o interno
    // vinculado à empresa não é importável.
    const { sql } = buildUsersByClientIdQuery(HELPDESK, 71);
    expect(sql).not.toContain("role =");
    expect(sql).not.toContain("active =");
  });

  it.each([
    ["ponto e vírgula", "pctec_helpdesk; DROP DATABASE alvo"],
    ["crase", "pctec`helpdesk"],
    ["espaço", "pctec helpdesk"],
    ["vazio", ""],
    ["começando com dígito", "1pctec_helpdesk"]
  ])("recusa schema do Helpdesk inválido (%s) — a consulta nem chega a ser montada", (_rotulo, nome) => {
    expect(() => qualificarHelpdesk(nome, "users")).toThrow(ForbiddenSourceQueryError);
    expect(() => buildUsersByIdsQuery(nome, [35])).toThrow(ForbiddenSourceQueryError);
    expect(() => buildUsersByClientIdQuery(nome, 71)).toThrow(ForbiddenSourceQueryError);
  });

  it("a recusa não ecoa o valor recebido", () => {
    try {
      qualificarHelpdesk("pctec_helpdesk; DROP DATABASE alvo", "users");
      expect.unreachable("deveria ter falhado");
    } catch (error) {
      expect((error as Error).message).not.toContain("DROP DATABASE");
    }
  });

  it("passa pela MESMA guarda das consultas de empresa", () => {
    expect(() => assertReadOnlySourceQuery(buildUsersByIdsQuery(HELPDESK, [35]).sql)).not.toThrow();
    expect(() => assertReadOnlySourceQuery(buildUsersByClientIdQuery(HELPDESK, 71).sql)).not.toThrow();
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
