import type { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";
import { IdentityExternalReferenceNotFoundError } from "../domain/errors/IdentityExternalReferenceErrors.js";

/**
 * Caso de uso: resolver a `IdentityExternalReference` `ACTIVE` dado
 * `(systemCode, entityType, legacyId)` — P1B.0 (v0.7.x).
 *
 * **Direção REVERSA vs `GetActiveOrganizationExternalReferenceService`:**
 * - Organization: recebe `organizationPublicId` → retorna o `legacyId`
 *   (Ingressa→Portal: "qual id legado desta Organization no Portal?").
 * - Identity: recebe `legacyId` → retorna a `IdentityExternalReference`
 *   contendo o `identityPublicId` (Portal→Ingressa: "qual Identity do
 *   Ingressa corresponde a este portal_acesso.id?").
 *
 * O Portal tem `req.user.id` = `portal_acesso.id` e precisa descobrir
 * o `Identity.publicId` correspondente para fazer a chamada
 * service-to-service subsequente (rota `/api/v1/service/portal/...`).
 * Nunca recebe `identityPublicId` como entrada — o browser nunca pode
 * fornecer isso como autoridade (regra mandatória P1B).
 *
 * **Responsabilidade única: resolver a referência. NÃO faz autorização.**
 * Autorização é responsabilidade do boundary HTTP anterior (middleware
 * `X-Portal-Service-Credential`, P1A.1). Quando este service executa,
 * a requisição já foi autenticada como service-to-service legítima.
 *
 * Lança `IdentityExternalReferenceNotFoundError` (404) quando não há
 * referência ACTIVE para essa combinação — o mapeamento ainda não foi
 * cadastrado via CLI (Fatia 3).
 */
export class GetActiveIdentityExternalReferenceService {
  public constructor(private readonly repository: IdentityExternalReferenceRepository) {}

  /**
   * @param rawSystemCode   Ex.: `"PCTEC_PORTAL"`.
   * @param rawEntityType   Ex.: `"portal_acesso"`.
   * @param rawLegacyId     Ex.: `33` — `portal_acesso.id` do usuário logado.
   *
   * Nunca recebe `identityPublicId` como parâmetro — a assinatura não
   * tem espaço para isso por design (boundary: o browser nunca é a
   * autoridade sobre qual Identity corresponde a um usuário do Portal).
   */
  public async execute(
    rawSystemCode: string,
    rawEntityType: string,
    rawLegacyId: string | number
  ): Promise<IdentityExternalReference> {
    const systemCode = SystemCode.create(rawSystemCode);
    const entityType = EntityType.create(rawEntityType);
    const legacyId = LegacyId.create(rawLegacyId);

    const reference = await this.repository.findActiveBySystemCodeEntityTypeAndLegacyId(
      systemCode,
      entityType,
      legacyId
    );
    if (reference === undefined) {
      throw new IdentityExternalReferenceNotFoundError(
        rawSystemCode,
        rawEntityType,
        legacyId.toString()
      );
    }
    return reference;
  }
}
