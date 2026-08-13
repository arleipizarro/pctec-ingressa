import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `identity-external-reference.created`.
 *
 * Mesmo precedente de `organization-external-reference.created`
 * (migration 0013 / OrganizationExternalReferenceDomainEvents.ts): 100%
 * das entidades deste repositório que têm um comando de criação de
 * domínio emitem um evento `.created`. Esta entidade tem
 * `CreateIdentityExternalReferenceService`, portanto emite.
 *
 * Payload mínimo: apenas os `public_id`s, `systemCode`, `entityType` e
 * `matchMethod`. `legacyId` NÃO incluído no payload — não é
 * identificador cross-system e não deve circular desnecessariamente
 * fora do bounded context identity.
 */
export interface IdentityExternalReferenceCreatedPayload {
  readonly identityExternalReferencePublicId: string;
  readonly identityPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly matchMethod: string;
}

export type IdentityExternalReferenceCreatedEvent = DomainEvent<
  "identity-external-reference.created",
  IdentityExternalReferenceCreatedPayload
>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createIdentityExternalReferenceCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityExternalReferenceCreatedPayload
): IdentityExternalReferenceCreatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "identity-external-reference.created" as const,
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
