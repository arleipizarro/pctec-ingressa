import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `credential.created` (ADR-029) — distinto de
 * `credential.changed` (já catalogado, reservado para alterações a uma
 * credencial existente, ex.: troca de senha futura).
 *
 * Payload contém EXCLUSIVAMENTE identificadores e metadados — nunca
 * senha, hash, salt ou qualquer parâmetro derivado da senha (checado por
 * teste dedicado).
 */
export interface CredentialCreatedPayload {
  readonly credentialPublicId: string;
  readonly identityPublicId: string;
  readonly type: string;
}

export type CredentialCreatedEvent = DomainEvent<"credential.created", CredentialCreatedPayload>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createCredentialCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: CredentialCreatedPayload
): CredentialCreatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "credential.created" as const,
    eventVersion: 1,
    aggregatePublicId: envelope.aggregatePublicId,
    actorPublicId: envelope.actorPublicId,
    correlationId: envelope.correlationId,
    occurredAt: envelope.occurredAt
  };
  return {
    ...(envelope.causationId === undefined ? base : { ...base, causationId: envelope.causationId }),
    payload
  };
}
