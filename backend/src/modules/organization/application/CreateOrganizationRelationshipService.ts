import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../domain/OrganizationRelationshipRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { OrganizationRelationship } from "../domain/OrganizationRelationship.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import {
  OrganizationRelationshipParentMustBeBusinessGroupError,
  OrganizationRelationshipChildMustBeCompanyError,
  OrganizationRelationshipParentNotFoundError,
  OrganizationRelationshipChildNotFoundError,
  OrganizationRelationshipChildAlreadyLinkedError
} from "../domain/errors/OrganizationRelationshipErrors.js";

export interface CreateOrganizationRelationshipRequest {
  readonly parentOrganizationPublicId: string;
  readonly childOrganizationPublicId: string;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface CreateOrganizationRelationshipResult {
  readonly publicId: string;
  readonly parentOrganizationPublicId: string;
  readonly childOrganizationPublicId: string;
}

/**
 * Application Service para o comando CreateOrganizationRelationship.
 *
 * **Único lugar onde a regra "parent deve ser BUSINESS_GROUP, child deve
 * ser COMPANY" é verificada** — o Aggregate `OrganizationRelationship`
 * não tem acesso a outra Organization para checar isso sozinho (ver nota
 * em `OrganizationRelationship.ts`). Este serviço carrega as duas
 * Organizations via `OrganizationRepository` antes de construir o
 * relacionamento.
 *
 * Orquestra, na mesma transação: carregar parent e child, validar tipos,
 * checar `uk_org_rel_child` (no MVP, uma COMPANY pertence a no máximo um
 * BUSINESS_GROUP) via repositório antes do INSERT, construir o
 * Aggregate, persistir, e gravar o evento de auditoria resultante.
 */
export class CreateOrganizationRelationshipService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly organizationRelationshipRepositoryFactory: (
      connection: Queryable
    ) => OrganizationRelationshipRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(
    request: CreateOrganizationRelationshipRequest
  ): Promise<CreateOrganizationRelationshipResult> {
    // Validação de formato dos publicIds acontece antes de qualquer
    // acesso a repositório — falha rápida.
    const parentPublicId = PublicId.fromString(request.parentOrganizationPublicId);
    const childPublicId = PublicId.fromString(request.childOrganizationPublicId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const organizationRepository = this.organizationRepositoryFactory(connection);
      const organizationRelationshipRepository = this.organizationRelationshipRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const parentOrganization = await organizationRepository.findByPublicId(parentPublicId);
      if (parentOrganization === undefined) {
        throw new OrganizationRelationshipParentNotFoundError(parentPublicId.toString());
      }
      if (!parentOrganization.getType().isBusinessGroup()) {
        throw new OrganizationRelationshipParentMustBeBusinessGroupError();
      }

      const childOrganization = await organizationRepository.findByPublicId(childPublicId);
      if (childOrganization === undefined) {
        throw new OrganizationRelationshipChildNotFoundError(childPublicId.toString());
      }
      if (!childOrganization.getType().isCompany()) {
        throw new OrganizationRelationshipChildMustBeCompanyError();
      }

      const childAlreadyLinked = await organizationRelationshipRepository.existsByChildOrganizationPublicId(
        childPublicId
      );
      if (childAlreadyLinked) {
        throw new OrganizationRelationshipChildAlreadyLinkedError();
      }

      const relationship = OrganizationRelationship.create({
        parentOrganizationPublicId: parentPublicId.toString(),
        childOrganizationPublicId: childPublicId.toString(),
        actorPublicId: request.actorPublicId,
        correlationId
      });

      await organizationRelationshipRepository.insert(relationship);

      const events = relationship.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        publicId: relationship.getPublicId().toString(),
        parentOrganizationPublicId: relationship.getParentOrganizationPublicId().toString(),
        childOrganizationPublicId: relationship.getChildOrganizationPublicId().toString()
      };
    });
  }
}
