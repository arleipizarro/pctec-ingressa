import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `application-access.granted`, já catalogado
 * conceitualmente em `docs/02-arquitetura/CATALOGO-DE-EVENTOS.md`
 * (reutilizado, não duplicado — task v0.5.0, seção 13). Payload
 * estendido nesta entrega com `access_profile` (extensão formalizada em
 * ADR-028).
 *
 * Nenhum dado sensível no payload: apenas public_ids, o perfil (um enum
 * fechado, não texto livre) e timestamps.
 */
export interface ApplicationAccessGrantedPayload {
  readonly applicationAccessPublicId: string;
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly accessProfile: string;
}

export type ApplicationAccessGrantedEvent = DomainEvent<"application-access.granted", ApplicationAccessGrantedPayload>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createApplicationAccessGrantedEvent(
  envelope: EventEnvelopeInput,
  payload: ApplicationAccessGrantedPayload
): ApplicationAccessGrantedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "application-access.granted" as const,
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
