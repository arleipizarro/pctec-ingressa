import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Eventos de concessão e revogação de PERFIL DE APLICAÇÃO — a camada 2
 * de ADR-007, agora com registro oficial no Ingressa.
 *
 * São irmãos de `application-access.granted/revoked` e existem
 * separados por uma razão concreta: conceder acesso ao produto e
 * conceder um perfil DENTRO do produto são decisões diferentes, tomadas
 * por gente diferente em momentos diferentes. Misturá-las num evento só
 * tornaria impossível responder "quem virou responsável pelo RH e
 * quando?" sem inspecionar payload.
 *
 * Nenhum dado sensível no payload: apenas public_ids e o código do
 * perfil, que é um identificador técnico de catálogo, nunca texto livre
 * de usuário.
 */

export interface ApplicationRoleGrantedPayload {
  readonly assignmentPublicId: string;
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly roleCode: string;
}

export type ApplicationRoleGrantedEvent = DomainEvent<"application-role.granted", ApplicationRoleGrantedPayload>;

export interface ApplicationRoleRevokedPayload {
  readonly assignmentPublicId: string;
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly roleCode: string;
}

export type ApplicationRoleRevokedEvent = DomainEvent<"application-role.revoked", ApplicationRoleRevokedPayload>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

function montar<TType extends string, TPayload>(
  eventType: TType,
  envelope: EventEnvelopeInput,
  payload: TPayload
): DomainEvent<TType, TPayload> {
  const base = {
    eventId: randomUUID(),
    eventType,
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

export function createApplicationRoleGrantedEvent(
  envelope: EventEnvelopeInput,
  payload: ApplicationRoleGrantedPayload
): ApplicationRoleGrantedEvent {
  return montar("application-role.granted", envelope, payload);
}

export function createApplicationRoleRevokedEvent(
  envelope: EventEnvelopeInput,
  payload: ApplicationRoleRevokedPayload
): ApplicationRoleRevokedEvent {
  return montar("application-role.revoked", envelope, payload);
}
