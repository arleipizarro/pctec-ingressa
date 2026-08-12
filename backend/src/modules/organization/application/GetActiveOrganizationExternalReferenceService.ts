import type { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { OrganizationExternalReferenceNotFoundError } from "../domain/errors/OrganizationExternalReferenceErrors.js";

/**
 * Caso de uso: resolver a `OrganizationExternalReference` `ACTIVE` de
 * uma Organization para um sistema/entidade legados — P1 Portal
 * (v0.7.x), primeira peça real da integração Portal ↔ Ingressa.
 *
 * **Responsabilidade única: resolver a referência correta. NÃO refaz
 * autorização.** Autorização (sessão válida, `ApplicationAccess(PCTEC_PORTAL,
 * USER)`, `organizationPublicId` pertence ao `PortalContext` da
 * Identity) é responsabilidade do boundary HTTP/application ANTERIOR
 * (`requireAuthenticatedSession` → `requireApplicationAccess` →
 * `requireOrganizationAccess`, montados em `createApp.ts`) — quando
 * este service executa, a Organization já foi confirmada como
 * pertencente ao contexto da Identity chamadora. Este service nunca
 * recebe nem consulta `identityPublicId` — não tem como, e não
 * deveria: mesmo boundary estrito já usado por
 * `AuthorizeApplicationAccessService`/`GetPortalContextService`.
 *
 * Lança `OrganizationExternalReferenceNotFoundError` (404) quando a
 * Organization é legítima mas não tem mapeamento legado cadastrado —
 * distinto de `ORGANIZATION_ACCESS_DENIED` (403), que já teria
 * interrompido a cadeia antes deste service ser alcançado.
 */
export class GetActiveOrganizationExternalReferenceService {
  public constructor(private readonly repository: OrganizationExternalReferenceRepository) {}

  /**
   * @param rawOrganizationPublicId Já confirmado pertencente ao
   * PortalContext da Identity chamadora — ver nota de classe.
   * @param rawSystemCode Ex.: `"PCTEC_PORTAL"`.
   * @param rawEntityType Ex.: `"clientes"` — nunca `"clientes_grupo"`
   * para produzir contexto comercial (decisão do piloto AFIP).
   */
  public async execute(
    rawOrganizationPublicId: string,
    rawSystemCode: string,
    rawEntityType: string
  ): Promise<OrganizationExternalReference> {
    const organizationPublicId = PublicId.fromString(rawOrganizationPublicId);
    const systemCode = SystemCode.create(rawSystemCode);
    const entityType = EntityType.create(rawEntityType);

    const reference = await this.repository.findActiveByOrganizationSystemCodeAndEntityType(
      organizationPublicId,
      systemCode,
      entityType
    );
    if (reference === undefined) {
      throw new OrganizationExternalReferenceNotFoundError(rawOrganizationPublicId, rawSystemCode, rawEntityType);
    }
    return reference;
  }
}
