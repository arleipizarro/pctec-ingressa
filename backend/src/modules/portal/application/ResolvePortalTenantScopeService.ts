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
 * **Boundary estrito, mesmo princípio de `GetPortalContextService` e
 * `GetActiveOrganizationExternalReferenceService`: este service NÃO faz
 * autorização.** Quando ele executa, o chamador já provou (a) que a
 * Identity tem `ApplicationAccess(PCTEC_PORTAL, USER)`
 * (`AuthorizeApplicationAccessService`) e (b) que
 * `organizationPublicId` pertence ao `PortalContext` efetivo dela
 * (`RequireOrganizationAccessService`). Ele nunca recebe nem consulta
 * `identityPublicId` — não tem como, e não deveria.
 *
 * Fluxo:
 * 1. Carrega a `Organization` selecionada. Se não existir ou não estiver
 *    `ACTIVE`, falha com `OrganizationAccessDeniedError` (403) — nunca
 *    404, nunca uma mensagem diferenciada (defesa em profundidade: o
 *    boundary anterior já deveria ter barrado, e a resposta externa é a
 *    mesma nos dois casos).
 * 2. `COMPANY` → o escopo é a própria Organization; resolve a referência
 *    `PCTEC_PORTAL/clientes` dela.
 * 3. `BUSINESS_GROUP` → expande nas `COMPANY` filhas pelas relações
 *    canônicas (`OrganizationRelationship`, mesma fonte de verdade já
 *    usada por `GetPortalContextService`), mantém só as `ACTIVE` e
 *    resolve a referência `PCTEC_PORTAL/clientes` de CADA uma.
 *
 * **Fail-closed absoluto (decisão desta entrega): se uma filha `ACTIVE`
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
 * **Organization `INACTIVE` nunca entra no escopo** — nem a selecionada
 * (passo 1), nem uma filha (passo 3, que a ignora silenciosamente: uma
 * empresa desativada saiu do grupo, não é uma referência faltando).
 *
 * **Deduplicação por `publicId`** — um `Map` garante que a mesma
 * `COMPANY` nunca aparece duas vezes, mesmo que as relações canônicas
 * a alcancem mais de uma vez.
 *
 * **Grupo sem nenhuma filha `ACTIVE` retorna `organizations: []`** — é
 * um estado legítimo (grupo cadastrado antes das empresas), não um
 * erro. Quem consome decide o que fazer; o Portal trata como
 * fail-closed (nenhum `clienteId` ⇒ nenhuma query comercial).
 */
export class ResolvePortalTenantScopeService {
  public constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationRelationshipRepository: OrganizationRelationshipRepository,
    private readonly getActiveOrganizationExternalReferenceService: GetActiveOrganizationExternalReferenceService
  ) {}

  public async execute(rawOrganizationPublicId: string): Promise<PortalTenantScopeResult> {
    const selectedPublicId = OrganizationPublicId.fromString(rawOrganizationPublicId);
    const selected = await this.organizationRepository.findByPublicId(selectedPublicId);
    if (selected === undefined || !selected.isActive()) {
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

    // BUSINESS_GROUP — consolida as COMPANY filhas ACTIVE.
    const organizationsByPublicId = new Map<string, PortalTenantScopeOrganization>();
    const childRelationships =
      await this.organizationRelationshipRepository.findChildrenByParentPublicId(selectedPublicId);

    for (const relationship of childRelationships) {
      const child = await this.organizationRepository.findByPublicId(relationship.getChildOrganizationPublicId());
      if (child === undefined || !child.isActive()) {
        // Empresa removida/desativada — saiu do grupo. Nunca é
        // "referência faltando"; nunca falha a consolidação.
        continue;
      }
      const childPublicId = child.getPublicId().toString();
      if (organizationsByPublicId.has(childPublicId)) {
        continue;
      }
      // Fail-closed: uma filha ACTIVE sem referência comercial ACTIVE
      // interrompe a consolidação inteira (ver nota de classe).
      organizationsByPublicId.set(childPublicId, await this.resolveOrganization(child));
    }

    return { selection, organizations: [...organizationsByPublicId.values()] };
  }

  /**
   * Resolve a referência `PCTEC_PORTAL/clientes` `ACTIVE` de uma
   * Organization já confirmada `ACTIVE`. Reaproveita
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
