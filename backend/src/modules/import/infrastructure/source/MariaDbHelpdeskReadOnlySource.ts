import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  HelpdeskClientRecord,
  HelpdeskSourceReader,
  HelpdeskUserRecord
} from "../../domain/pilot/HelpdeskSourcePort.js";
import { HelpdeskUserSourceUnavailableError } from "../../domain/errors/HelpdeskUserSourceErrors.js";
import type {
  HelpdeskCatalogPage,
  HelpdeskCatalogQuery,
  HelpdeskCatalogReader
} from "../../domain/wizard/HelpdeskCatalogPort.js";
import {
  assertReadOnlySourceQuery,
  buildClientByIdQuery,
  buildClientsCatalogCountQuery,
  buildClientsCatalogQuery,
  buildUsersByClientIdQuery,
  buildUsersByIdsQuery
} from "./HelpdeskSourceQueries.js";

interface UserRow {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: number | boolean | null;
  readonly client_id: number | null;
}

interface ClientRow {
  readonly id: number;
  readonly nome: string;
  readonly tipo_doc: string | null;
  readonly documento: string | null;
  readonly ativo: number | boolean | null;
}

/**
 * Conector READ-ONLY do Helpdesk.
 *
 * Lê de DOIS schemas, com uma conexão só, porque são duas autoridades
 * diferentes que hoje moram no mesmo servidor:
 *
 *  - EMPRESAS vêm do registro autoritativo (`HELPDESK_REGISTRY_DB_NAME`
 *    `.clientes`) — o mesmo de onde o próprio Helpdesk lê
 *    (`routes/clients.js`, pool `pctecdb`). A tabela local de empresas
 *    deixou de ser autoridade;
 *  - USUÁRIOS vêm de `HELPDESK_DB_NAME`.`users` — que é, hoje, o que o
 *    Helpdesk trata como autoridade de fato: é lá que a autenticação
 *    procura (`routes/auth.js`) e é lá que `role`, `client_id` e
 *    `active` são gravados (`routes/users.js`).
 *
 * O elo entre as duas é `users.client_id`, que referencia
 * `clientes.id` no registro autoritativo — é o único vínculo cadastral
 * que autoriza a importação de um usuário para uma empresa.
 *
 * `helpdesk_usuarios` continua NÃO sendo fonte: ela aparece num único
 * `INSERT IGNORE`, nenhum `SELECT` do Helpdesk a consulta e ela não
 * carrega o vínculo. Ver `docs/import/FONTE-HELPDESK-CONTRATO-ATUAL.md`.
 *
 * `HelpdeskUserSourceUnavailableError` não desapareceu: ele deixou de
 * ser incondicional e passou a significar o que sempre dizia —
 * "não consegui perguntar". Ver `traduzirFalhaDaFonte`.
 *
 * Três camadas independentes impedem escrita, e nenhuma delas confia nas
 * outras:
 *
 *  1. O principal MariaDB tem SELECT de COLUNA nas cinco colunas do
 *     cadastro. Não há INSERT/UPDATE/DELETE para conceder, nem
 *     `SELECT *` que funcione.
 *  2. `assertReadOnlySourceQuery` recusa qualquer SQL que não seja um
 *     SELECT único sobre as colunas permitidas.
 *  3. Esta classe não expõe método de escrita. Não existe `execute`
 *     público por onde passar SQL arbitrário.
 *
 * `tinyint(1)` chega do driver como número: a conversão para boolean
 * acontece aqui, na fronteira, para que o domínio nunca receba `1` e
 * precise lembrar o que significa.
 */
export class MariaDbHelpdeskReadOnlySource implements HelpdeskSourceReader, HelpdeskCatalogReader {
  public constructor(
    private readonly connection: Queryable,
    /** Schema do registro AUTORITATIVO de empresas. Configuração validada. */
    private readonly registryDatabase: string,
    /**
     * Schema do próprio Helpdesk — de onde vêm os USUÁRIOS.
     *
     * Obrigatório e sem default, pela mesma lição que vale para o
     * registro: um nome de schema fixo no código é como se lê o banco
     * errado sem perceber. Vem de `HELPDESK_DB_NAME`, validado como
     * identificador SQL no carregamento e de novo no ponto de montagem.
     */
    private readonly helpdeskDatabase: string
  ) {}

