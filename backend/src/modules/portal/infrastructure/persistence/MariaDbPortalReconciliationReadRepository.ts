import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  PortalReconciliationCandidate,
  PortalReconciliationCandidatePage,
  PortalReconciliationReader
} from "../../domain/PortalReconciliationPort.js";
import {
  PORTAL_REFERENCE_ENTITY_TYPE,
  PORTAL_REFERENCE_SYSTEM_CODE
} from "../../../organization/domain/value-objects/PortalReferenceCodes.js";

type Linha = Record<string, unknown>;

/**
 * Projeção de LEITURA das candidatas à reconciliação — banco do
 * INGRESSA, não do Portal.
 *
 * Somente SELECT, parametrizado e paginado. Não replica regra: quem
 * classifica EXACT_UNIQUE/NOT_FOUND/AMBIGUOUS continua sendo o serviço
 * de correspondência; aqui só se responde "quais empresas existem e
 * quantos vínculos cada uma já tem".
 *
 * A contagem de referências ACTIVE vem por subconsulta correlacionada,
 * e não por `JOIN` + `GROUP BY`, porque a pergunta é por organização e
 * o `JOIN` de uma empresa com cadastro ambíguo multiplicaria a linha
 * dela na página — a organização apareceria duas vezes numa lista que
 * o ADMIN usa para contar.
 */
export class MariaDbPortalReconciliationReadRepository implements PortalReconciliationReader {
  public constructor(private readonly connection: Queryable) {}

  public async listCandidates(query: {
    readonly limit: number;
    readonly offset: number;
  }): Promise<PortalReconciliationCandidatePage> {
    const total = await this.contar(
      `SELECT COUNT(*) AS total FROM organizations WHERE type = 'COMPANY' AND status = 'ACTIVE'`,
      []
    );
    const linhas = await this.select(
      `${SELECT_CANDIDATAS}
        WHERE o.type = 'COMPANY' AND o.status = 'ACTIVE'
        ORDER BY o.legal_name, o.public_id
        LIMIT ? OFFSET ?`,
      [PORTAL_REFERENCE_SYSTEM_CODE, PORTAL_REFERENCE_ENTITY_TYPE, query.limit, query.offset]
    );
    return { items: linhas.map(toCandidate), total, limit: query.limit, offset: query.offset };
  }

  public async findCandidates(
    organizationPublicIds: readonly string[]
  ): Promise<readonly PortalReconciliationCandidate[]> {
    if (organizationPublicIds.length === 0) {
      return [];
    }
    const placeholders = organizationPublicIds.map(() => "?").join(", ");
    const linhas = await this.select(
      `${SELECT_CANDIDATAS}
        WHERE o.type = 'COMPANY' AND o.status = 'ACTIVE' AND o.public_id IN (${placeholders})
        ORDER BY o.legal_name, o.public_id`,
      [PORTAL_REFERENCE_SYSTEM_CODE, PORTAL_REFERENCE_ENTITY_TYPE, ...organizationPublicIds]
    );
    return linhas.map(toCandidate);
  }

  private async select(sql: string, params: readonly unknown[]): Promise<readonly Linha[]> {
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly Linha[];
  }

  private async contar(sql: string, params: readonly unknown[]): Promise<number> {
    const linhas = await this.select(sql, params);
    return Number((linhas[0] as { total?: unknown } | undefined)?.total ?? 0);
  }
}

const SELECT_CANDIDATAS = `
  SELECT o.public_id, o.legal_name, o.trade_name, o.document_number,
         (SELECT COUNT(*)
            FROM organization_external_references r
           WHERE r.organization_public_id = o.public_id
             AND r.system_code = ?
             AND r.entity_type = ?
             AND r.status = 'ACTIVE') AS active_portal_references
    FROM organizations o`;

function toCandidate(linha: Linha): PortalReconciliationCandidate {
  const opcional = (coluna: string): string | null => {
    const valor = linha[coluna];
    return valor === null || valor === undefined ? null : String(valor);
  };
  return {
    organizationPublicId: String(linha["public_id"]),
    legalName: String(linha["legal_name"]),
    tradeName: opcional("trade_name"),
    documentNumber: opcional("document_number"),
    activePortalReferences: Number(linha["active_portal_references"] ?? 0)
  };
}
