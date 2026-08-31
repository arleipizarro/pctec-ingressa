import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Colunas que a fonte pode projetar. Lista fechada, em ordem fixa.
 *
 * São as do REGISTRO AUTORITATIVO de empresas — `clientes` no schema
 * apontado por `HELPDESK_REGISTRY_DB_NAME`. É de lá que o próprio
 * Helpdesk lê (`routes/clients.js`, pool `pctecdb`), e nenhuma delas é
 * de autenticação: o registro guarda cadastro, não credencial.
 *
 * `documento` entra na projeção PRINCIPAL, e essa é a mudança que
 * elimina a consulta separada que existia antes. A separação nascera de
 * um problema que não existe mais: a projeção antiga vinha de
 * `pctec_helpdesk.clients`, cujo GRANT de coluna não incluía `cnpj`, e
 * pedir o documento junto derrubaria toda a listagem com `ERROR 1143`.
 * No registro autoritativo o documento é parte do cadastro como
 * qualquer outro campo, então pedir duas vezes seria só uma ida a mais
 * ao banco para responder à mesma pergunta.
 *
 * `tipo_doc` vem junto porque sem ele `documento` é ambíguo: a mesma
 * coluna guarda CPF e CNPJ, e tratar os dois como iguais faria uma
 * pessoa física virar candidata a correspondência de empresa.
 */
export const SOURCE_CLIENT_COLUMNS: readonly string[] = Object.freeze([
  "id",
  "nome",
  "tipo_doc",
  "documento",
  "ativo"
]);

/**
 * Colunas que a fonte pode projetar de USUÁRIOS. Lista fechada, em
 * ordem fixa — e cada uma responde a uma pergunta da decisão de
 * importar (ver `HelpdeskUserRecord`).
 *
 * A tabela `users` do Helpdesk guarda `password`, `reset_token` e
 * `reset_expires` na MESMA linha do cadastro, e ainda `pctecdb_id`,
 * `is_dispatcher`, `created_at`, `last_login` e `client_group_id`.
 * Nenhum deles está aqui, e a ausência de cada um tem motivo:
 *
 *  - `password`, `reset_token`, `reset_expires`, `last_login`: são
 *    credencial e sessão. Segredo copiado para `import_batch_items` não
 *    volta atrás;
 *  - `pctecdb_id`, `is_dispatcher`, `created_at`: descrevem o usuário
 *    dentro do Helpdesk, não a decisão de importá-lo;
 *  - `client_group_id`: grupo é classificação, não concessão. Continua
 *    em `FORBIDDEN_SQL_TABLES`, então nem um filtro esperto o alcança.
 *
 * A projeção é a primeira das duas travas. A segunda é o GRANT de
 * COLUNA do principal read-only — as duas dizem a mesma coisa em dois
 * lugares que falham fechado, e nenhuma confia na outra.
 */
export const SOURCE_USER_COLUMNS: readonly string[] = Object.freeze([
  "id",
  "name",
  "email",
  "role",
  "active",
  "client_id"
]);

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
 * Tabelas que este conector não consulta, por decisão de autorização:
 * chamado, fila, equipe e grupo não concedem acesso a nada. A auditoria
 * do Helpdesk mostrou que `client_group_id` sequer é lido como filtro de
 * acesso lá.
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
 * Schema autoritativo, qualificado e revalidado no ponto de montagem.
 *
 * O nome já foi validado no carregamento da configuração. É validado de
 * novo aqui, e a repetição é deliberada: este é o único lugar do
 * conector em que um valor de configuração entra no TEXTO do SQL, e uma
 * segunda instância desta função pode ser construída em teste, em CLI
 * ou num futuro caminho de composição que não passe pelo loader. A
 * checagem custa uma regex e fecha a porta em todos eles.
 *
 * Crases também: elas não substituem a validação (uma crase dentro do
 * nome escaparia do identificador), mas fazem o nome válido continuar
 * válido se um dia contiver algo que o parser trate como palavra
 * reservada.
 */
const IDENTIFICADOR_SQL_SEGURO = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/;

function qualificar(schema: string, tabela: string, recusa: string): string {
  if (!IDENTIFICADOR_SQL_SEGURO.test(schema)) {
    throw new ForbiddenSourceQueryError(recusa);
  }
  return `\`${schema}\`.${tabela}`;
}

export function qualificarRegistro(registryDatabase: string, tabela: string): string {
  return qualificar(registryDatabase, tabela, "schema autoritativo inválido — a consulta não foi montada.");
}