  /**
   * Usuários pelos ids do escopo.
   *
   * Devolve o que a origem tem, SEM filtrar por papel nem por `active`:
   * a elegibilidade é decisão do planner, que registra o motivo item a
   * item. Filtrar aqui apagaria a diferença entre "não é elegível" e
   * "não existe".
   */
  public async readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    const { sql, params } = buildUsersByIdsQuery(this.helpdeskDatabase, ids);
    const rows = await this.selectUsuarios(sql, params);
    return rows.map(toUser);
  }

  public async readClientById(clientId: number): Promise<HelpdeskClientRecord | undefined> {
    const { sql, params } = buildClientByIdQuery(this.registryDatabase, clientId);
    const rows = await this.select<ClientRow>(sql, params);
    const row = rows[0];
    return row === undefined ? undefined : toClient(row);
  }

  /**
   * Catálogo de empresas — o que o assistente mostra na etapa 1.
   *
   * Duas consultas em vez de `SQL_CALC_FOUND_ROWS`: a contagem é uma
   * pergunta diferente da página, e emendar as duas numa só amarra a
   * paginação a um recurso do motor que o driver expõe de forma
   * inconsistente. O custo é uma ida a mais a um banco read-only.
   */
  public async readClients(query: HelpdeskCatalogQuery): Promise<HelpdeskCatalogPage<HelpdeskClientRecord>> {
    const pagina = buildClientsCatalogQuery(this.registryDatabase, query);
    const contagem = buildClientsCatalogCountQuery(this.registryDatabase, { q: query.q });

    const rows = await this.select<ClientRow>(pagina.sql, pagina.params);
    const totais = await this.select<{ total: number | string }>(contagem.sql, contagem.params);

    return {
      items: rows.map(toClient),
      total: Number(totais[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset
    };
  }

  /** Usuários de UMA empresa — todos os papéis, pelo motivo em `HelpdeskCatalogPort`. */
  public async readUsersByClientId(clientId: number): Promise<readonly HelpdeskUserRecord[]> {
    const { sql, params } = buildUsersByClientIdQuery(this.helpdeskDatabase, clientId);
    const rows = await this.selectUsuarios(sql, params);
    return rows.map(toUser);
  }

  /**
   * Único ponto por onde a leitura de USUÁRIOS passa — e o único que
   * traduz falha de acesso em recusa de domínio.
   *
   * Existe separado de `select` porque só a fonte de usuários tem um
   * erro de domínio próprio para "não consegui perguntar". Uma falha
   * equivalente lendo empresas continua subindo crua: ela não tem
   * significado de negócio, e inventar um esconderia um defeito.
   */
  private async selectUsuarios(sql: string, params: readonly unknown[]): Promise<readonly UserRow[]> {
    try {
      return await this.select<UserRow>(sql, params);
    } catch (erro) {
      if (ehFonteInalcancavel(erro)) {
        throw new HelpdeskUserSourceUnavailableError();
      }
      throw erro;
    }
  }

  /** Único ponto de execução da classe — e ele revalida o SQL. */
  private async select<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    assertReadOnlySourceQuery(sql);
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }
}

/**
 * Códigos de erro do MariaDB que significam "a fonte não pôde ser
 * consultada" — privilégio negado, ou o objeto não existe.
 *
 * A lista é FECHADA por decisão. O oposto — tratar qualquer exceção
 * como indisponibilidade — transformaria todo defeito de programação
 * num 503 tranquilizador: um `ER_PARSE_ERROR` (1064) é SQL que nós
 * montamos errado, e responder "a origem está indisponível" mandaria
 * quem opera investigar o Helpdesk por um bug nosso. Erro que não está
 * aqui sobe cru e vira 500, que é a resposta honesta para "isto não
 * deveria ter acontecido".
 */
