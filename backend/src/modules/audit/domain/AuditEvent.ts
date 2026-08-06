import type { DomainEvent } from "../../../shared/types/DomainEvent.js";

/**
 * AuditEvent — registro imutável de auditoria, conforme
 * docs/03-dominio/MODELO-DE-DOMINIO.md (entidade AuditEvent) e a seção 12
 * do prompt de implementação desta fatia.
 *
 * Consome eventos de domínio produzidos por outros bounded contexts
 * (nesta fatia, exclusivamente `identity`) e os torna persistíveis de
 * forma append-only — nunca é atualizado ou apagado após criação.
 */
export class AuditEvent {
  private constructor(
    public readonly eventPublicId: string,
    public readonly eventType: string,
    public readonly eventVersion: number,
    public readonly aggregatePublicId: string,
    public readonly actorPublicId: string,
    public readonly correlationId: string,
    public readonly causationId: string | undefined,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    public readonly persistedAt: Date
  ) {}

  /**
   * Constrói um AuditEvent a partir de um DomainEvent genérico (produzido
   * por qualquer Aggregate), carimbando `persistedAt` no momento em que
   * o evento é entregue para gravação.
   */
  public static fromDomainEvent(event: DomainEvent, persistedAt: Date = new Date()): AuditEvent {
    return new AuditEvent(
      event.eventId,
      event.eventType,
      event.eventVersion,
      event.aggregatePublicId,
      event.actorPublicId,
      event.correlationId,
      event.causationId,
      event.payload as Readonly<Record<string, unknown>>,
      event.occurredAt,
      persistedAt
    );
  }

  /** Reconstrói um AuditEvent a partir de uma linha já persistida. */
  public static reconstitute(props: {
    eventPublicId: string;
    eventType: string;
    eventVersion: number;
    aggregatePublicId: string;
    actorPublicId: string;
    correlationId: string;
    causationId: string | undefined;
    payload: Readonly<Record<string, unknown>>;
    occurredAt: Date;
    persistedAt: Date;
  }): AuditEvent {
    return new AuditEvent(
      props.eventPublicId,
      props.eventType,
      props.eventVersion,
      props.aggregatePublicId,
      props.actorPublicId,
      props.correlationId,
      props.causationId,
      props.payload,
      props.occurredAt,
      props.persistedAt
    );
  }
}
