import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { ApplicationAccessRepository } from "../domain/ApplicationAccessRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { ApplicationAccessNotFoundError } from "../domain/errors/ApplicationErrors.js";

export interface RevokeApplicationAccessRequest {
  readonly applicationAccessPublicId: string;
  readonly revokedByIdentityPublicId: string;
  readonly expectedVersion: number;
  readonly correlationId?: string | undefined;
}

export interface RevokeApplicationAccessResult {
  readonly applicationAccessPublicId: string;
  readonly status: string;
  readonly version: number;
}

/**
 * Revoga um `ApplicationAccess`.
 *
 * **Nunca DELETE.** O acesso vira REVOKED com carimbo de quem revogou e
 * quando; a linha permanece e a coluna gerada `active_grant_flag` libera
 * a UNIQUE KEY para uma concessão futura. Apagar destruiria a resposta
 * para "por que esta pessoa teve acesso entre terça e quinta?".
 *
 * `expectedVersion` vem do cliente e é comparado duas vezes — no
 * agregado e no `WHERE version = ?` do UPDATE. A primeira dá erro de
 * domínio legível; a segunda é a trava real sob concorrência.
 */
export class RevokeApplicationAccessService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly applicationAccessRepositoryFactory: (connection: Queryable) => ApplicationAccessRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: RevokeApplicationAccessRequest): Promise<RevokeApplicationAccessResult> {
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const repository = this.applicationAccessRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const acesso = await repository.findByPublicId(request.applicationAccessPublicId);
      if (acesso === undefined) {
        throw new ApplicationAccessNotFoundError(request.applicationAccessPublicId);
      }

      const versaoOriginal = acesso.getVersion();
      acesso.revoke({
        revokedByIdentityPublicId: request.revokedByIdentityPublicId,
        expectedVersion: request.expectedVersion,
        correlationId
      });
      await repository.update(acesso, versaoOriginal);

      const eventos = acesso.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento));
      await auditEventRepository.insertMany(eventos);

      return {
        applicationAccessPublicId: acesso.getPublicId().toString(),
        status: acesso.getStatus(),
        version: acesso.getVersion()
      };
    });
  }
}
