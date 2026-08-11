import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `organization.created`, já catalogado
 * conceitualmente em `docs/02-arquitetura/CATALOGO-DE-EVENTOS.md`
 * (reutilizado, não duplicado, mesmo princípio já aplicado em
 * `application-access.granted`). Payload contém apenas dados não
 * sensíveis: publicId, type, e presença (não o valor) de documentNumber.
 *
 * `organization.updated` (também já catalogado) não é emitido nesta
 * fatia — G1 não implementa nenhum comando de mutação sobre uma
 * Organization já existente (só `CreateOrganizationService`). Reservado
 * para uma fatia futura, quando um comando de update for aprovado.
 */
export interface OrganizationCreatedPayload {
  readonly organizationPublicId: string;
  readonly type: string;
  readonly hasDocumentNumber: boolean;
}

export type OrganizationCreatedEvent = DomainEvent<"organization.created", OrganizationCreatedPayload>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createOrganizationCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: OrganizationCreatedPayload
): OrganizationCreatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "organization.created" as const,
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
