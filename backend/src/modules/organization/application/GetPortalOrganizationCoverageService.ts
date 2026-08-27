import type { Organization } from "../domain/Organization.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../domain/OrganizationRelationshipRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import {
  PORTAL_REFERENCE_ENTITY_TYPE,
  PORTAL_REFERENCE_SYSTEM_CODE
} from "../domain/value-objects/PortalReferenceCodes.js";

/**
 * Quantas empresas sem referência a consulta descreve nominalmente.
 *
 * A CONTAGEM é sempre exata; o que este limite corta é a lista. Um grupo
 * com dezenas de empresas pendentes produziria um payload que a tela não
 * usa — e cortar em silêncio faria "3 empresas faltando" parecer a
 * verdade quando faltam 40. Por isso o resultado carrega
 * `missingCompaniesTruncated`: quem lê sabe que a lista é um recorte.
 */
const LIMITE_DE_EMPRESAS_LISTADAS = 50;

/** A referência `PCTEC_PORTAL`/`clientes` ACTIVE de uma COMPANY. */
export interface PortalReferenceView {
  /** `public_id` da própria referência — identificador técnico, não o da organização. */
  readonly publicId: string;
  /**
   * `clientes.id` do Portal legado.
   *
   * Exposto SÓ no contorno administrativo (todo `/api/v1/admin` está
   * atrás de `ApplicationAccess(PCTEC_INGRESSA, ADMIN)`), porque é
   * exatamente o dado que o ADMIN precisa conferir para saber se
   * vinculou a empresa certa. `LegacyId` continua não sendo contrato
   * externo em nenhuma rota browser-facing de produto.
   */
  readonly legacyId: number;
  readonly status: string;
}

/** Empresa do grupo, identificada só por publicId e nomes organizacionais. */
export interface PortalCoverageCompanyView {
  readonly publicId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
}

export interface PortalGroupCoverageView {
  readonly totalActiveCompanies: number;
  readonly linkedCompanies: number;
  readonly missingCompaniesCount: number;
  readonly missingCompanies: readonly PortalCoverageCompanyView[];
  /** `true` quando a lista acima é um recorte de `missingCompaniesCount`. */
  readonly missingCompaniesTruncated: boolean;
}

export interface PortalOrganizationCoverage {
  readonly organizationPublicId: string;
  readonly organizationType: string;
  readonly organizationStatus: string;
  readonly systemCode: string;
  readonly entityType: string;
  /**
   * COMPANY: existe referência ACTIVE.
   * BUSINESS_GROUP: existe ao menos uma empresa filha ACTIVE **e** todas
   * elas estão vinculadas.
   *
   * Grupo sem nenhuma empresa ativa é `false` de propósito: não há nada
   * que o Portal consiga resolver, e chamar isso de "coberto" produziria
   * um usuário com acesso a um consolidado vazio.
   */
  readonly covered: boolean;
  /** COMPANY apenas. Sempre `null` em BUSINESS_GROUP — grupo não tem referência própria. */
  readonly reference: PortalReferenceView | null;
  /** BUSINESS_GROUP apenas. Sempre `null` em COMPANY. */
  readonly group: PortalGroupCoverageView | null;
}

/**
 * Caso de uso: descrever a COBERTURA PORTAL de uma organização —
 * "esta empresa está vinculada?", "este grupo está inteiro?".
 *
 * É consulta pura: nenhuma escrita, nenhuma referência criada ou
 * sugerida, nenhum SQL próprio. Toda leitura passa pelos repositórios
 * oficiais do domínio, na mesma composição que
 * `ResolvePortalTenantScopeService` já usa para expandir um grupo
 * (relações canônicas → organização de cada filha → referência de cada
 * filha). Uma projeção SQL nova seria uma segunda definição de "coberto",
 * e as duas divergiriam.
 *
 * **Diferença deliberada em relação a `ResolvePortalTenantScopeService`:**
 * lá, uma filha sem referência derruba a requisição inteira, porque o
 * resultado é um total financeiro que alguém vai ler como verdade. Aqui
 * a ausência é justamente o que se quer VER — o serviço existe para
 * apontar o que falta, então nada falha por falta de vínculo.
 *
 * **Não faz autorização.** Quem chama já passou pelo contorno
 * administrativo (`requireAuthenticatedSession` →
 * `requireApplicationAccess(PCTEC_INGRESSA, ADMIN)`), mesmo boundary
 * estrito dos demais serviços de consulta.
 *
 * Custo: 1 consulta para COMPANY (mais 1 da referência); num grupo, 1
 * pelas relações e 2 por filha. É o mesmo N+1 já aceito pelo escopo
 * comercial do Portal, sobre a mesma ordem de grandeza (um grupo real
 * tem unidades de empresas, não milhares).
 */
