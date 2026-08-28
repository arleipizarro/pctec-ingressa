import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  HelpdeskClientDocumentRead,
  HelpdeskClientRecord,
  HelpdeskSourceReader,
  HelpdeskUserRecord
} from "../../domain/pilot/HelpdeskSourcePort.js";
import type {
  HelpdeskCatalogPage,
  HelpdeskCatalogQuery,
  HelpdeskCatalogReader
} from "../../domain/wizard/HelpdeskCatalogPort.js";
import {
  assertReadOnlySourceQuery,
  buildClientByIdQuery,
  buildClientDocumentQuery,
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
  readonly name: string;
  readonly active: number | boolean | null;
}

/**
 * Conector READ-ONLY do Helpdesk.
 *
 * Três camadas independentes impedem escrita, e nenhuma delas confia nas
 * outras:
 *
 *  1. O principal MariaDB tem SELECT de COLUNA em `users` e `clients`.
 *     Não há INSERT/UPDATE/DELETE para conceder, nem `SELECT *` que
 *     funcione.
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
  public constructor(private readonly connection: Queryable) {}

  public async readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    const { sql, params } = buildUsersByIdsQuery(ids);
    const rows = await this.select<UserRow>(sql, params);
    return rows.map(toUser);
  }

  public async readClientById(clientId: number): Promise<HelpdeskClientRecord | undefined> {
    const { sql, params } = buildClientByIdQuery(clientId);
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
    const pagina = buildClientsCatalogQuery(query);
    const contagem = buildClientsCatalogCountQuery({ q: query.q });

    const rows = await this.select<ClientRow>(pagina.sql, pagina.params);
    const totais = await this.select<{ total: number | string }>(contagem.sql, contagem.params);

    return {
      items: rows.map(toClient),
      total: Number(totais[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset
    };
  }

  /**
   * CNPJ da empresa de origem — ou a admissão de que a fonte não o
   * fornece.
   *
   * A negativa de privilégio de COLUNA (`ERROR 1143`) é tratada como
   * resposta, não como falha, e é a única exceção que este conector
   * engole. O motivo é preciso: hoje o principal read-only tem SELECT
   * em `(id, name, active)` de `clients`, então pedir `cnpj` responde
   * 1143 em DEV e em PRD. Deixar esse erro subir faria o APPLY inteiro
   * do assistente falhar por causa de um campo opcional que a operação
   * nunca teve.
   *
   * `1054` (coluna inexistente) recebe o mesmo tratamento pelo mesmo
   * motivo: nas duas situações a resposta correta é "esta fonte não
   * fornece CNPJ", e o efeito prático é idêntico — a organização é
   * criada sem documento e o vínculo com o Portal fica pendente de
   * seleção administrativa.
   *
   * **Qualquer outro erro sobe.** Conexão recusada, timeout ou tabela
   * ausente não são "a fonte não fornece": são falhas, e mascará-las
   * transformaria um problema de infraestrutura numa importação
   * silenciosamente incompleta.
   */
  public async readClientDocument(clientId: number): Promise<HelpdeskClientDocumentRead> {
    const { sql, params } = buildClientDocumentQuery(clientId);
    try {
      const rows = await this.select<{ id: number; cnpj: string | null }>(sql, params);
      const row = rows[0];
      return { available: true, documentNumber: row?.cnpj ?? null };
    } catch (erro) {
      if (ehNegativaDeColuna(erro)) {
        return { available: false };
      }
      throw erro;
    }
  }

  public async readUsersByClientId(clientId: number): Promise<readonly HelpdeskUserRecord[]> {
    const { sql, params } = buildUsersByClientIdQuery(clientId);
    const rows = await this.select<UserRow>(sql, params);
    return rows.map(toUser);
  }

  /** Único ponto de execução da classe — e ele revalida o SQL. */
  private async select<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    assertReadOnlySourceQuery(sql);
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }
}

function toUser(row: UserRow): HelpdeskUserRecord {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    active: toBoolean(row.active),
    clientId: row.client_id === null ? null : Number(row.client_id)
  };
}

function toClient(row: ClientRow): HelpdeskClientRecord {
  return { id: Number(row.id), name: row.name, active: toBoolean(row.active) };
}

function toBoolean(value: number | boolean | null): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value === 1;
}

/**
 * Erros do driver que significam "esta credencial não enxerga a
 * coluna".
 *
 * `1143` = `ER_COLUMNACCESS_DENIED_ERROR` (privilégio de coluna);
 * `1054` = `ER_BAD_FIELD_ERROR` (coluna inexistente). Comparados por
 * NÚMERO, não pela mensagem: a mensagem muda com locale e versão do
 * servidor, e ela carrega o nome do usuário de banco — nada que se
 * queira dentro de um `includes()`.
 */
function ehNegativaDeColuna(erro: unknown): boolean {
  const errno = (erro as { errno?: unknown } | null)?.errno;
  return errno === 1143 || errno === 1054;
}
