import type { Queryable } from "../../../shared/database/Queryable.js";
import type { AuditEventRepository } from "../domain/AuditEventRepository.js";
import type { AuditEvent } from "../domain/AuditEvent.js";

/**
 * Implementação MariaDB de AuditEventRepository, conforme
 * docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção 12 (tabela
 * `audit_events`). Somente-append — nunca faz UPDATE ou DELETE.
 */
export class MariaDbAuditEventRepository implements AuditEventRepository {
  public constructor(private readonly connection: Queryable) {}

  public async insert(event: AuditEvent): Promise<void> {
    await this.connection.execute(
      `INSERT INTO audit_events
         (event_public_id, event_type, event_version, aggregate_public_id, actor_public_id,
          correlation_id, causation_id, payload_json, occurred_at, persisted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.eventPublicId,
        event.eventType,
        event.eventVersion,
        event.aggregatePublicId,
        event.actorPublicId,
        event.correlationId,
        event.causationId ?? null,
        JSON.stringify(event.payload),
        event.occurredAt,
        event.persistedAt
      ]
    );
  }

  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    for (const event of events) {
      // eslint-disable-next-line no-await-in-loop -- gravação sequencial
      // dentro da mesma transação; volume por comando é sempre pequeno
      // (um punhado de eventos), inserção em lote com VALUES múltiplos
      // fica para quando o volume justificar a complexidade adicional.
      await this.insert(event);
    }
  }
}
