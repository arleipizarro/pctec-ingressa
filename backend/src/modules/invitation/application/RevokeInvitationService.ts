import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { InvitationRepository } from "../domain/InvitationRepository.js";
import { createInvitationRevokedEvent } from "../domain/events/InvitationDomainEvents.js";
import { InvitationNotUsableError } from "../domain/errors/InvitationErrors.js";

export interface RevokeInvitationRequest {
  readonly invitationPublicId: string;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

/** Motivo da revogação manual, distinto do `SUPERSEDED` automático. */
const MOTIVO = "ADMIN_ACTION" as const;

/**
 * Revoga um convite ainda pendente.
 *
 * O link deixa de valer no mesmo instante — é o caminho para quando um
 * convite foi entregue ao canal errado, ou a pessoa deixou a empresa
 * antes de usá-lo. Depois disso, emitir outro é permitido normalmente:
 * a elegibilidade continua a mesma, e o convite revogado não conta como
 * "já tem convite pendente".
 *
 * **Conflito explícito**: revogar um convite já consumido, já revogado
 * ou expirado falha com `InvitationNotUsableError` em vez de responder
 * "ok" a uma operação que não mudou nada. Quem clicou acreditava haver
 * um convite vivo, e essa divergência precisa aparecer.
 *
 * Nunca toca no token: ele não é lido, não é devolvido e nunca foi
 * persistido em claro.
 */
export class RevokeInvitationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly invitationRepositoryFactory: (connection: Queryable) => InvitationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: RevokeInvitationRequest): Promise<{ readonly invitationPublicId: string }> {
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const invitationRepository = this.invitationRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);
      const agora = new Date();

      const revogado = await invitationRepository.revokeByPublicId(request.invitationPublicId, agora, MOTIVO);
      if (revogado === undefined) {
        throw new InvitationNotUsableError("NOT_PENDING");
      }

      await auditEventRepository.insert(
        AuditEvent.fromDomainEvent(
          createInvitationRevokedEvent(
            {
              aggregatePublicId: revogado.getPublicId().toString(),
              actorPublicId: request.actorPublicId,
              correlationId,
              occurredAt: agora
            },
            {
              invitationPublicId: revogado.getPublicId().toString(),
              identityPublicId: revogado.getIdentityPublicId(),
              reason: MOTIVO
            }
          )
        )
      );

      return { invitationPublicId: revogado.getPublicId().toString() };
    });
  }
}
