import type { Organization } from "../../organization/domain/Organization.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../../organization/domain/OrganizationRelationshipRepository.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { PublicId as OrganizationPublicId } from "../../organization/domain/value-objects/PublicId.js";
import { OrganizationAccessDeniedError } from "../domain/errors/PortalErrors.js";

/**
 * Sistema/entidade legados que definem o escopo comercial do Portal.
 *
 * `clientes` (nunca `clientes_grupo`) é a única entidade que produz
 * contexto comercial — decisão fechada no piloto AFIP e já aplicada em
 * P1A.1 (`servicePortalOrganizationExternalReferenceRoutes.ts`). Um
 * `BUSINESS_GROUP` NUNCA resolve para uma referência própria: ele é
 * expandido nas `COMPANY` filhas, e cada filha resolve a sua.
 */
const PORTAL_SYSTEM_CODE = "PCTEC_PORTAL";
const PORTAL_ENTITY_TYPE = "clientes";

/** Uma organização comercial concreta, já resolvida para o sistema legado. */
export interface PortalTenantScopeOrganization {
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | undefined;
  /**
   * `clientes.id` do Portal legado. É o ÚNICO identificador legado
   * exposto por esta rota, e existe porque é exatamente o dado que o
   * Portal precisa para escopar suas próprias queries — nunca um id
   * interno do Ingressa (`internalId`), nunca um `Membership`, nunca um
   * CNPJ.
   */
  readonly legacyId: number;
}

/** O que o usuário selecionou — COMPANY individual ou BUSINESS_GROUP consolidado. */
export interface PortalTenantScopeSelection {
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | undefined;
}

export interface PortalTenantScopeResult {
  readonly selection: PortalTenantScopeSelection;
  readonly organizations: readonly PortalTenantScopeOrganization[];
}

/**
 * Caso de uso: resolver o ESCOPO COMERCIAL de uma seleção do Portal —
 * P1D (v0.7.x), primeira peça a suportar seleção consolidada por
 * `BUSINESS_GROUP`.
 *
 * **Este service não CALCULA autorização — mas é obrigado a RESPEITÁ-LA.**
 * Ele recebe, como segundo parâmetro, o conjunto de
 * `Organization.publicId` que a Identity chamadora efetivamente alcança
 * (o `PortalContext` já calculado por `RequireOrganizationAccessService`,
 * que devolve exatamente esse contexto depois de autorizar). O service
 * nunca recomputa esse conjunto, nunca consulta `Membership`, nunca
 * recebe `identityPublicId` — e nunca vai além dele.
 *
 * **Por que o conjunto autorizado é obrigatório aqui (correção de
 * revisão, C-1):** provar que o `BUSINESS_GROUP` selecionado está no
 * `PortalContext` NÃO prova nada sobre as filhas dele.
 * `GetPortalContextService` só inclui as `COMPANY` descendentes quando
 * o `Membership` tem `scope = ORGANIZATION_AND_DESCENDANTS`; um
 * `Membership(BUSINESS_GROUP, ORGANIZATION_ONLY)` coloca o grupo no
 * contexto e nenhuma filha. Expandir as filhas canônicas sem cruzar com
 * o contexto transformaria esse Membership — cuja semântica é
 * "alcance limitado à própria Organization" (`MembershipScope`) — em
 * acesso comercial a todas as descendentes. Escalada de privilégio.
 * A relação canônica responde "quem são as filhas"; o `PortalContext`
 * responde "quais delas são suas". O escopo é a **interseção**.
 *
 * Fluxo:
 * 1. Carrega a `Organization` selecionada. Se não existir, não estiver
 *    `ACTIVE`, ou não estiver no conjunto autorizado, falha com
 *    `OrganizationAccessDeniedError` (403) — nunca 404, nunca uma
 *    mensagem diferenciada (a resposta externa é a mesma nos três
 *    casos).
 * 2. `COMPANY` → o escopo é a própria Organization; resolve a referência
 *    `PCTEC_PORTAL/clientes` dela.
 * 3. `BUSINESS_GROUP` → percorre as filhas pelas relações canônicas
 *    (`OrganizationRelationship`, mesma fonte de verdade já usada por
 *    `GetPortalContextService`), mantém só as que são `ACTIVE` **e**
 *    estão no conjunto autorizado, e resolve a referência
 *    `PCTEC_PORTAL/clientes` de CADA uma.
 *
 * **Filha fora do conjunto autorizado é ignorada ANTES de qualquer
 * resolução** — a referência dela nunca é consultada, e nem o seu
 * `legacyId` nem o seu nome chegam a existir no resultado. Uma filha
 * `INACTIVE` é ignorada pelo mesmo caminho (saiu do grupo).
 *
 * **Nenhuma filha autorizada restante ⇒ 403, nunca escopo vazio**
 * (correção de revisão): devolver `organizations: []` faria o chamador
 * distinguir "grupo existe, mas você não alcança nenhuma empresa" de
 * "grupo não é seu" — informação que ele não deve ter. E um escopo
 * vazio nunca é um estado comercial útil: não há o que consolidar.
 * Mesmo erro, mesmo status, mesma mensagem dos demais casos negados.
 *
 * **Fail-closed absoluto (mantido): se uma filha AUTORIZADA e `ACTIVE`
 * não possui referência comercial `ACTIVE`, a requisição INTEIRA falha**
 * com `ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND` (404), propagada por
 * `GetActiveOrganizationExternalReferenceService`. Nunca "consolida o
 * que der" — um total consolidado silenciosamente incompleto é pior que
 * um erro explícito: o usuário leria um faturamento menor que o real
 * sem nenhum sinal de que faltou uma empresa. Isto é deliberadamente
 * DIFERENTE da defesa em profundidade de `GetPortalContextService`
 * (que ignora Memberships problemáticos): lá o resultado é "o que você
 * enxerga"; aqui é "a soma que você vai ler como verdade".
 *
 * **Deduplicação por `publicId`** — um `Map` garante que a mesma
 * `COMPANY` nunca aparece duas vezes, mesmo que as relações canônicas
 * a alcancem mais de uma vez.
 */
