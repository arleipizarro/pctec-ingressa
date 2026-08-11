import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { ApplicationRepository } from "../domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../domain/ApplicationAccessRepository.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { ApplicationAccess } from "../domain/ApplicationAccess.js";
import { ApplicationCode } from "../domain/value-objects/ApplicationCode.js";
import { AccessProfile } from "../domain/value-objects/AccessProfile.js";
import {
  ApplicationNotFoundError,
  IdentityNotFoundForAccessError,
  ApplicationAccessAlreadyGrantedError
} from "../domain/errors/ApplicationErrors.js";

export interface GrantApplicationAccessRequest {
  readonly identityPublicId: string;
  readonly applicationCode: string;
  readonly accessProfile: string;
  readonly grantedByIdentityPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface GrantApplicationAccessResult {
  readonly applicationAccessPublicId: string;
  readonly identityPublicId: string;
  readonly applicationCode: string;
  readonly accessProfile: string;
}

/**
 * Application Service para o comando genérico `ApplicationAccess.grant()`
 * — G3 (v0.6.x). Diferente de `BootstrapFirstApplicationAccessService`
 * (guard one-shot com named lock, exclusivo da concessão fundacional
 * `PCTEC_INGRESSA`/`ADMIN`): este service concede acesso a QUALQUER
 * Application/perfil, repetidamente, sempre com um
 * `grantedByIdentityPublicId` real — não é um evento único da vida da
 * plataforma, é um comando administrativo comum (mesmo princípio de
 * `CreateMembershipService`/`CreateOrganizationExternalReferenceService`:
 * checagem-antes-de-inserir dentro da mesma transação, sem named lock).
 *
 * Resolve `Application` por CÓDIGO (nunca UUID hardcoded), mesmo
 * princípio de `AuthorizeApplicationAccessService`.
 */
export class GrantApplicationAccessService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly applicationAccessRepositoryFactory: (connection: Queryable) => ApplicationAccessRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: GrantApplicationAccessRequest): Promise<GrantApplicationAccessResult> {
    // Validação de formato acontece antes de qualquer acesso a
    // repositório — falha rápida.
    const applicationCode = ApplicationCode.create(request.applicationCode);
    const accessProfile = AccessProfile.create(request.accessProfile);
    const identityPublicId = IdentityPublicId.fromString(request.identityPublicId);
    const grantedByIdentityPublicId = IdentityPublicId.fromString(request.grantedByIdentityPublicId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const applicationRepository = this.applicationRepositoryFactory(connection);
      const identityRepository = this.identityRepositoryFactory(connection);
      const applicationAccessRepository = this.applicationAccessRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const application = await applicationRepository.findByCode(applicationCode);
      if (application === undefined) {
        throw new ApplicationNotFoundError(request.applicationCode);
      }

      const identity = await identityRepository.findByPublicId(identityPublicId);
      if (identity === undefined) {
        throw new IdentityNotFoundForAccessError(identityPublicId.toString());
      }

      const applicationPublicId = application.getPublicId().toString();

      const alreadyGranted = await applicationAccessRepository.existsGrantedByIdentityApplicationAndProfile(
        identityPublicId.toString(),
        applicationPublicId,
        accessProfile.toString()
      );
      if (alreadyGranted) {
        throw new ApplicationAccessAlreadyGrantedError();
      }

      const applicationAccess = ApplicationAccess.grant({
        identityPublicId: identityPublicId.toString(),
        applicationPublicId,
        accessProfile: request.accessProfile,
        grantedByIdentityPublicId: grantedByIdentityPublicId.toString(),
        correlationId
      });

      await applicationAccessRepository.insert(applicationAccess);

      const events = applicationAccess.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        applicationAccessPublicId: applicationAccess.getPublicId().toString(),
        identityPublicId: identityPublicId.toString(),
        applicationCode: application.getCode().toString(),
        accessProfile: applicationAccess.getAccessProfile().toString()
      };
    });
  }
}
