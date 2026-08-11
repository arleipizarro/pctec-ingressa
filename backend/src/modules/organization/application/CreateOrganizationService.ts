import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { Organization } from "../domain/Organization.js";
import { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import { OrganizationDocumentAlreadyExistsError } from "../domain/errors/OrganizationErrors.js";

export interface CreateOrganizationRequest {
  readonly type: string;
  readonly legalName: string;
  readonly tradeName?: string | undefined;
  readonly documentNumber?: string | undefined;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface CreateOrganizationResult {
  readonly publicId: string;
  readonly type: string;
  readonly status: string;
  readonly version: number;
}

/**
 * Application Service para o comando CreateOrganization.
 *
 * Orquestra: validação de unicidade de `(documentNumber, type)` via
 * repositório, construção do Aggregate, persistência da Organization e
 * dos eventos de auditoria resultantes — tudo na mesma transação (mesmo
 * padrão de `CreateIdentityService`).
 *
 * Não é um CRUD genérico: cobre exclusivamente o comando
 * CreateOrganization. G1 não inclui nenhum comando de update.
 */
export class CreateOrganizationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: CreateOrganizationRequest): Promise<CreateOrganizationResult> {
    // Validação de formato acontece antes de qualquer acesso a
    // repositório — falha rápida, sem custo de I/O para entradas
    // obviamente inválidas. Mesmo princípio de CreateIdentityService.
    const type = OrganizationType.create(request.type);
    const documentNumber = DocumentNumber.createOptional(request.documentNumber);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const organizationRepository = this.organizationRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      if (documentNumber !== undefined) {
        const documentAlreadyExists = await organizationRepository.existsByDocumentNumberAndType(
          documentNumber,
          type
        );
        if (documentAlreadyExists) {
          throw new OrganizationDocumentAlreadyExistsError();
        }
      }

      const organization = Organization.create({
        type: request.type,
        legalName: request.legalName,
        tradeName: request.tradeName,
        documentNumber: request.documentNumber,
        actorPublicId: request.actorPublicId,
        correlationId
      });

      await organizationRepository.insert(organization);

      const events = organization.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        publicId: organization.getPublicId().toString(),
        type: organization.getType().toString(),
        status: organization.getStatus(),
        version: organization.getVersion()
      };
    });
  }
}
