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
 * encerramento) passou a ser emitido em P1D.1, pelo comando
 * `Membership.end()` — o encerramento de vínculo que o design de G2 já
 * havia decidido e deixado fora de escopo. Nenhum evento novo foi
 * inventado: o catálogo já previa este.
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

/**
 * Payload de `membership.updated` para o encerramento de vínculo.
 *
 * Registra a transição de `status` de forma explícita (`ACTIVE` →
 * `INACTIVE`) e o motivo textual informado pelo operador — é o que
 * torna a auditoria legível meses depois, quando "por que este acesso
 * saiu?" for a pergunta. `endedAt` fecha a janela temporal do vínculo.
 *
 * Nunca carrega dados da Identity (nome/e-mail/CPF) nem da Organization
 * além do `publicId`: o evento é sobre o VÍNCULO, e o restante já é
 * recuperável pelos aggregates referenciados.
 */
export interface MembershipUpdatedPayload {
  readonly membershipPublicId: string;
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly previousStatus: string;
  readonly status: string;
  readonly endedAt: string;
  readonly reason: string;
}

export type MembershipUpdatedEvent = DomainEvent<"membership.updated", MembershipUpdatedPayload>;

export function createMembershipUpdatedEvent(
  envelope: EventEnvelopeInput,
  payload: MembershipUpdatedPayload
): MembershipUpdatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "membership.updated" as const,
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
