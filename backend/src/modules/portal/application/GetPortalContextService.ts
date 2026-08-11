import type { MembershipRepository } from "../../organization/domain/MembershipRepository.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../../organization/domain/OrganizationRelationshipRepository.js";
import { PublicId as OrganizationPublicId } from "../../organization/domain/value-objects/PublicId.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";

export interface PortalOrganizationView {
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | undefined;
}

export interface PortalContextResult {
  readonly identityPublicId: string;
  readonly organizations: readonly PortalOrganizationView[];
}

/**
 * Caso de uso: resolver o `PortalContext` de uma Identity já
 * autenticada E já autorizada a usar `PCTEC_PORTAL` (ambos garantidos
 * pelo chamador — este service não reverifica sessão nem
 * `ApplicationAccess`, mesmo princípio de boundary estrito já usado por
 * `AuthorizeApplicationAccessService`).
 *
 * **Boundary formalizado (revisão pré-commit de G3): este service é
 * exclusivamente resolução de ESCOPO ORGANIZACIONAL — nunca prova de
 * acesso ao Portal.** `GetPortalContextService` NÃO consulta
 * `ApplicationAccess` em nenhum momento (só `MembershipRepository`/
 * `OrganizationRepository`/`OrganizationRelationshipRepository`) — ele
 * PRESSUPÕE que a autorização da Application já ocorreu antes de ser
 * chamado. Chamá-lo isoladamente, sem `requireApplicationAccess` já ter
 * rodado antes, **nunca deve ser considerado prova de que a Identity
 * pode usar o Portal** — só prova quais Organizations ela enxergaria,
 * SE tivesse acesso. O pipeline obrigatório, sempre nesta ordem, é:
 *
 * ```
 * requireAuthenticatedSession
 *   → requireApplicationAccess(PCTEC_PORTAL, USER)
 *   → GetPortalContextService
 *   → (eventualmente) RequireOrganizationAccessService
 * ```
 *
 * A única montagem real desta ordem, nesta entrega, é
 * `createApp.ts` (`app.use("/api/v1/portal", ...)`) — ver também
 * `requireOrganizationAccess.ts`, que formaliza a mesma exigência para
 * o próximo boundary da cadeia.
 *
 * Fluxo (design, ORGANIZATION-MEMBERSHIP-DESIGN.md §7):
 * 1. Carrega os `Membership`s `ACTIVE` da Identity —
 *    `Membership INACTIVE` nunca participa (task G3, seção 10).
 * 2. Para cada Membership, resolve a `Organization` referenciada.
 * 3. **Defesa em profundidade (decisão formal, task G3, seção 11 —
 *    preferência do Product Owner adotada):** se a `Organization` não
 *    existir ou não estiver `ACTIVE`, esse Membership específico é
 *    ignorado — nunca falha a requisição inteira; o contexto continua
 *    sendo resolvido com os demais Memberships válidos. Um Membership
 *    `ACTIVE` apontando para uma Organization `INACTIVE` NUNCA concede
 *    acesso a ela.
 * 4. Se `scope=ORGANIZATION_AND_DESCENDANTS` e a Organization for
 *    `BUSINESS_GROUP`, expande para as `COMPANY` filhas (G1 só suporta
 *    hierarquia de 1 nível — nenhuma árvore genérica) — cada filha passa
 *    pela MESMA defesa em profundidade do passo 3.
 * 5. **Deduplicação por `Organization.publicId`** (task G3, seção 9): um
 *    `Map` garante que a mesma Organization nunca aparece duas vezes,
 *    mesmo quando alcançada por mais de um Membership (ex.: Membership
 *    direto em uma `COMPANY` + Membership `AND_DESCENDANTS` no
 *    `BUSINESS_GROUP` pai produzindo a mesma `COMPANY`).
 *
 * **Zero Membership não é erro** — retorna `organizations: []`, `200`
 * (já decidido no design, §7: "acabou de ganhar acesso ao Portal mas
 * ainda não foi vinculado a nenhum cliente" é um estado legítimo).
 *
 * **ADMIN de `PCTEC_INGRESSA` nunca ganha escopo aqui** — este service
 * nunca consulta `ApplicationAccess`/perfil administrativo; só
 * `Membership`. `ApplicationAccess` e `Membership` são eixos
 * independentes (ADR-031 §6).
 *
 * Payload retornado é deliberadamente mínimo — nunca `legacyId`,
 * `internalId`, `documentNumber`/CNPJ, a menos que uma necessidade
 * concreta apareça (task G3, seção 12).
 */
export class GetPortalContextService {
  public constructor(
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationRelationshipRepository: OrganizationRelationshipRepository
  ) {}

  public async execute(rawIdentityPublicId: string): Promise<PortalContextResult> {
    const identityPublicId = IdentityPublicId.fromString(rawIdentityPublicId).toString();
    const activeMemberships = await this.membershipRepository.findActiveByIdentityPublicId(identityPublicId);

    const organizationsByPublicId = new Map<string, PortalOrganizationView>();

    for (const membership of activeMemberships) {
      const organization = await this.organizationRepository.findByPublicId(
        OrganizationPublicId.fromString(membership.getOrganizationPublicId())
      );
      if (organization === undefined || !organization.isActive()) {
        // Defesa em profundidade (seção 11) — nunca falha a requisição
        // inteira por causa de um único Membership problemático.
        continue;
      }

      organizationsByPublicId.set(organization.getPublicId().toString(), {
        publicId: organization.getPublicId().toString(),
        type: organization.getType().toString(),
        legalName: organization.getLegalName().toString(),
        tradeName: organization.getTradeName()?.toString()
      });

      if (membership.getScope().includesDescendants() && organization.getType().isBusinessGroup()) {
        const childRelationships = await this.organizationRelationshipRepository.findChildrenByParentPublicId(
          organization.getPublicId()
        );
        for (const relationship of childRelationships) {
          const childOrganization = await this.organizationRepository.findByPublicId(
            relationship.getChildOrganizationPublicId()
          );
          if (childOrganization === undefined || !childOrganization.isActive()) {
            continue;
          }
          organizationsByPublicId.set(childOrganization.getPublicId().toString(), {
            publicId: childOrganization.getPublicId().toString(),
            type: childOrganization.getType().toString(),
            legalName: childOrganization.getLegalName().toString(),
            tradeName: childOrganization.getTradeName()?.toString()
          });
        }
      }
    }

    return {
      identityPublicId,
      organizations: [...organizationsByPublicId.values()]
    };
  }
}