export class GetPortalOrganizationCoverageService {
  private readonly systemCode = SystemCode.create(PORTAL_REFERENCE_SYSTEM_CODE);
  private readonly entityType = EntityType.create(PORTAL_REFERENCE_ENTITY_TYPE);

  public constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationRelationshipRepository: OrganizationRelationshipRepository,
    private readonly organizationExternalReferenceRepository: OrganizationExternalReferenceRepository
  ) {}

  /** `undefined` quando a organização não existe — quem chama decide o 404. */
  public async execute(rawOrganizationPublicId: string): Promise<PortalOrganizationCoverage | undefined> {
    const organizationPublicId = PublicId.fromString(rawOrganizationPublicId);
    const organization = await this.organizationRepository.findByPublicId(organizationPublicId);
    if (organization === undefined) {
      return undefined;
    }

    const base = {
      organizationPublicId: organization.getPublicId().toString(),
      organizationType: organization.getType().toString(),
      organizationStatus: organization.getStatus(),
      systemCode: PORTAL_REFERENCE_SYSTEM_CODE,
      entityType: PORTAL_REFERENCE_ENTITY_TYPE
    };

    if (!organization.getType().isBusinessGroup()) {
      const reference = await this.buscarReferencia(organization.getPublicId());
      return { ...base, covered: reference !== null, reference, group: null };
    }

    // BUSINESS_GROUP — a cobertura é a das filhas, uma a uma.
    const relacoes = await this.organizationRelationshipRepository.findChildrenByParentPublicId(organizationPublicId);
    const vistas = new Set<string>();
    const faltantes: PortalCoverageCompanyView[] = [];
    let ativas = 0;
    let vinculadas = 0;

    for (const relacao of relacoes) {
      const childPublicId = relacao.getChildOrganizationPublicId();
      const chave = childPublicId.toString();
      if (vistas.has(chave)) {
        continue;
      }
      vistas.add(chave);

      const filha = await this.organizationRepository.findByPublicId(childPublicId);
      // Empresa removida ou desativada saiu do grupo: nunca conta como
      // faltando, nunca conta como coberta. Mesma leitura já feita pelo
      // escopo comercial do Portal.
      if (filha === undefined || !filha.isActive()) {
        continue;
      }
      ativas += 1;

      const reference = await this.buscarReferencia(childPublicId);
      if (reference !== null) {
        vinculadas += 1;
        continue;
      }
      faltantes.push({
        publicId: chave,
        legalName: filha.getLegalName().toString(),
        tradeName: filha.getTradeName()?.toString() ?? null
      });
    }

    const group: PortalGroupCoverageView = {
      totalActiveCompanies: ativas,
      linkedCompanies: vinculadas,
      missingCompaniesCount: faltantes.length,
      missingCompanies: faltantes.slice(0, LIMITE_DE_EMPRESAS_LISTADAS),
      missingCompaniesTruncated: faltantes.length > LIMITE_DE_EMPRESAS_LISTADAS
    };

    return { ...base, covered: ativas > 0 && faltantes.length === 0, reference: null, group };
  }

  private async buscarReferencia(organizationPublicId: PublicId): Promise<PortalReferenceView | null> {
    const referencia = await this.organizationExternalReferenceRepository
      .findActiveByOrganizationSystemCodeAndEntityType(organizationPublicId, this.systemCode, this.entityType);
    if (referencia === undefined) {
      return null;
    }
    return {
      publicId: referencia.getPublicId().toString(),
      legacyId: referencia.getLegacyId().toNumber(),
      status: referencia.getStatus()
    };
  }
}
