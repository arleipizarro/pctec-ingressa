import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `session.created` (ADR-030, já catalogado desde
 * v0.2.0 em `CATALOGO-DE-EVENTOS.md` — reutilizado, não duplicado).
 *
 * Payload contém EXCLUSIVAMENTE identificadores e metadados — nunca o
 * token bruto, nunca `tokenHash`, nunca password/hash, nunca cookie,
 * nunca header `Authorization` (checado por teste dedicado).
 */
export interface SessionCreatedPayload {
  readonly sessionPublicId: string;
  readonly identityPublicId: string;
  readonly expiresAt: string; // ISO 8601 — DomainEvent payloads são serializáveis, Date não é usado diretamente aqui
}

export type SessionCreatedEvent = DomainEvent<"session.created", SessionCreatedPayload>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createSessionCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: SessionCreatedPayload
): SessionCreatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "session.created" as const,
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

/**
 * Evento de domínio `session.revoked` (ADR-030, já catalogado desde
 * v0.2.0 em `CATALOGO-DE-EVENTOS.md` — reutilizado, não duplicado).
 *
 * Payload contém EXCLUSIVAMENTE identificadores e metadados — nunca o
 * token bruto, nunca `tokenHash`, nunca cookie, nunca header
 * `Authorization` (checado por teste dedicado). `actorPublicId` é a
 * própria `Identity` que solicitou o logout (v0.6.x, Fase E) — mesmo
 * princípio já usado por `session.created`.
 */
export interface SessionRevokedPayload {
  readonly sessionPublicId: string;
  readonly identityPublicId: string;
  readonly reason: string;
}

export type SessionRevokedEvent = DomainEvent<"session.revoked", SessionRevokedPayload>;

export function createSessionRevokedEvent(
  envelope: EventEnvelopeInput,
  payload: SessionRevokedPayload
): SessionRevokedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "session.revoked" as const,
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
