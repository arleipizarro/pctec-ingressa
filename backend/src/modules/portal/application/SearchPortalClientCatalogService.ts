import type { PortalClientCatalogReader, PortalClientRecord } from "../domain/PortalClientCatalogPort.js";
import { maskCnpj } from "../domain/value-objects/PortalDocument.js";

/** Limite pequeno de propósito: a tela escolhe UM cliente, não navega o cadastro do Portal. */
export const PORTAL_CATALOG_DEFAULT_LIMIT = 10;
export const PORTAL_CATALOG_MAX_LIMIT = 25;

/**
 * O que sai na resposta HTTP — e nada além disto.
 *
 * `documentMasked` é `**.***.678/0001-95`, nunca o documento inteiro:
 * a raiz identificadora fica escondida, e o que aparece é o suficiente
 * para o ADMIN distinguir duas filiais do mesmo grupo. `hasDocument`
 * existe para a tela poder dizer "este cliente não tem CNPJ cadastrado"
 * sem confundir com "tem, mas está escondido".
 */
export interface PortalClientCatalogItem {
  readonly legacyId: number;
  readonly name: string;
  readonly tradeName: string | null;
  readonly documentMasked: string | null;
  readonly hasDocument: boolean;
  readonly active: boolean;
}

export interface PortalClientCatalogPageView {
  readonly items: readonly PortalClientCatalogItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Busca administrativa no catálogo do Portal.
 *
 * É o que substitui "descobrir o `clientes.id` no SQL". O ADMIN busca
 * por nome ou por CNPJ, vê candidatos e **seleciona explicitamente** um
 * deles; a seleção vira uma segunda requisição, para a rota de vínculo
 * do PR anterior, com toda a proteção dela.
 *
 * **A busca não cria vínculo.** Nem quando devolve um único resultado:
 * um resultado só de uma busca textual continua sendo uma coincidência
 * de nome, e o desenho desta integração recusa nome como evidência. O
 * único caminho automático é o CNPJ exato e único, e ele passa pelo
 * `MatchPortalClientByDocumentService`.
 */
export class SearchPortalClientCatalogService {
  public constructor(private readonly catalog: PortalClientCatalogReader) {}

  public async execute(filtros: {
    readonly q?: unknown;
    readonly limit?: unknown;
    readonly offset?: unknown;
  }): Promise<PortalClientCatalogPageView> {
    const limit = normalizarLimite(filtros.limit);
    const offset = normalizarOffset(filtros.offset);
    const q = typeof filtros.q === "string" ? filtros.q.trim().slice(0, 120) : undefined;

    const pagina = await this.catalog.search({
      ...(q !== undefined && q.length > 0 ? { q } : {}),
      limit,
      offset
    });

    return {
      items: pagina.items.map(toCatalogItem),
      total: pagina.total,
      limit: pagina.limit,
      offset: pagina.offset
    };
  }
}

export function toCatalogItem(cliente: PortalClientRecord): PortalClientCatalogItem {
  return {
    legacyId: cliente.id,
    name: cliente.nome,
    tradeName: cliente.nomeFantasia,
    documentMasked: maskCnpj(cliente.documentDigits),
    hasDocument: cliente.documentDigits !== undefined,
    active: cliente.active
  };
}

function normalizarLimite(bruto: unknown): number {
  const numero = Number(bruto);
  if (!Number.isInteger(numero) || numero <= 0) {
    return PORTAL_CATALOG_DEFAULT_LIMIT;
  }
  return Math.min(numero, PORTAL_CATALOG_MAX_LIMIT);
}

function normalizarOffset(bruto: unknown): number {
  const numero = Number(bruto);
  return Number.isInteger(numero) && numero > 0 ? numero : 0;
}
