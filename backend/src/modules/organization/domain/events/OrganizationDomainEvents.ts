import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `organization.created`, já catalogado
 * conceitualmente em `docs/02-arquitetura/CATALOGO-DE-EVENTOS.md`
 * (reutilizado, não duplicado, mesmo princípio já aplicado em
 * `application-access.granted`). Payload contém apenas dados não
 * sensíveis: publicId, type, e presença (não o valor) de documentNumber.
 *
 * `organization.updated` passou a ser emitido na v0.10.1, quando o
 * primeiro comando de mutação foi aprovado: correção administrativa de
 * razão social e nome fantasia. Continua valendo a regra do payload —
 * ele carrega quais campos mudaram, nunca os valores. O antes/depois
 * completo vive na trilha de auditoria da própria linha, não no evento
 * distribuído: nome de empresa é dado de cliente, e um evento é lido
 * por mais gente do que a tabela.
 */
export interface OrganizationCreatedPayload {
  readonly organizationPublicId: string;
  readonly type: string;
  readonly hasDocumentNumber: boolean;
}

export type OrganizationCreatedEvent = DomainEvent<"organization.created", OrganizationCreatedPayload>;

export interface OrganizationUpdatedPayload {
  readonly organizationPublicId: string;
  /** Campos alterados por este comando — nomes, nunca valores. */
  readonly changedFields: readonly string[];
  readonly previousVersion: number;
  readonly version: number;
}

export type OrganizationUpdatedEvent = DomainEvent<"organization.updated", OrganizationUpdatedPayload>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createOrganizationUpdatedEvent(
  envelope: EventEnvelopeInput,
  payload: OrganizationUpdatedPayload
): OrganizationUpdatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "organization.updated" as const,
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
