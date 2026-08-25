import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

function envelope(input: EventEnvelopeInput) {
  const base = {
    eventId: randomUUID(),
    eventVersion: 1,
    aggregatePublicId: input.aggregatePublicId,
    actorPublicId: input.actorPublicId,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt
  };
  return input.causationId === undefined ? base : { ...base, causationId: input.causationId };
}

/**
 * Payloads carregam SOMENTE identificadores e metadados — nunca o token
 * bruto, nunca o hash, nunca a senha escolhida, nunca o link. Auditar um
 * convite é registrar que ele existiu, para quem e quando; o token não
 * acrescenta nada a isso e transformaria a trilha de auditoria num
 * repositório de credenciais.
 */
export interface InvitationCreatedPayload {
  readonly invitationPublicId: string;
  readonly identityPublicId: string;
  readonly deliveryMode: string;
  readonly expiresAt: string;
}

export type InvitationCreatedEvent = DomainEvent<"identity-invitation.created", InvitationCreatedPayload>;

export function createInvitationCreatedEvent(
  input: EventEnvelopeInput,
  payload: InvitationCreatedPayload
): InvitationCreatedEvent {
  return { ...envelope(input), eventType: "identity-invitation.created", payload };
}

export interface InvitationConsumedPayload {
  readonly invitationPublicId: string;
  readonly identityPublicId: string;
  readonly credentialPublicId: string;
}

export type InvitationConsumedEvent = DomainEvent<"identity-invitation.consumed", InvitationConsumedPayload>;

export function createInvitationConsumedEvent(
  input: EventEnvelopeInput,
  payload: InvitationConsumedPayload
): InvitationConsumedEvent {
  return { ...envelope(input), eventType: "identity-invitation.consumed", payload };
}

export interface InvitationRevokedPayload {
  readonly invitationPublicId: string;
  readonly identityPublicId: string;
  readonly reason: string;
}

export type InvitationRevokedEvent = DomainEvent<"identity-invitation.revoked", InvitationRevokedPayload>;

export function createInvitationRevokedEvent(
  input: EventEnvelopeInput,
  payload: InvitationRevokedPayload
): InvitationRevokedEvent {
  return { ...envelope(input), eventType: "identity-invitation.revoked", payload };
}
