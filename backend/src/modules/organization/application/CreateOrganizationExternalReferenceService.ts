import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";
import {
  OrganizationExternalReferenceOrganizationNotFoundError,
  OrganizationExternalReferenceAlreadyExistsError
} from "../domain/errors/OrganizationExternalReferenceErrors.js";

export interface CreateOrganizationExternalReferenceRequest {
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface CreateOrganizationExternalReferenceResult {
  readonly publicId: string;
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly status: string;
}

/**
 * Application Service para o comando CreateOrganizationExternalReference.
 *
 * Orquestra: confirmar que a Organization referenciada existe
 * (`ORGANIZATION_NOT_FOUND`), checar a invariante "no máximo 1
 * referência ACTIVE por (systemCode, entityType, legacyId)" via
 * repositório antes do INSERT (`ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS`
 * — checagem otimista, fast fail com mensagem amigável), construir o
 * Aggregate, persistir, e gravar o evento de auditoria
 * (`organization-external-reference.created`) — tudo na mesma
 * transação. **A garantia real sob concorrência não é esta checagem
 * otimista** — é a `UNIQUE KEY uk_org_ext_ref_active_match` sobre a
 * coluna gerada `active_match_key` (migration 0013); se a checagem
 * otimista perder uma corrida (duas transações concorrentes), o INSERT
 * ainda falha no banco e `MariaDbOrganizationExternalReferenceRepository`
 * traduz esse erro de volta para o mesmo erro de domínio — ver o
 * raciocínio completo sobre concorrência na migration 0013.
 *
 * Referências `SUPERSEDED` NUNCA contam para essa checagem — várias
 * linhas históricas `SUPERSEDED` para o mesmo (systemCode, entityType,
 * legacyId) coexistem livremente; só uma `ACTIVE` por vez é a
 * invariante.
 *
 * **Este service NÃO decide MATCHED/UNMATCHED/CONFLICT** — é
 * um comando de criação simples, assumindo que o chamador (o futuro
 * processo de bootstrap/matching, fora de escopo G2) já resolveu qual
 * `organizationPublicId` corresponde a este registro legado. Se já
 * existir uma referência ACTIVE para a combinação `(systemCode,
 * entityType, legacyId)`, o erro é
 * `ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS` — cabe a quem chama
 * interpretar isso como MATCHED (idempotência) ou CONFLICT (esperava
 * apontar para outra Organization), nunca resolvido silenciosamente
 * aqui.
 */
export class CreateOrganizationExternalReferenceService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly organizationExternalReferenceRepositoryFactory: (
      connection: Queryable
    ) => OrganizationExternalReferenceRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(
    request: CreateOrganizationExternalReferenceRequest
  ): Promise<CreateOrganizationExternalReferenceResult> {
    const organizationPublicId = PublicId.fromString(request.organizationPublicId);
    const systemCode = SystemCode.create(request.systemCode);
    const entityType = EntityType.create(request.entityType);
    const legacyId = LegacyId.create(request.legacyId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const organizationRepository = this.organizationRepositoryFactory(connection);
      const organizationExternalReferenceRepository = this.organizationExternalReferenceRepositoryFactory(
        connection
      );
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const organization = await organizationRepository.findByPublicId(organizationPublicId);
      if (organization === undefined) {
        throw new OrganizationExternalReferenceOrganizationNotFoundError(organizationPublicId.toString());
      }

      const alreadyExists = await organizationExternalReferenceRepository.existsActiveBySystemCodeEntityTypeAndLegacyId(
        systemCode,
        entityType,
        legacyId
      );
      if (alreadyExists) {
        throw new OrganizationExternalReferenceAlreadyExistsError();
      }

      const reference = OrganizationExternalReference.create({
        organizationPublicId: organizationPublicId.toString(),
        systemCode: request.systemCode,
        entityType: request.entityType,
        legacyId: request.legacyId,
        actorPublicId: request.actorPublicId,
        correlationId
      });

      await organizationExternalReferenceRepository.insert(reference);

      const events = reference.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        publicId: reference.getPublicId().toString(),
        organizationPublicId: reference.getOrganizationPublicId(),
        systemCode: reference.getSystemCode().toString(),
        entityType: reference.getEntityType().toString(),
        status: reference.getStatus()
      };
    });
  }
}
