import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import {
  revogarSessoesAtivas,
  type SessionRevocationRepository
} from "../../security/application/RevokeAllSessionsService.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import { IdentityNotFoundError } from "../domain/errors/IdentityErrors.js";

export interface BlockIdentityRequest {
  readonly identityPublicId: string;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly expectedVersion: number;
  readonly reasonCode?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface BlockIdentityResult {
  readonly identityPublicId: string;
  readonly status: string;
  readonly version: number;
  readonly sessionsRevoked: number;
}

/** Motivo padrão da revogação disparada por bloqueio. */
const MOTIVO_DA_REVOGACAO = "IDENTITY_BLOCKED" as const;

/**
 * Bloqueia uma Identity e derruba suas sessões — **na mesma transação**.
 *
 * Atomicidade não é detalhe aqui. Se o bloqueio commitasse e a revogação
 * falhasse depois, a pessoa ficaria bloqueada com sessão viva: incapaz
 * de autenticar de novo, mas seguindo autenticada nas aplicações que só
 * revalidam o cookie. É o pior dos dois estados, e o mais difícil de
 * perceber.
 *
 * **Bloquear não apaga nada.** Memberships, `ApplicationAccess` e
 * referências externas permanecem exatamente como estavam — o que muda é
 * o `status` da Identity, e é ele que `ValidateSessionService` e
 * `AuthorizeApplicationAccessService` consultam a cada requisição. Uma
 * Identity federada com `login_enabled = 0` também pode ser bloqueada, e
 * é justamente o caso em que o bloqueio importa: ela nunca autentica no
 * Ingressa, mas o contexto empresarial que as aplicações consomem passa
 * a ser negado imediatamente.
 *
 * **Nunca DELETE.** A exclusão lógica é outra transição, com outra
 * semântica e outro comando de domínio.
 *
 * **Conflito explícito, não idempotência silenciosa:** `BLOCKED →
 * BLOCKED` não é uma transição permitida (`IdentityStatus`), então
 * bloquear quem já está bloqueado falha com
 * `InvalidIdentityStatusTransitionError` em vez de responder "ok" a uma
 * operação que não aconteceu. `expectedVersion` garante o mesmo contra
 * uma tela desatualizada.
 *
 * Desbloqueio NÃO faz parte desta fatia: `Identity.unblock()` existe no
 * domínio, mas expor a transição inversa pede sua própria decisão sobre
 * quem pode reabrir um acesso, e ela não foi tomada aqui.
 */
export class BlockIdentityService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly sessionRepositoryFactory: (connection: Queryable) => SessionRevocationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: BlockIdentityRequest): Promise<BlockIdentityResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const identityPublicId = PublicId.fromString(request.identityPublicId);
    const actor = ActorPublicId.fromIdentityPublicId(PublicId.fromString(request.actorPublicId));

    return this.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.identityRepositoryFactory(connection);
      const sessionRepository = this.sessionRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const identity = await identityRepository.findByPublicId(identityPublicId);
      if (identity === undefined) {
        throw new IdentityNotFoundError(identityPublicId.toString());
      }

      const versaoOriginal = identity.getVersion();
      identity.block({
        actor,
        expectedVersion: request.expectedVersion,
        correlationId,
        ...(request.reasonCode === undefined ? {} : { reasonCode: request.reasonCode })
      });
      await identityRepository.update(identity, versaoOriginal);

      // Mesma transação: ou a pessoa fica bloqueada E sem sessão, ou
      // nada aconteceu.
      const sessoesRevogadas = await revogarSessoesAtivas(sessionRepository, {
        identityPublicId: identityPublicId.toString(),
        actorPublicId: request.actorPublicId,
        reason: MOTIVO_DA_REVOGACAO,
        correlationId
      });

      const eventos = [
        ...identity.pullDomainEvents(),
        ...sessoesRevogadas.flatMap((sessao) => sessao.pullDomainEvents())
      ];
      await auditEventRepository.insertMany(eventos.map((evento) => AuditEvent.fromDomainEvent(evento)));

      return {
        identityPublicId: identityPublicId.toString(),
        status: identity.getStatus().toString(),
        version: identity.getVersion(),
        sessionsRevoked: sessoesRevogadas.length
      };
    });
  }
}