export class ResolvePortalTenantScopeService {
  public constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationRelationshipRepository: OrganizationRelationshipRepository,
    private readonly getActiveOrganizationExternalReferenceService: GetActiveOrganizationExternalReferenceService
  ) {}

  /**
   * @param rawOrganizationPublicId A seleção do usuário.
   * @param authorizedOrganizationPublicIds `Organization.publicId` que a
   * Identity chamadora efetivamente alcança — o `PortalContext` já
   * calculado por `RequireOrganizationAccessService`. **Nunca** uma
   * lista fornecida pelo browser, nunca recomputada aqui.
   */
  public async execute(
    rawOrganizationPublicId: string,
    authorizedOrganizationPublicIds: ReadonlySet<string>
  ): Promise<PortalTenantScopeResult> {
    // Defesa em profundidade: o TypeScript já exige o conjunto, mas um
    // chamador em JS puro (ou um wiring futuro incompleto) que o
    // omitisse produziria um TypeError opaco em vez de uma negativa
    // clara. Mesmo princípio dos handlers de rota, que checam
    // parâmetros que o Express já deveria garantir.
    const autorizados =
      authorizedOrganizationPublicIds instanceof Set ? authorizedOrganizationPublicIds : new Set<string>();

    const selectedPublicId = OrganizationPublicId.fromString(rawOrganizationPublicId);
    const selected = await this.organizationRepository.findByPublicId(selectedPublicId);
    if (selected === undefined || !selected.isActive() || !autorizados.has(selected.getPublicId().toString())) {
      throw new OrganizationAccessDeniedError();
    }

    const selection: PortalTenantScopeSelection = {
      publicId: selected.getPublicId().toString(),
      type: selected.getType().toString(),
      legalName: selected.getLegalName().toString(),
      tradeName: selected.getTradeName()?.toString()
    };

    if (!selected.getType().isBusinessGroup()) {
      // COMPANY — escopo de uma única organização, o comportamento que
      // já existia em P1A.1. Mantido idêntico, inclusive nos erros.
      return {
        selection,
        organizations: [await this.resolveOrganization(selected)]
      };
    }

    // BUSINESS_GROUP — consolida a INTERSEÇÃO entre as filhas canônicas
    // ACTIVE e o PortalContext efetivo da Identity.
    const organizationsByPublicId = new Map<string, PortalTenantScopeOrganization>();
    const childRelationships =
      await this.organizationRelationshipRepository.findChildrenByParentPublicId(selectedPublicId);

    for (const relationship of childRelationships) {
      const childPublicId = relationship.getChildOrganizationPublicId().toString();
      if (!autorizados.has(childPublicId)) {
        // Filha canônica fora do PortalContext (ex.: Membership no grupo
        // com scope ORGANIZATION_ONLY). Nunca resolvida, nunca contada,
        // nunca mencionada no resultado.
        continue;
      }
      if (organizationsByPublicId.has(childPublicId)) {
        continue;
      }
      const child = await this.organizationRepository.findByPublicId(relationship.getChildOrganizationPublicId());
      if (child === undefined || !child.isActive()) {
        // Empresa removida/desativada — saiu do grupo. Nunca é
        // "referência faltando"; nunca falha a consolidação.
        continue;
      }
      // Fail-closed: uma filha autorizada e ACTIVE sem referência
      // comercial ACTIVE interrompe a consolidação inteira (nota de classe).
      organizationsByPublicId.set(childPublicId, await this.resolveOrganization(child));
    }

    if (organizationsByPublicId.size === 0) {
      // Nenhuma empresa autorizada no grupo — mesmo erro externo de
      // "esta seleção não é sua". Nunca escopo vazio (nota de classe).
      throw new OrganizationAccessDeniedError();
    }

    return { selection, organizations: [...organizationsByPublicId.values()] };
  }

  /**
   * Resolve a referência `PCTEC_PORTAL/clientes` `ACTIVE` de uma
   * Organization já confirmada `ACTIVE` e autorizada. Reaproveita
   * `GetActiveOrganizationExternalReferenceService` sem alteração — a
   * mesma peça já usada pela rota P1A.1, com o mesmo erro 404.
   */
  private async resolveOrganization(organization: Organization): Promise<PortalTenantScopeOrganization> {
    const publicId = organization.getPublicId().toString();
    const reference = await this.getActiveOrganizationExternalReferenceService.execute(
      publicId,
      PORTAL_SYSTEM_CODE,
      PORTAL_ENTITY_TYPE
    );
    return {
      publicId,
      type: organization.getType().toString(),
      legalName: organization.getLegalName().toString(),
      tradeName: organization.getTradeName()?.toString(),
      legacyId: reference.getLegacyId().toNumber()
    };
  }
}
