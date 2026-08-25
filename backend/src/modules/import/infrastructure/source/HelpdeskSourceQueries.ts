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

export function buildClientByIdQuery(clientId: number): SourceQuery {
  const sql = `SELECT ${SOURCE_CLIENT_COLUMNS.join(", ")} FROM clients WHERE id = ? LIMIT 1`;
  assertReadOnlySourceQuery(sql);
  return { sql, params: [clientId] };
}
