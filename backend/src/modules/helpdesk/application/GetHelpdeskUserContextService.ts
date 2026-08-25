import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { GetActiveIdentityExternalReferenceService } from "../../identity/application/GetActiveIdentityExternalReferenceService.js";
import type { IdentityExternalReferenceRepository } from "../../identity/domain/IdentityExternalReferenceRepository.js";
import { SystemCode } from "../../identity/domain/value-objects/SystemCode.js";
import { EntityType } from "../../identity/domain/value-objects/EntityType.js";
import { LegacyId } from "../../identity/domain/value-objects/LegacyId.js";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { GetPortalContextService } from "../../portal/application/GetPortalContextService.js";
import type { OrganizationExternalReferenceRepository } from "../../organization/domain/OrganizationExternalReferenceRepository.js";
import { PublicId as OrganizationPublicId } from "../../organization/domain/value-objects/PublicId.js";
import { SystemCode as OrganizationSystemCode } from "../../organization/domain/value-objects/SystemCode.js";
import { EntityType as OrganizationEntityType } from "../../organization/domain/value-objects/EntityType.js";
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
/** Entidade legada de EMPRESA no Helpdesk — `clients.id`. */
export const HELPDESK_ORGANIZATION_ENTITY = "clients" as const;

/**
 * Organização autorizada, já com o identificador empresarial que o
 * Helpdesk precisa para consultar seus próprios dados.
 *
 * `sourceClientId` vem EXCLUSIVAMENTE da `OrganizationExternalReference`
 * de `PCTEC_HELPDESK`. Nunca de nome, documento, membership,
 * `users.client_id` ou chamado — inferir por qualquer um desses faria um
 * `UPDATE clients SET name` (ou o cadastro do próprio usuário) virar
 * mudança de escopo de acesso.
 */
export interface HelpdeskOrganizationView {
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | undefined;
  readonly sourceClientId: number;
}

export interface HelpdeskUserContextResult {
  readonly organizations: readonly HelpdeskOrganizationView[];
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
    private readonly getPortalContextService: GetPortalContextService,
    private readonly organizationExternalReferenceRepository: OrganizationExternalReferenceRepository
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

    const organizations: HelpdeskOrganizationView[] = [];
    for (const organizacao of contexto.organizations) {
      organizations.push({
        ...organizacao,
        sourceClientId: await this.resolverClientId(organizacao.publicId)
      });
    }
    return { organizations };
  }

  /**
   * Resolve `Organization → clients.id` pela referência externa de
   * PCTEC_HELPDESK.
   *
   * Toda anomalia responde 409, e nenhuma delas "degrada" para omitir a
   * organização da lista: sumir com uma empresa do contexto seria uma
   * perda silenciosa de acesso, e mantê-la sem `sourceClientId` daria ao
   * Helpdesk uma autorização que ele não consegue aplicar. Recusar o
   * contexto inteiro é a única saída honesta — o cadastro precisa ser
   * corrigido, não contornado.
   */
  private async resolverClientId(organizationPublicId: string): Promise<number> {
    const publicId = OrganizationPublicId.fromString(organizationPublicId);
    const systemCode = OrganizationSystemCode.create(HELPDESK_SOURCE_SYSTEM);
    const entityType = OrganizationEntityType.create(HELPDESK_ORGANIZATION_ENTITY);

    const contador = this.organizationExternalReferenceRepository
      .countActiveByOrganizationSystemCodeAndEntityType;
    if (contador !== undefined) {
      const total = await contador.call(
        this.organizationExternalReferenceRepository,
        publicId,
        systemCode,
        entityType
      );
      if (total > 1) {
        throw new HelpdeskContextInconsistentError(
          `organização ${organizationPublicId} tem ${total} referências ACTIVE de ${HELPDESK_SOURCE_SYSTEM}`
        );
      }
    }

    const referencia = await this.organizationExternalReferenceRepository
      .findActiveByOrganizationSystemCodeAndEntityType(publicId, systemCode, entityType);
    if (referencia === undefined) {
      throw new HelpdeskContextInconsistentError(
        `organização ${organizationPublicId} não tem referência ACTIVE de ${HELPDESK_SOURCE_SYSTEM}`
      );
    }

    const legacyId = Number(referencia.getLegacyId().toNumber());
    if (!Number.isInteger(legacyId) || legacyId <= 0) {
      throw new HelpdeskContextInconsistentError(
        `referência de ${HELPDESK_SOURCE_SYSTEM} da organização ${organizationPublicId} tem id legado inválido`
      );
    }
    return legacyId;
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
