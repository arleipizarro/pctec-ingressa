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
  buildClientsCatalogQuery
} from "./HelpdeskSourceQueries.js";

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
 * Lê o REGISTRO AUTORITATIVO de empresas, no schema apontado por
 * `HELPDESK_REGISTRY_DB_NAME` — o mesmo de onde o próprio Helpdesk lê.
 * Não consulta a tabela local de empresas nem a de usuários: as duas
 * deixaram de ser autoridade, e a de usuários deixou de existir. Ver
 * `HelpdeskUserSourceUnavailableError`.
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
    /** Vem da configuração validada — nunca de constante no código. */
    private readonly registryDatabase: string
  ) {}

  /**
   * RECUSA — a fonte de usuários não está disponível.
   *
   * Não é uma lista vazia, e a diferença é o ponto inteiro desta fatia:
   * `[]` afirmaria que a origem foi consultada e não tem ninguém. Ver
   * `HelpdeskUserSourceUnavailableError` para o porquê de a recusa
   * morar aqui, na fronteira, e não em cada chamador.
   */
  public async readUsersByIds(_ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    throw new HelpdeskUserSourceUnavailableError();
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

  /** RECUSA, pelo mesmo motivo de `readUsersByIds`. */
  public async readUsersByClientId(_clientId: number): Promise<readonly HelpdeskUserRecord[]> {
    throw new HelpdeskUserSourceUnavailableError();
  }

  /** Único ponto de execução da classe — e ele revalida o SQL. */
  private async select<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    assertReadOnlySourceQuery(sql);
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }
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
