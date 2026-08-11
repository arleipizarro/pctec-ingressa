import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `membership.created`, já catalogado em
 * `docs/02-arquitetura/CATALOGO-DE-EVENTOS.md` (reutilizado, não
 * duplicado). Payload conforme o catálogo já existente: `membership_id`,
 * `identity_id`, `organization_id`, `scope`, `created_at` — não inclui
 * `profile` no payload mínimo do catálogo (decisão pré-existente, não
 * alterada nesta entrega).
 *
 * `membership.updated` (também já catalogado, cobre alteração/
 * encerramento) não é emitido nesta fatia — G2 não implementa nenhum
 * comando de mutação sobre um Membership já existente (só
 * `CreateMembershipService`).
 */
export interface MembershipCreatedPayload {
  readonly membershipPublicId: string;
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly scope: string;
}

export type MembershipCreatedEvent = DomainEvent<"membership.created", MembershipCreatedPayload>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createMembershipCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: MembershipCreatedPayload
): MembershipCreatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "membership.created" as const,
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
