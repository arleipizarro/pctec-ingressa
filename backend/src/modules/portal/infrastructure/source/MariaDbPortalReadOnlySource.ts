import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  PortalClientCatalogReader,
  PortalClientPage,
  PortalClientRecord,
  PortalClientSearchQuery
} from "../../domain/PortalClientCatalogPort.js";
import { normalizePortalDocument } from "../../domain/value-objects/PortalDocument.js";
import {
  assertReadOnlyPortalQuery,
  buildClientByIdQuery,
  buildClientsByDocumentQuery,
  buildClientsSearchCountQuery,
  buildClientsSearchQuery
} from "./PortalSourceQueries.js";

interface ClienteRow {
  readonly id: number;
  readonly nome: string;
  readonly nome_fantasia: string | null;
  readonly tipo_doc: string | null;
  readonly documento: string | null;
  readonly ativo: number | boolean | null;
}

/**
 * Conector READ-ONLY do catálogo de clientes do Portal.
 *
 * Três camadas independentes impedem escrita, e nenhuma confia nas
 * outras:
 *
 *  1. a credencial de `portal-source.env` tem SELECT em
 *     `pctecdb.clientes` e nada mais — não há INSERT/UPDATE/DELETE para
 *     conceder;
 *  2. `assertReadOnlyPortalQuery` recusa qualquer SQL que não seja um
 *     SELECT único sobre a projeção permitida;
 *  3. esta classe não expõe método de escrita, e não existe um
 *     `execute` público por onde passar SQL arbitrário.
 *
 * A normalização do documento acontece na FRONTEIRA, aqui: o domínio
 * recebe `documentDigits` já reduzido a 14 dígitos, ou `undefined`. Um
 * cliente do Portal com documento vazio, com CPF ou com lixo no campo
 * simplesmente não é candidato — e isso não é erro, é a maior parte de
 * um cadastro comercial antigo.
 */
export class MariaDbPortalReadOnlySource implements PortalClientCatalogReader {
  public constructor(private readonly connection: Queryable) {}

  public async findByDocument(documentDigits: string): Promise<readonly PortalClientRecord[]> {
    const { sql, params } = buildClientsByDocumentQuery(documentDigits);
    const rows = await this.select<ClienteRow>(sql, params);
    return rows.map(toClient);
  }

  public async findById(clientId: number): Promise<PortalClientRecord | undefined> {
    const { sql, params } = buildClientByIdQuery(clientId);
    const rows = await this.select<ClienteRow>(sql, params);
    const row = rows[0];
    return row === undefined ? undefined : toClient(row);
  }

  /**
   * Duas consultas em vez de `SQL_CALC_FOUND_ROWS` — mesma decisão do
   * catálogo do Helpdesk: a contagem é uma pergunta diferente da
   * página, e emendar as duas amarra a paginação a um recurso do motor
   * que o driver expõe de forma inconsistente.
   */
  public async search(query: PortalClientSearchQuery): Promise<PortalClientPage> {
    const pagina = buildClientsSearchQuery(query);
    const contagem = buildClientsSearchCountQuery({ q: query.q });

    const rows = await this.select<ClienteRow>(pagina.sql, pagina.params);
    const totais = await this.select<{ total: number | string }>(contagem.sql, contagem.params);

    return {
      items: rows.map(toClient),
      total: Number(totais[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset
    };
  }

  /** Único ponto de execução da classe — e ele revalida o SQL. */
  private async select<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    assertReadOnlyPortalQuery(sql);
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }
}

function toClient(row: ClienteRow): PortalClientRecord {
  // `tipo_doc` é ENUM('CPF','CNPJ') e a coluna `documento` guarda os
  // dois. Um documento marcado como CPF nunca vira `documentDigits`,
  // mesmo que por acaso tivesse 14 dígitos: pessoa física não é
  // candidata a cliente-empresa do Portal.
  const documento = row.tipo_doc === "CPF" ? undefined : normalizePortalDocument(row.documento);
  return {
    id: Number(row.id),
    nome: row.nome,
    nomeFantasia: row.nome_fantasia === null || row.nome_fantasia === undefined ? null : String(row.nome_fantasia),
    documentDigits: documento,
    active: toBoolean(row.ativo)
  };
}

function toBoolean(value: number | boolean | null): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value === 1;
}
