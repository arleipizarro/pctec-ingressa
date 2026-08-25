import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { InvitationRepository } from "../domain/InvitationRepository.js";
import type { Invitation } from "../domain/Invitation.js";

export class FakeUnitOfWork implements UnitOfWork {
  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    return work({ execute: async () => [[], []] });
  }
}

export class FakeAuditEventRepository implements AuditEventRepository {
  public readonly eventos: AuditEvent[] = [];
  public async insert(event: AuditEvent): Promise<void> {
    this.eventos.push(event);
  }
  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.eventos.push(...events);
  }
  public tipos(): readonly string[] {
    return this.eventos.map((evento) => evento.eventType);
  }
}

/**
 * Convites em memória com a MESMA semântica de consumo do MariaDB: só
 * consome o que está PENDING e dentro da validade, marcando no mesmo
 * passo. É essa semântica que os testes de replay e concorrência
 * exercitam.
 */
export class FakeInvitationRepository implements InvitationRepository {
  public readonly porTokenHash = new Map<string, Invitation>();

  public async insert(invitation: Invitation): Promise<void> {
    this.porTokenHash.set(invitation.getTokenHash(), invitation);
  }

  public async revokePendingByIdentity(
    identityPublicId: string,
    now: Date,
    reason: string
  ): Promise<readonly Invitation[]> {
    const pendentes = [...this.porTokenHash.values()].filter(
      (convite) => convite.getIdentityPublicId() === identityPublicId && convite.getStatus() === "PENDING"
    );
    for (const convite of pendentes) {
      convite.markRevoked(now, reason);
    }
    return pendentes;
  }

  public async findUsableByTokenHash(tokenHash: string, now: Date): Promise<Invitation | undefined> {
    const convite = this.porTokenHash.get(tokenHash);
    return convite !== undefined && convite.isUsable(now) ? convite : undefined;
  }

  public async consumeByTokenHash(tokenHash: string, now: Date): Promise<Invitation | undefined> {
    const convite = this.porTokenHash.get(tokenHash);
    if (convite === undefined || !convite.isUsable(now)) {
      return undefined;
    }
    convite.markConsumed(now);
    return convite;
  }
}
