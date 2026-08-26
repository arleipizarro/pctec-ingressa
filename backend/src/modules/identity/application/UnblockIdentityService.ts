import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import { IdentityNotFoundError } from "../domain/errors/IdentityErrors.js";

export interface UnblockIdentityRequest {
  readonly identityPublicId: string;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly expectedVersion: number;
  readonly correlationId?: string | undefined;
}

export interface UnblockIdentityResult {
  readonly identityPublicId: string;
  readonly status: string;
  readonly loginEnabled: boolean;
  readonly version: number;
}

/**
 * Desbloqueia uma Identity — a transição inversa de `BlockIdentityService`.
 *
 * **Só desfaz o que o bloqueio fez, e nada mais.** O bloqueio mudou o
 * `status` e revogou sessões; desbloquear devolve o `status` que o
 * domínio define para a transição (`BLOCKED → ACTIVE`) e para por aí.
 * Sessões revogadas NÃO voltam — uma sessão revogada é um fato do
 * passado, e ressuscitá-la entregaria acesso a um cookie que a pessoa
 * pode nem ter mais. Convites, memberships e `ApplicationAccess` também
 * não são recriados: o bloqueio nunca os tocou, então não há o que
 * restaurar.
 *
 * **`login_enabled` fica como estava.** Ele é um eixo independente do
 * `status` — uma Identity federada importada do Helpdesk tem
 * `login_enabled = 0` antes e depois de um ciclo de bloqueio. Ligá-lo
 * aqui daria a alguém a capacidade de autenticar por senha sem nunca ter
 * definido uma, e seria uma decisão que o desbloqueio não pediu.
 * `Identity.unblock()` não mexe nesse campo, e este serviço não
 * acrescenta nada por fora.
 *
 * **Conflito explícito:** só `BLOCKED` transita para `ACTIVE` por este
 * caminho. Desbloquear quem não está bloqueado falha com
 * `InvalidIdentityStatusTransitionError` em vez de responder "ok" a uma
 * operação que não mudou estado. `expectedVersion` protege contra uma
 * tela desatualizada.
 */
export class UnblockIdentityService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: UnblockIdentityRequest): Promise<UnblockIdentityResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const identityPublicId = PublicId.fromString(request.identityPublicId);
    const actor = ActorPublicId.fromIdentityPublicId(PublicId.fromString(request.actorPublicId));

    return this.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.identityRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const identity = await identityRepository.findByPublicId(identityPublicId);
      if (identity === undefined) {
        throw new IdentityNotFoundError(identityPublicId.toString());
      }

      const versaoOriginal = identity.getVersion();
      identity.unblock({ actor, expectedVersion: request.expectedVersion, correlationId });
      await identityRepository.update(identity, versaoOriginal);

      await auditEventRepository.insertMany(
        identity.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento))
      );

      return {
        identityPublicId: identityPublicId.toString(),
        status: identity.getStatus().toString(),
        loginEnabled: identity.isLoginEnabled(),
        version: identity.getVersion()
      };
    });
  }
}
