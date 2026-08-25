import type { HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";
import type { HelpdeskCatalogPage, HelpdeskCatalogReader } from "../domain/wizard/HelpdeskCatalogPort.js";
import {
  WIZARD_CATALOG_DEFAULT_LIMIT,
  WIZARD_CATALOG_MAX_LIMIT,
  WIZARD_SOURCE_EXTERNAL_ROLE
} from "../domain/wizard/HelpdeskImportScope.js";

export interface CatalogCompanyLink {
  readonly organizationPublicId: string;
  readonly legalName: string;
  readonly type: string;
  readonly status: string;
}

export interface CatalogIdentityLink {
  readonly identityPublicId: string;
  readonly fullName: string;
  readonly status: string;
}

/**
 * Lado do DESTINO do catálogo: "isto já foi importado?".
 *
 * Separado do leitor de estado do plano porque a pergunta é outra. O
 * plano pergunta "o que existe para estes ids que vou decidir agora"; o
 * catálogo pergunta "quais destes ids a tela deve marcar como já
 * resolvidos", sobre uma página inteira, antes de qualquer decisão.
 */
export interface WizardCatalogTargetReader {
  findOrganizationsBySourceClientIds(ids: readonly number[]): Promise<ReadonlyMap<number, CatalogCompanyLink>>;
  findIdentitiesBySourceUserIds(ids: readonly number[]): Promise<ReadonlyMap<number, CatalogIdentityLink>>;
}

export interface CatalogCompany {
  readonly sourceClientId: number;
  readonly name: string;
  readonly active: boolean;
  /** Organization já vinculada por ExternalReference ativa, se houver. */
  readonly linkedOrganization: CatalogCompanyLink | null;
}

/**
 * Por que este usuário NÃO é importável — vazio quando ele é.
 *
 * A lista é calculada aqui, sobre o registro de origem, e serve para a
 * tela poder desmarcar e explicar antes do dry-run. Ela NÃO é a
 * decisão: quem decide é o planner, no backend, e é a decisão dele que
 * vira item de lote. Se as duas divergirem, vale a do planner — e a
 * divergência aparece no relatório, que é onde ela tem que aparecer.
 */
export type CatalogIneligibilityReason =
  | "SOURCE_USER_INACTIVE"
  | "SOURCE_USER_NOT_EXTERNAL_ROLE"
  | "SOURCE_USER_WITHOUT_CLIENT_LINK"
  | "SOURCE_EMAIL_INVALID";

export interface CatalogUser {
  readonly sourceUserId: number;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly sourceClientId: number | null;
  readonly eligible: boolean;
  readonly ineligibilityReasons: readonly CatalogIneligibilityReason[];
  /** Identity já vinculada por IdentityExternalReference ativa. */
  readonly linkedIdentity: CatalogIdentityLink | null;
  /** Sugestão de marcação inicial da tela — nunca uma autorização. */
  readonly suggestedSelected: boolean;
}

export interface CatalogUsersResult {
  readonly sourceClientId: number;
  readonly items: readonly CatalogUser[];
  readonly total: number;
  readonly eligibleTotal: number;
  readonly alreadyImportedTotal: number;
}

export function normalizeCatalogPaging(limit: unknown, offset: unknown): { limit: number; offset: number } {
  const bruto = Number(limit);
  const inicio = Number(offset);
  return {
    limit: Number.isInteger(bruto) && bruto > 0 ? Math.min(bruto, WIZARD_CATALOG_MAX_LIMIT) : WIZARD_CATALOG_DEFAULT_LIMIT,
    offset: Number.isInteger(inicio) && inicio > 0 ? inicio : 0
  };
}

/**
 * Catálogo read-only do Helpdesk para o assistente.
 *
 * Só vínculo cadastral: empresa (`clients`) e usuário externo
 * (`users.client_id`). Não consulta chamado, fila, equipe, histórico de
 * atendimento nem qualquer campo de autenticação — as travas que
 * garantem isso são o grant de COLUNA do principal read-only e
 * `assertReadOnlySourceQuery`, e nenhuma das duas confia na outra.
 *
 * Grupo empresarial não aparece aqui, e a ausência é conclusão
 * verificada: o cadastro de grupo não é tabela do Helpdesk (vive em
 * `pctecdb`, banco do HUB) e `users.client_group_id` não está no grant.
 * Ver `HelpdeskCatalogPort` para o raciocínio completo.
 */
export class GetHelpdeskCatalogService {
  public constructor(
    private readonly source: HelpdeskCatalogReader,
    private readonly targetReader: WizardCatalogTargetReader
  ) {}

  public async listCompanies(query: {
    readonly q?: unknown;
    readonly limit?: unknown;
    readonly offset?: unknown;
  }): Promise<HelpdeskCatalogPage<CatalogCompany>> {
    const { limit, offset } = normalizeCatalogPaging(query.limit, query.offset);
    const busca = typeof query.q === "string" ? query.q : undefined;

    const pagina = await this.source.readClients({ q: busca, limit, offset });
    const vinculos = await this.targetReader.findOrganizationsBySourceClientIds(pagina.items.map((c) => c.id));

    return {
      items: pagina.items.map((cliente) => ({
        sourceClientId: cliente.id,
        name: cliente.name,
        active: cliente.active,
        linkedOrganization: vinculos.get(cliente.id) ?? null
      })),
      total: pagina.total,
      limit: pagina.limit,
      offset: pagina.offset
    };
  }

  public async listUsers(sourceClientId: number): Promise<CatalogUsersResult> {
    const usuarios = await this.source.readUsersByClientId(sourceClientId);
    const vinculos = await this.targetReader.findIdentitiesBySourceUserIds(usuarios.map((u) => u.id));

    const items = usuarios.map((usuario) => {
      const motivos = motivosDeInelegibilidade(usuario);
      const vinculo = vinculos.get(usuario.id) ?? null;
      return {
        sourceUserId: usuario.id,
        name: usuario.name,
        email: usuario.email,
        role: usuario.role,
        active: usuario.active,
        sourceClientId: usuario.clientId,
        eligible: motivos.length === 0,
        ineligibilityReasons: motivos,
        linkedIdentity: vinculo,
        // Já importado continua sugerido: reexecutar sobre ele produz
        // SKIP, e SKIP registrado é a prova de que o assistente olhou e
        // não duplicou. Desmarcar por padrão esconderia essa prova.
        suggestedSelected: motivos.length === 0
      };
    });

    return {
      sourceClientId,
      items,
      total: items.length,
      eligibleTotal: items.filter((i) => i.eligible).length,
      alreadyImportedTotal: items.filter((i) => i.linkedIdentity !== null).length
    };
  }
}

function motivosDeInelegibilidade(user: HelpdeskUserRecord): readonly CatalogIneligibilityReason[] {
  const motivos: CatalogIneligibilityReason[] = [];
  if (!user.active) {
    motivos.push("SOURCE_USER_INACTIVE");
  }
  if (user.role !== WIZARD_SOURCE_EXTERNAL_ROLE) {
    motivos.push("SOURCE_USER_NOT_EXTERNAL_ROLE");
  }
  if (user.clientId === null) {
    motivos.push("SOURCE_USER_WITHOUT_CLIENT_LINK");
  }
  const email = (user.email ?? "").trim();
  if (email.length === 0 || !email.includes("@")) {
    motivos.push("SOURCE_EMAIL_INVALID");
  }
  return motivos;
}
