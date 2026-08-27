import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import type { CreateOrganizationExternalReferenceService } from "./CreateOrganizationExternalReferenceService.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import {
  PORTAL_REFERENCE_ENTITY_TYPE,
  PORTAL_REFERENCE_SYSTEM_CODE
} from "../domain/value-objects/PortalReferenceCodes.js";
import {
  PortalReferenceAlreadyLinkedDifferentError,
  PortalReferenceCompanyRequiredError,
  PortalReferenceLegacyIdInvalidError,
  PortalReferenceOrganizationNotActiveError,
  PortalReferenceOrganizationNotFoundError
} from "../domain/errors/PortalOrganizationReferenceErrors.js";

export interface LinkPortalOrganizationReferenceRequest {
  readonly organizationPublicId: string;
  /** Cru, como chegou do corpo da requisição — validado aqui, nunca presumido inteiro. */
  readonly legacyId: unknown;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface LinkPortalOrganizationReferenceResult {
  readonly publicId: string;
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: number;
  readonly status: string;
  /**
   * `true` quando a referência JÁ existia, idêntica, e nada foi escrito.
   *
   * Quem chama usa isto para responder 200 em vez de 201 — e para não
   * anunciar como novidade um vínculo que já estava lá.
   */
  readonly alreadyLinked: boolean;
}

/**
 * Caso de uso: vincular uma COMPANY ao Portal —
 * `OrganizationExternalReference(PCTEC_PORTAL, clientes, legacyId)`.
 *
 * É a operação que substitui o CLI `bootstrap-organization-external-reference`
 * no dia a dia. O CLI continua existindo e continua correto; o que muda é
 * que a operação normal deixa de exigir acesso ao Linux do servidor.
 *
 * ## O que este serviço acrescenta ao serviço oficial de criação
 *
 * `CreateOrganizationExternalReferenceService` é genérico: qualquer
 * sistema, qualquer entidade, e a única invariante que ele conhece é
 * "no máximo uma ACTIVE por (systemCode, entityType, legacyId)". Ele
 * não sabe — e não deve saber — que grupo não recebe referência de
 * Portal, nem o que fazer quando a MESMA empresa é vinculada duas
 * vezes ao MESMO cliente legado.
 *
 * Este serviço decide isso, e delega a escrita:
 *
 * 1. `legacyId` inteiro positivo — `PORTAL_REFERENCE_LEGACY_ID_INVALID`;
 * 2. organização existe — `PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND` (404);
 * 3. é COMPANY — `PORTAL_REFERENCE_COMPANY_REQUIRED`;
 * 4. está ACTIVE — `PORTAL_REFERENCE_ORGANIZATION_NOT_ACTIVE`;
 * 5. já vinculada ao MESMO `legacyId` → devolve a existente,
 *    `alreadyLinked: true`, **sem escrever e sem gerar evento novo**;
 * 6. já vinculada a OUTRO `legacyId` → `PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT`
 *    (409), sem sobrescrever;
 * 7. caso contrário, `CreateOrganizationExternalReferenceService` — que
 *    abre a transação, insere e grava
 *    `organization-external-reference.created` na auditoria oficial.
 *
 * ## Nada de revogar, trocar ou excluir
 *
 * Não há caminho para isso aqui, e não é esquecimento. O modelo atual
 * marca referências antigas como `SUPERSEDED`, mas nenhum comando de
 * domínio faz essa transição; implementá-la por este PR significaria
 * inventar a regra de sucessão junto com a tela que a usa.
 *
 * ## Idempotência e concorrência
 *
 * A checagem do passo 5 é otimista, como a do serviço oficial. Duas
 * requisições idênticas simultâneas podem resultar em uma 201 e uma 409
 * (`ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS`) em vez de duas
 * respostas iguais — a autoridade sob concorrência é a UNIQUE KEY
 * `uk_org_ext_ref_active_match` (migration 0013), não esta leitura.
 * Recusar é o comportamento seguro: nada é sobrescrito nos dois casos.
 */
export class LinkPortalOrganizationReferenceService {
  private readonly systemCode = SystemCode.create(PORTAL_REFERENCE_SYSTEM_CODE);
  private readonly entityType = EntityType.create(PORTAL_REFERENCE_ENTITY_TYPE);

  public constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationExternalReferenceRepository: OrganizationExternalReferenceRepository,
    private readonly createOrganizationExternalReferenceService: CreateOrganizationExternalReferenceService
  ) {}

  public async execute(
    request: LinkPortalOrganizationReferenceRequest
  ): Promise<LinkPortalOrganizationReferenceResult> {
    const legacyId = normalizarLegacyId(request.legacyId);
    const organizationPublicId = PublicId.fromString(request.organizationPublicId);

    const organization = await this.organizationRepository.findByPublicId(organizationPublicId);
    if (organization === undefined) {
      throw new PortalReferenceOrganizationNotFoundError(organizationPublicId.toString());
    }
    if (organization.getType().isBusinessGroup()) {
      throw new PortalReferenceCompanyRequiredError();
    }
    if (!organization.isActive()) {
      throw new PortalReferenceOrganizationNotActiveError();
    }

    const existente = await this.organizationExternalReferenceRepository
      .findActiveByOrganizationSystemCodeAndEntityType(organizationPublicId, this.systemCode, this.entityType);
    if (existente !== undefined) {
      if (existente.getLegacyId().toNumber() !== legacyId) {
        throw new PortalReferenceAlreadyLinkedDifferentError();
      }
      return {
        publicId: existente.getPublicId().toString(),
        organizationPublicId: organizationPublicId.toString(),
        systemCode: PORTAL_REFERENCE_SYSTEM_CODE,
        entityType: PORTAL_REFERENCE_ENTITY_TYPE,
        legacyId,
        status: existente.getStatus(),
        alreadyLinked: true
      };
    }

    const criada = await this.createOrganizationExternalReferenceService.execute({
      organizationPublicId: organizationPublicId.toString(),
      systemCode: PORTAL_REFERENCE_SYSTEM_CODE,
      entityType: PORTAL_REFERENCE_ENTITY_TYPE,
      legacyId,
      actorPublicId: request.actorPublicId,
      correlationId: request.correlationId
    });

    return {
      publicId: criada.publicId,
      organizationPublicId: criada.organizationPublicId,
      systemCode: criada.systemCode,
      entityType: criada.entityType,
      legacyId,
      status: criada.status,
      alreadyLinked: false
    };
  }
}

/**
 * "Inteiro positivo" no sentido estrito.
 *
 * `Number("12abc")` é `NaN` e `Number(" 12 ")` é `12`, mas `Number("")`
 * e `Number(null)` são `0` — aceitar a conversão frouxa deixaria um
 * corpo vazio virar zero e cair só lá no Value Object, com outro código
 * de erro. A checagem textual recusa antes, com o código que a tela
 * conhece.
 */
function normalizarLegacyId(bruto: unknown): number {
  if (typeof bruto === "number") {
    if (!Number.isInteger(bruto) || bruto <= 0) {
      throw new PortalReferenceLegacyIdInvalidError();
    }
    return bruto;
  }
  if (typeof bruto === "string" && /^[1-9][0-9]*$/.test(bruto.trim())) {
    const numero = Number(bruto.trim());
    if (Number.isSafeInteger(numero)) {
      return numero;
    }
  }
  throw new PortalReferenceLegacyIdInvalidError();
}