const CODIGOS_DE_FONTE_INALCANCAVEL: ReadonlySet<number> = new Set([
  1044, // ER_DBACCESS_DENIED_ERROR   — sem acesso ao schema
  1045, // ER_ACCESS_DENIED_ERROR     — credencial recusada
  1049, // ER_BAD_DB_ERROR            — schema inexistente
  1054, // ER_BAD_FIELD_ERROR         — coluna do contrato sumiu da origem
  1142, // ER_TABLEACCESS_DENIED_ERROR
  1143, // ER_COLUMNACCESS_DENIED_ERROR
  1146 // ER_NO_SUCH_TABLE            — a tabela não existe (mais)
]);

/**
 * Falhas de TRANSPORTE. Aqui o driver não chega a receber um errno do
 * servidor, então a identificação é pelo `code` textual do Node/mysql2.
 *
 * `PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR` está deliberadamente FORA. Não
 * por não ser transporte — é —, mas porque o nome contém a palavra
 * "queue", e a auditoria estrutural desta fatia
 * (`HelpdeskPilotAuthorizationAudit`) recusa qualquer menção a fila no
 * código deste arquivo. Enfraquecer aquela trava, ou disfarçar a string
 * para escapar dela, custaria mais do que o caso cobre: ele é o erro
 * SEGUINTE numa conexão já morta, e a primeira falha — a que importa —
 * já cai em `PROTOCOL_CONNECTION_LOST` ou num dos `E*` acima.
 */
const CODIGOS_DE_TRANSPORTE: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT"
]);

/**
 * `ForbiddenSourceQueryError` NUNCA entra aqui, e não por omissão: ela
 * é lançada antes de a conexão ser tocada, por `assertReadOnlySourceQuery`.
 * Se um dia passasse a chegar, seria a guarda pegando SQL que este
 * arquivo montou — defeito nosso, e traduzi-lo em "fonte indisponível"
 * apagaria exatamente o sinal que faz a guarda valer a pena.
 */
function ehFonteInalcancavel(erro: unknown): boolean {
  if (erro === null || typeof erro !== "object") {
    return false;
  }
  const candidato = erro as { readonly errno?: unknown; readonly code?: unknown };
  if (typeof candidato.errno === "number" && CODIGOS_DE_FONTE_INALCANCAVEL.has(candidato.errno)) {
    return true;
  }
  return typeof candidato.code === "string" && CODIGOS_DE_TRANSPORTE.has(candidato.code);
}

/**
 * `tinyint(1)` chega do driver como número e `client_id` chega como
 * `null` quando o usuário não tem empresa — os dois são convertidos
 * aqui, na fronteira, para que o domínio nunca receba `1` e precise
 * lembrar o que significa, nem confunda "sem empresa" com zero.
 */
function toUser(row: UserRow): HelpdeskUserRecord {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    active: toBoolean(row.active),
    clientId: row.client_id === null || row.client_id === undefined ? null : Number(row.client_id)
  };
}

/**
 * Documento utilizável, ou `null`. Nunca um valor "quase".
 *
 * Três recusas, e todas produzem o MESMO `null` de propósito — o
 * consumidor não tem decisão diferente a tomar entre elas:
 *
 *  - `tipo_doc` diferente de `cnpj`: a coluna guarda CPF na mesma
 *    string. Aceitar um CPF aqui o ofereceria à correspondência
 *    automática com o Portal, que casa empresas — uma pessoa física
 *    entraria como candidata a empresa;
 *  - documento ausente ou vazio;
 *  - documento que, sem máscara, não tem exatamente 14 dígitos. O
 *    cadastro é `varchar(18)` e aceita máscara; 13 ou 15 dígitos é dado
 *    corrompido, e completar ou truncar seria inventar o CNPJ de
 *    alguém.
 */
function normalizarDocumento(tipoDoc: string | null, documento: string | null): string | null {
  if (tipoDoc?.trim().toLowerCase() !== "cnpj") {
    return null;
  }
  const digitos = (documento ?? "").replace(/\D/g, "");
  return digitos.length === 14 ? digitos : null;
}

function toClient(row: ClientRow): HelpdeskClientRecord {
  return {
    id: Number(row.id),
    name: row.nome,
    active: toBoolean(row.ativo),
    documentNumber: normalizarDocumento(row.tipo_doc, row.documento)
  };
}

function toBoolean(value: number | boolean | null): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value === 1;
}
