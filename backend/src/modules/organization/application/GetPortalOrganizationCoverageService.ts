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
  /**
   * Empresas do grupo com MAIS DE UMA referência ACTIVE.
   *
   * Nem vinculadas nem faltando: ambíguas. Contá-las como vinculadas
   * daria o grupo por coberto apoiado num vínculo que ninguém escolheu;
   * contá-las como faltando mandaria o ADMIN criar mais uma.
   */
  readonly ambiguousCompaniesCount: number;
  readonly ambiguousCompanies: readonly PortalCoverageCompanyView[];
}

export interface PortalOrganizationCoverage {
  readonly organizationPublicId: string;
  readonly organizationType: string;
  readonly organizationStatus: string;
  readonly systemCode: string;
  readonly entityType: string;
  /**
   * COMPANY: existe EXATAMENTE uma referência ACTIVE.
   * BUSINESS_GROUP: existe ao menos uma empresa filha ACTIVE, todas
   * vinculadas, e nenhuma ambígua.
   *
   * Grupo sem nenhuma empresa ativa é `false` de propósito: não há nada
   * que o Portal consiga resolver, e chamar isso de "coberto" produziria
   * um usuário com acesso a um consolidado vazio.
   */
  readonly covered: boolean;
  /**
   * Mais de uma referência ACTIVE (na própria COMPANY, ou em alguma
   * empresa do grupo).
   *
   * Estado que o CLI genérico ainda alcança e que a UNIQUE KEY da
   * migration 0013 não impede — ela cobre
   * `(system_code, entity_type, legacy_id)`, não
   * `(organização, sistema, entidade)`. Quando `true`, `reference` é
   * `null`: escolher uma seria transformar um cadastro inconsistente
   * numa resposta que parece certa.
   */
  readonly ambiguous: boolean;
  /** Quantas referências ACTIVE a própria organização tem. Sempre 0 em grupo. */
  readonly activeReferenceCount: number;
  /**
   * COMPANY apenas, e só quando há EXATAMENTE uma. `null` em grupo
   * (que não tem referência própria) e `null` sob ambiguidade.
   */
  readonly reference: PortalReferenceView | null;
  /**
   * Todas as referências ACTIVE da COMPANY quando há mais de uma —
   * listadas, nunca eleitas. É o que o ADMIN precisa para decidir qual
   * encerrar pelo CLI. Vazio no caso normal.
   */
  readonly ambiguousReferences: readonly PortalReferenceView[];
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
      const referencias = await this.buscarReferencias(organization.getPublicId());
      if (referencias.length > 1) {
        // Nenhuma é "a" referência. Devolver uma delas é o que
        // `LIMIT 1` faria — e é exatamente o que esconde o problema.
        return {
          ...base,
          covered: false,
          ambiguous: true,
          activeReferenceCount: referencias.length,
          reference: null,
          ambiguousReferences: referencias,
          group: null
        };
      }
      return {
        ...base,
        covered: referencias.length === 1,
        ambiguous: false,
        activeReferenceCount: referencias.length,
        reference: referencias[0] ?? null,
        ambiguousReferences: [],
        group: null
      };
    }

    // BUSINESS_GROUP — a cobertura é a das filhas, uma a uma.
    const relacoes = await this.organizationRelationshipRepository.findChildrenByParentPublicId(organizationPublicId);
    const vistas = new Set<string>();
    const faltantes: PortalCoverageCompanyView[] = [];
    const ambiguas: PortalCoverageCompanyView[] = [];
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

      const identificacao: PortalCoverageCompanyView = {
        publicId: chave,
        legalName: filha.getLegalName().toString(),
        tradeName: filha.getTradeName()?.toString() ?? null
      };
      const referencias = await this.buscarReferencias(childPublicId);
      if (referencias.length > 1) {
        // Nem vinculada nem faltando. O grupo inteiro deixa de estar
        // coberto até alguém decidir qual referência vale.
        ambiguas.push(identificacao);
        continue;
      }
      if (referencias.length === 1) {
        vinculadas += 1;
        continue;
      }
      faltantes.push(identificacao);
    }

    const group: PortalGroupCoverageView = {
      totalActiveCompanies: ativas,
      linkedCompanies: vinculadas,
      missingCompaniesCount: faltantes.length,
      missingCompanies: faltantes.slice(0, LIMITE_DE_EMPRESAS_LISTADAS),
      missingCompaniesTruncated: faltantes.length > LIMITE_DE_EMPRESAS_LISTADAS,
      ambiguousCompaniesCount: ambiguas.length,
      ambiguousCompanies: ambiguas.slice(0, LIMITE_DE_EMPRESAS_LISTADAS)
    };

    return {
      ...base,
      covered: ativas > 0 && faltantes.length === 0 && ambiguas.length === 0,
      ambiguous: ambiguas.length > 0,
      // O GRUPO nunca tem referência própria — nem uma, nem várias.
      activeReferenceCount: 0,
      reference: null,
      ambiguousReferences: [],
      group
    };
  }

  /**
   * TODAS as referências ACTIVE da organização, sem `LIMIT 1`.
   *
   * Descobrir que há mais de uma é parte do trabalho: é a diferença
   * entre "esta empresa aponta para o cliente 71" e "esta empresa aponta
   * para dois clientes e ninguém decidiu qual".
   */
  private async buscarReferencias(organizationPublicId: PublicId): Promise<readonly PortalReferenceView[]> {
    const referencias = await this.organizationExternalReferenceRepository
      .findAllActiveByOrganizationSystemCodeAndEntityType(organizationPublicId, this.systemCode, this.entityType);
    return referencias.map((referencia) => ({
      publicId: referencia.getPublicId().toString(),
      legacyId: referencia.getLegacyId().toNumber(),
      status: referencia.getStatus()
    }));
  }
}
