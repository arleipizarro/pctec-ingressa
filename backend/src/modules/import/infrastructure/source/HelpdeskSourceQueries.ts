import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Colunas que a fonte pode projetar. Lista fechada, em ordem fixa.
 *
 * A tabela `users` do Helpdesk guarda `password`, `reset_token` e
 * `reset_expires` na MESMA linha do cadastro. Não existe `SELECT *` em
 * lugar nenhum deste conector — e o principal MariaDB da fonte tem
 * privilégio de COLUNA, então nem com um bug essas colunas sairiam do
 * banco. Duas travas independentes, porque a consequência de furar as
 * duas é irreversível: segredo copiado para `import_batch_items` não
 * volta atrás.
 */
export const SOURCE_USER_COLUMNS: readonly string[] = Object.freeze([
  "id",
  "name",
  "email",
  "role",
  "active",
  "client_id"
]);

export const SOURCE_CLIENT_COLUMNS: readonly string[] = Object.freeze(["id", "name", "active"]);

/**
 * Projeção do CNPJ — SEPARADA da projeção do catálogo, e é essa
 * separação que importa.
 *
 * `pctec_helpdesk.clients` tem a coluna `cnpj`, mas o principal
 * read-only do Ingressa tem SELECT de COLUNA em `(id, name, active)`.
 * Acrescentar `cnpj` a `SOURCE_CLIENT_COLUMNS` faria TODA listagem de
 * empresas responder `ERROR 1143` e derrubaria a etapa 1 do assistente,
 * que hoje funciona em DEV. Uma capacidade nova não pode quebrar a que
 * já está em uso.
 *
 * Então a leitura do documento é uma consulta própria, isolada, cuja
 * negativa de privilégio é tratada como "a fonte não fornece" em vez de
 * como erro — ver `MariaDbHelpdeskReadOnlySource.readClientDocument`.
 */
export const SOURCE_CLIENT_DOCUMENT_COLUMNS: readonly string[] = Object.freeze(["id", "cnpj"]);

/**
 * Termos que nunca podem aparecer no SQL da fonte — de autenticação,
 * de sessão e de recuperação de senha. A verificação é sobre o TEXTO da
 * query, e por isso pega tanto a coluna projetada quanto um filtro
 * esperto que tentasse usá-la sem projetar.
 */
export const FORBIDDEN_SQL_TERMS: readonly string[] = Object.freeze([
  "password",
  "passwd",
  "senha",
  "hash",
  "salt",
  "token",
  "secret",
  "credential",
  "api_key",
  "apikey",
  "private_key",
  "authorization",
  "reset_expires",
  "last_login",
  "session",
  "auth"
]);

/**
 * Tabelas que o conector do piloto não consulta, por decisão de
 * autorização: chamado, fila, equipe e grupo não concedem acesso — só
 * `users.client_id` concede. A auditoria do Helpdesk mostrou que
 * `client_group_id` sequer é lido como filtro de acesso lá.
 */
export const FORBIDDEN_SQL_TABLES: readonly string[] = Object.freeze([
  "tickets",
  "ticket_",
  "queues",
  "filas",
  "teams",
  "equipes",
  "client_groups",
  "client_group_id",
  "attendances",
  "atendimentos"
]);

const WRITE_STATEMENTS =
  /\b(insert|update|delete|replace|drop|alter|create|truncate|grant|revoke|call|load|into\s+outfile|set\s)\b/i;

export class ForbiddenSourceQueryError extends DomainError {
  public readonly code = "IMPORT_SOURCE_QUERY_FORBIDDEN";
  public readonly classification = "VALIDATION" as const;

  constructor(motivo: string) {
    super(`consulta à fonte recusada: ${motivo}`);
  }
}

/**
 * Portão único do conector: nenhuma string de SQL chega ao driver sem
 * passar por aqui.
 *
 * A checagem é redundante com o GRANT read-only do banco, e é para ser
 * mesmo. O GRANT protege o Helpdesk; isto protege a REGRA — um `SELECT`
 * legítimo que começasse a ler `tickets` seria aceito pelo banco (se o
 * grant mudasse) e continuaria errado, porque chamado não é vínculo
 * cadastral.
 */
export function assertReadOnlySourceQuery(sql: string): void {
  const normalizado = sql.toLowerCase();

  if (!/^\s*select\b/.test(normalizado)) {
    throw new ForbiddenSourceQueryError("somente SELECT é permitido na fonte.");
  }
  if (WRITE_STATEMENTS.test(normalizado)) {
    throw new ForbiddenSourceQueryError("comando de escrita detectado.");
  }
  if (normalizado.includes(";")) {
    throw new ForbiddenSourceQueryError("múltiplas instruções não são permitidas.");
  }
  if (/select\s+\*/.test(normalizado)) {
    throw new ForbiddenSourceQueryError("`SELECT *` traria colunas sensíveis junto — projete campo a campo.");
  }
  for (const termo of FORBIDDEN_SQL_TERMS) {
    if (normalizado.includes(termo)) {
      throw new ForbiddenSourceQueryError(`termo proibido na projeção: "${termo}".`);
    }
  }
  for (const tabela of FORBIDDEN_SQL_TABLES) {
    if (normalizado.includes(tabela)) {
      throw new ForbiddenSourceQueryError(
        `"${tabela}" não é vínculo cadastral e não pode ser consultado nesta fatia.`
      );
    }
  }
}