/**
 * Schema do PRÓPRIO Helpdesk — de onde vêm os USUÁRIOS.
 *
 * Função separada de `qualificarRegistro`, e a separação é o ponto:
 * são dois schemas com papéis diferentes, e um só qualificador
 * convidaria ao erro exato que custou caro aqui — montar
 * `pctecdb.users`, que não existe, ou `pctec_helpdesk.clientes`, que é
 * uma cópia órfã e desatualizada do cadastro. Empresas vêm do registro
 * autoritativo; usuários vêm do Helpdesk. Cada um com o seu.
 *
 * Qualificar em vez de confiar no schema default da conexão também é
 * decisão: o mesmo texto de SQL passa a significar a mesma tabela
 * independentemente de quem abriu o pool.
 */
export function qualificarHelpdesk(helpdeskDatabase: string, tabela: string): string {
  return qualificar(helpdeskDatabase, tabela, "schema do Helpdesk inválido — a consulta não foi montada.");
}

export function buildClientByIdQuery(registryDatabase: string, clientId: number): SourceQuery {
  const sql = `SELECT ${SOURCE_CLIENT_COLUMNS.join(", ")} FROM ${qualificarRegistro(registryDatabase, "clientes")} WHERE id = ? LIMIT 1`;
  assertReadOnlySourceQuery(sql);
  return { sql, params: [clientId] };
}

/**
 * Usuários do escopo, buscados pelos ids que o ADMIN selecionou.
 *
 * Recebe os ids em vez de ler a empresa inteira porque a seleção é a
 * unidade de decisão: o planner precisa enxergar TAMBÉM o usuário cujo
 * `client_id` não é o da seleção, para registrar
 * `SOURCE_USER_CLIENT_OUT_OF_SELECTION` com motivo em vez de a pessoa
 * sumir do relatório sem explicação. Por isso não há `WHERE client_id`
 * aqui — o filtro é do domínio, não do SQL.
 *
 * Lista vazia é RECUSA, não `WHERE id IN ()`. Sem ids não há escopo, e
 * uma consulta sem escopo leria a base inteira — que é exatamente o que
 * esta fonte nunca faz.
 */
export function buildUsersByIdsQuery(helpdeskDatabase: string, ids: readonly number[]): SourceQuery {
  if (ids.length === 0) {
    throw new ForbiddenSourceQueryError("nenhum id de escopo informado — a fonte nunca é lida por inteiro.");
  }
  const placeholders = ids.map(() => "?").join(", ");
  const sql =
    `SELECT ${SOURCE_USER_COLUMNS.join(", ")} ` +
    `FROM ${qualificarHelpdesk(helpdeskDatabase, "users")} ` +
    `WHERE id IN (${placeholders}) ` +
    `ORDER BY id`;
  assertReadOnlySourceQuery(sql);
  return { sql, params: [...ids] };
}

/**
 * Usuários de UMA empresa — o que o assistente mostra na etapa 2.
 *
 * Traz todos os papéis, não só `cliente`, e isso é deliberado: o ADMIN
 * precisa VER que existe um interno vinculado àquela empresa para
 * entender por que ele não é importável. Filtrar aqui faria a tela
 * mentir por omissão. A elegibilidade é decidida no domínio
 * (`avaliarElegibilidade`), com motivo registrado item a item.
 */
export function buildUsersByClientIdQuery(helpdeskDatabase: string, clientId: number): SourceQuery {
  const sql =
    `SELECT ${SOURCE_USER_COLUMNS.join(", ")} ` +
    `FROM ${qualificarHelpdesk(helpdeskDatabase, "users")} ` +
    `WHERE client_id = ? ` +
    `ORDER BY id`;
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
 * ler: são as mesmas cinco colunas do cadastro que `buildClientByIdQuery`
 * projeta, agora paginadas em vez de buscadas por id.
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
export function buildClientsCatalogQuery(registryDatabase: string, query: CatalogPageQuery): SourceQuery {
  const busca = normalizarBusca(query.q);
  const where = busca === undefined ? "" : "WHERE nome LIKE ? ";
  const sql =
    `SELECT ${SOURCE_CLIENT_COLUMNS.join(", ")} ` +
    `FROM ${qualificarRegistro(registryDatabase, "clientes")} ` +
    where +
    `ORDER BY nome, id ` +
    `LIMIT ? OFFSET ?`;
  assertReadOnlySourceQuery(sql);
  const params = busca === undefined ? [query.limit, query.offset] : [busca, query.limit, query.offset];
  return { sql, params };
}

export function buildClientsCatalogCountQuery(
  registryDatabase: string,
  query: Pick<CatalogPageQuery, "q">
): SourceQuery {
  const busca = normalizarBusca(query.q);
  const where = busca === undefined ? "" : "WHERE nome LIKE ?";
  const sql = `SELECT COUNT(id) AS total FROM ${qualificarRegistro(registryDatabase, "clientes")} ${where}`.trim();
  assertReadOnlySourceQuery(sql);
  return { sql, params: busca === undefined ? [] : [busca] };
}
