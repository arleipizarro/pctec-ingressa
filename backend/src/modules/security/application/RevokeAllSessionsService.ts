import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { Session } from "../domain/session/Session.js";

/**
 * Porta estreita: só o que revogar em massa precisa.
 *
 * `SessionRepository` declara `findActiveByIdentityPublicId` como
 * opcional (nem todo consumidor precisa dele). Aqui ele é OBRIGATÓRIO —
 * um repositório que não saiba listar sessões ativas não serve para
 * revogá-las, e descobrir isso em runtime seria tarde.
 */
export interface SessionRevocationRepository {
  findActiveByIdentityPublicId(identityPublicId: string): Promise<readonly Session[]>;
  update(session: Session, expectedVersion: number): Promise<void>;
}

export interface RevokeAllSessionsRequest {
  readonly identityPublicId: string;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly reason?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface RevokeAllSessionsResult {
  readonly revoked: number;
}

/** Motivo padrão — revogação administrativa, distinta de um logout do titular. */
export const ADMIN_REVOCATION_REASON = "ADMIN_ACTION" as const;

/**
 * Revoga TODAS as sessões ativas de uma Identity, numa transação.
 *
 * **Idempotente:** zero sessões ativas não é erro — devolve
 * `revoked: 0`. Quem clicou queria que não sobrasse nenhuma sessão, e
 * esse é exatamente o estado final nos dois casos.
 *
 * Revoga uma a uma pelo agregado (`Session.revoke`), e não com um
 * `UPDATE ... WHERE identity = ?` de uma linha só: cada revogação produz
 * o evento `session.revoked` com o ator real, e é isso que mantém a
 * trilha de auditoria completa. Um UPDATE em massa apagaria o rastro de
 * quantas sessões existiam e de quem as encerrou.
 *
 * `expectedVersion` é a versão lida ANTES da mutação — se outra escrita
 * passar no meio, aquela sessão específica falha em vez de sobrescrever
 * decisão alheia.
 */
export class RevokeAllSessionsService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessionRepositoryFactory: (connection: Queryable) => SessionRevocationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: RevokeAllSessionsRequest): Promise<RevokeAllSessionsResult> {
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const sessionRepository = this.sessionRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const revogadas = await revogarSessoesAtivas(sessionRepository, {
        identityPublicId: request.identityPublicId,
        actorPublicId: request.actorPublicId,
        reason: request.reason ?? ADMIN_REVOCATION_REASON,
        correlationId
      });

      if (revogadas.length > 0) {
        await auditEventRepository.insertMany(
          revogadas.flatMap((sessao) => sessao.pullDomainEvents()).map((evento) => AuditEvent.fromDomainEvent(evento))
        );
      }

      return { revoked: revogadas.length };
    });
  }
}

/**
 * Revogação reutilizável, para ser chamada DENTRO de uma transação já
 * aberta por outro caso de uso.
 *
 * Existe porque bloquear uma Identity precisa revogar as sessões na
 * MESMA transação: se o bloqueio commitasse e a revogação falhasse
 * depois, a pessoa ficaria bloqueada com sessão viva — o pior dos dois
 * estados. Os eventos ficam pendentes nos agregados devolvidos; quem
 * chama decide quando gravá-los.
 */
export async function revogarSessoesAtivas(
  sessionRepository: SessionRevocationRepository,
  input: {
    readonly identityPublicId: string;
    readonly actorPublicId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now?: Date | undefined;
  }
): Promise<readonly Session[]> {
  const ativas = await sessionRepository.findActiveByIdentityPublicId(input.identityPublicId);
  const agora = input.now ?? new Date();

  const revogadas: Session[] = [];
  for (const sessao of ativas) {
    const versaoOriginal = sessao.getVersion();
    sessao.revoke({
      reason: input.reason,
      actorPublicId: input.actorPublicId,
      correlationId: input.correlationId,
      now: agora
    });
    // eslint-disable-next-line no-await-in-loop -- optimistic locking por sessão; paralelizar tiraria a granularidade do conflito.
    await sessionRepository.update(sessao, versaoOriginal);
    revogadas.push(sessao);
  }
  return revogadas;
}