export interface SourceQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Usuários por id — placeholders sempre parametrizados, nunca
 * interpolados. Os ids vêm de constante do código, mas a query é escrita
 * como se viessem de fora: é assim que ela continua correta quando um
 * dia vierem.
 */
export function buildUsersByIdsQuery(ids: readonly number[]): SourceQuery {
  if (ids.length === 0) {
    throw new ForbiddenSourceQueryError("nenhum id de escopo informado — a fonte nunca é lida por inteiro.");
  }
  const placeholders = ids.map(() => "?").join(", ");
  const sql =
    `SELECT ${SOURCE_USER_COLUMNS.join(", ")} ` +
    `FROM users ` +
    `WHERE id IN (${placeholders}) ` +
    `ORDER BY id`;
  assertReadOnlySourceQuery(sql);
  return { sql, params: [...ids] };
}

/**
 * CNPJ de UMA empresa da origem.
 *
 * Projeção mínima: `id` para conferir a linha, `cnpj` porque é o que se
 * quer. Nada mais entra — nem `name`, que não participa de decisão
 * nenhuma neste caminho e cuja presença convidaria a "aproveitar" a
 * consulta para um match por nome.
 */
export function buildClientDocumentQuery(clientId: number): SourceQuery {
  const sql = `SELECT ${SOURCE_CLIENT_DOCUMENT_COLUMNS.join(", ")} FROM clients WHERE id = ? LIMIT 1`;
  assertReadOnlySourceQuery(sql);
  return { sql, params: [clientId] };
}

export function buildClientByIdQuery(clientId: number): SourceQuery {
  const sql = `SELECT ${SOURCE_CLIENT_COLUMNS.join(", ")} FROM clients WHERE id = ? LIMIT 1`;
  assertReadOnlySourceQuery(sql);
  return { sql, params: [clientId] };
}

// ---------------------------------------------------------------------
// Catálogo do assistente (v0.10.x)
// ---------------------------------------------------------------------

/**
 * As consultas do catálogo passam pela MESMA guarda das do piloto.
 *
 * Elas existem porque o assistente precisa MOSTRAR a origem antes de
 * decidir sobre ela — e é justamente aí que a tentação de "trazer só
 * mais um campo" aparece. `assertReadOnlySourceQuery` continua sendo o
 * portão único: projeção fechada, sem `SELECT *`, sem tabela de
 * chamado/fila/equipe/grupo, sem coluna de autenticação.
 *
 * Nenhuma destas consultas amplia o que o principal read-only já podia
 * ler: são as mesmas 9 colunas de `users` e `clients` do piloto, agora
 * filtradas por empresa em vez de por uma lista fixa de ids.
 */
export interface CatalogPageQuery {
  readonly q?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

function normalizarBusca(q: string | undefined): string | undefined {
  const texto = (q ?? "").trim();
  if (texto.length === 0) {
    return undefined;
  }
  // `%` e `_` são coringas de LIKE. Escapá-los impede que uma busca por
  // "%" liste a base inteira de um jeito que a paginação não previu.
  const escapado = texto.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escapado}%`;
}

/** Empresas do Helpdesk, paginadas — a base inteira nunca sai de uma vez. */
export function buildClientsCatalogQuery(query: CatalogPageQuery): SourceQuery {
  const busca = normalizarBusca(query.q);
  const where = busca === undefined ? "" : "WHERE name LIKE ? ";
  const sql =
    `SELECT ${SOURCE_CLIENT_COLUMNS.join(", ")} ` +
    `FROM clients ` +
    where +
    `ORDER BY name, id ` +
    `LIMIT ? OFFSET ?`;
  assertReadOnlySourceQuery(sql);
  const params = busca === undefined ? [query.limit, query.offset] : [busca, query.limit, query.offset];
  return { sql, params };
}

export function buildClientsCatalogCountQuery(query: Pick<CatalogPageQuery, "q">): SourceQuery {
  const busca = normalizarBusca(query.q);
  const where = busca === undefined ? "" : "WHERE name LIKE ?";
  const sql = `SELECT COUNT(id) AS total FROM clients ${where}`.trim();
  assertReadOnlySourceQuery(sql);
  return { sql, params: busca === undefined ? [] : [busca] };
}

/**
 * Usuários de UMA empresa — todos os papéis, de propósito.
 *
 * Filtrar `role = 'cliente'` aqui esconderia do ADMIN que existe um
 * interno vinculado àquela empresa, e a tela passaria a mentir por
 * omissão: quem opera veria "3 usuários" onde a origem tem 4 e nunca
 * saberia por que o quarto não aparece. Quem recusa o interno é o
 * planner, com `SOURCE_USER_NOT_EXTERNAL_ROLE` registrado no lote.
 */
export function buildUsersByClientIdQuery(clientId: number): SourceQuery {
  const sql =
    `SELECT ${SOURCE_USER_COLUMNS.join(", ")} ` +
    `FROM users ` +
    `WHERE client_id = ? ` +
    `ORDER BY id`;
  assertReadOnlySourceQuery(sql);
  return { sql, params: [clientId] };
}
