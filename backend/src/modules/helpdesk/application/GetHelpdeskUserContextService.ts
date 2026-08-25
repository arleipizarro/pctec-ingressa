import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { GetActiveIdentityExternalReferenceService } from "../../identity/application/GetActiveIdentityExternalReferenceService.js";
import type { IdentityExternalReferenceRepository } from "../../identity/domain/IdentityExternalReferenceRepository.js";
import { SystemCode } from "../../identity/domain/value-objects/SystemCode.js";
import { EntityType } from "../../identity/domain/value-objects/EntityType.js";
import { LegacyId } from "../../identity/domain/value-objects/LegacyId.js";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { GetPortalContextService, PortalOrganizationView } from "../../portal/application/GetPortalContextService.js";
import {
  HelpdeskContextInconsistentError,
  HelpdeskIdentityNotActiveError,
  HelpdeskReferenceAmbiguousError
} from "../domain/errors/HelpdeskErrors.js";

/** Sistema e entidade de origem — fixos, conforme o contrato. */
export const HELPDESK_SOURCE_SYSTEM = "PCTEC_HELPDESK" as const;
export const HELPDESK_SOURCE_ENTITY = "users" as const;
export const HELPDESK_APPLICATION_CODE = "PCTEC_HELPDESK" as const;
export const HELPDESK_REQUIRED_PROFILE = "USER" as const;

export interface HelpdeskUserContextResult {
  readonly organizations: readonly PortalOrganizationView[];
}

/**
 * Caso de uso: contexto organizacional autorizado de um usuário do
 * Helpdesk, a partir do `users.id` legado.
 *
 * Pipeline, na ordem, sem atalho (contrato service-to-service):
 *
 * ```
 * users.id
 *   → IdentityExternalReference(PCTEC_HELPDESK,'users',id)   404 se não houver
 *   → Identity existe?                                       409 se não
 *   → Identity ACTIVE?                                       403 se não
 *   → AuthorizeApplicationAccessService(PCTEC_HELPDESK,USER) 403 se negar
 *   → Memberships ACTIVE → Organizations ACTIVE
 * ```
 *
 * **Nada aqui consulta chamado, fila, equipe ou `client_id`.** A
 * auditoria do Helpdesk provou que `client_group_id` não concede acesso
 * a nenhuma outra empresa do grupo, e a decisão desta fatia é mais
 * forte: o que concede acesso é Membership no Ingressa, ponto. O
 * `client_id` do Helpdesk serve, no consumidor, só para compatibilidade
 * de consulta DEPOIS que a organização autorizada já foi determinada
 * aqui.
 *
 * **Reuso, não redesenho.** `GetActiveIdentityExternalReferenceService`,
 * `AuthorizeApplicationAccessService` e `GetPortalContextService` são os
 * mesmos serviços do Portal, sem alteração — o último, apesar do nome,
 * é resolução de escopo organizacional pura (o próprio docblock dele
 * formaliza isso) e já implementa Membership ACTIVE, Organization
 * ACTIVE, expansão `ORGANIZATION_AND_DESCENDANTS` e deduplicação.
 * Reimplementar essas regras aqui criaria duas verdades sobre quem
 * enxerga o quê.
 */
export class GetHelpdeskUserContextService {
  public constructor(
    private readonly getActiveIdentityExternalReferenceService: GetActiveIdentityExternalReferenceService,
    private readonly identityExternalReferenceRepository: IdentityExternalReferenceRepository,
    private readonly identityRepository: IdentityRepository,
    private readonly authorizeApplicationAccessService: AuthorizeApplicationAccessService,
    private readonly getPortalContextService: GetPortalContextService
  ) {}

  public async execute(rawLegacyUserId: string | number): Promise<HelpdeskUserContextResult> {
    // Ambiguidade é checada ANTES de resolver: se há duas referências
    // ACTIVE, "qual delas o findActive devolveu" é irrelevante — as duas
    // são igualmente plausíveis e nenhuma pode ser usada.
    await this.assertReferenciaUnica(rawLegacyUserId);

    const referencia = await this.getActiveIdentityExternalReferenceService.execute(
      HELPDESK_SOURCE_SYSTEM,
      HELPDESK_SOURCE_ENTITY,
      rawLegacyUserId
    );
    const identityPublicId = referencia.getIdentityPublicId();

    const identidade = await this.identityRepository.findByPublicId(
      IdentityPublicId.fromString(identityPublicId)
    );
    if (identidade === undefined) {
      throw new HelpdeskContextInconsistentError(
        "a referência externa aponta para uma identidade que não existe"
      );
    }
    if (identidade.getStatus().toString() !== "ACTIVE") {
      throw new HelpdeskIdentityNotActiveError(identidade.getStatus().toString());
    }

    await this.authorizeApplicationAccessService.execute({
      identityPublicId,
      applicationCode: HELPDESK_APPLICATION_CODE,
      requiredProfile: HELPDESK_REQUIRED_PROFILE
    });

    const contexto = await this.getPortalContextService.execute(identityPublicId);
    return { organizations: contexto.organizations };
  }

  private async assertReferenciaUnica(rawLegacyUserId: string | number): Promise<void> {
    const contador = this.identityExternalReferenceRepository.countActiveBySystemCodeEntityTypeAndLegacyId;
    if (contador === undefined) {
      return;
    }
    const total = await contador.call(
      this.identityExternalReferenceRepository,
      SystemCode.create(HELPDESK_SOURCE_SYSTEM),
      EntityType.create(HELPDESK_SOURCE_ENTITY),
      LegacyId.create(rawLegacyUserId)
    );
    if (total > 1) {
      throw new HelpdeskReferenceAmbiguousError(total);
    }
  }
}
