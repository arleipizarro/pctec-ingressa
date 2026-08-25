import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Eventos de domínio do bounded context `identity`, conforme
 * docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seção 9.
 *
 * Apenas os eventos efetivamente disparados pelos comandos implementados
 * nesta fatia estão presentes aqui. `identity.profile-added` e
 * `identity.profile-removed` foram removidos por ADR-025 e não são
 * reintroduzidos. `identity.anonymized` não é emitido nesta fatia porque
 * `AnonymizeIdentity` não foi implementado (estratégia de anonimização é
 * Pendente de decisão — ver seção 17 do documento de domínio).
 *
 * Nenhum payload contém CPF integral, senha, hash, token, segredo ou ID
 * interno — apenas `public_id` e dados não sensíveis, conforme exigido.
 */

export interface IdentityCreatedPayload {
  readonly publicId: string;
  readonly type: string;
  readonly email: string;
  readonly status: string;
}

export interface IdentityNameUpdatedPayload {
  readonly publicId: string;
  readonly fullName: string;
}

export interface IdentityEmailChangeRequestedPayload {
  readonly publicId: string;
  readonly requestedEmail: string;
}

export interface IdentityEmailChangedPayload {
  readonly publicId: string;
  readonly email: string;
}

export interface IdentityLoginEnabledPayload {
  readonly publicId: string;
}

export interface IdentityLoginDisabledPayload {
  readonly publicId: string;
}

export interface IdentityActivatedPayload {
  readonly publicId: string;
}

export interface IdentityBlockedPayload {
  readonly publicId: string;
  readonly reasonCode?: string;
}

export interface IdentityUnblockedPayload {
  readonly publicId: string;
}

export interface IdentityInactivatedPayload {
  readonly publicId: string;
}

export interface IdentityReactivatedPayload {
  readonly publicId: string;
}

export interface IdentityDeletedPayload {
  readonly publicId: string;
  readonly deletionReason: string;
}

export type IdentityCreatedEvent = DomainEvent<"identity.created", IdentityCreatedPayload>;
export type IdentityNameUpdatedEvent = DomainEvent<"identity.name-updated", IdentityNameUpdatedPayload>;
export type IdentityEmailChangeRequestedEvent = DomainEvent<
  "identity.email-change-requested",
  IdentityEmailChangeRequestedPayload
>;
export type IdentityEmailChangedEvent = DomainEvent<"identity.email-changed", IdentityEmailChangedPayload>;
export type IdentityLoginEnabledEvent = DomainEvent<"identity.login-enabled", IdentityLoginEnabledPayload>;
export type IdentityLoginDisabledEvent = DomainEvent<"identity.login-disabled", IdentityLoginDisabledPayload>;
export type IdentityActivatedEvent = DomainEvent<"identity.activated", IdentityActivatedPayload>;
export type IdentityBlockedEvent = DomainEvent<"identity.blocked", IdentityBlockedPayload>;
export type IdentityUnblockedEvent = DomainEvent<"identity.unblocked", IdentityUnblockedPayload>;
export type IdentityInactivatedEvent = DomainEvent<"identity.inactivated", IdentityInactivatedPayload>;
export type IdentityReactivatedEvent = DomainEvent<"identity.reactivated", IdentityReactivatedPayload>;
export type IdentityDeletedEvent = DomainEvent<"identity.deleted", IdentityDeletedPayload>;

export type IdentityDomainEvent =
  | IdentityCreatedEvent
  | IdentityNameUpdatedEvent
  | IdentityEmailChangeRequestedEvent
  | IdentityEmailChangedEvent
  | IdentityLoginEnabledEvent
  | IdentityLoginDisabledEvent
  | IdentityActivatedEvent
  | IdentityBlockedEvent
  | IdentityUnblockedEvent
  | IdentityInactivatedEvent
  | IdentityReactivatedEvent
  | IdentityDeletedEvent;

/** Parâmetros comuns a todo evento, exigidos pela convenção de auditoria/rastreamento. */
export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

/**
 * Constrói o envelope comum de um evento (eventId, eventVersion=1, e os
 * campos de EventEnvelopeInput), evitando repetição em cada fábrica de
 * evento concreto abaixo.
 */
function buildEnvelope<TEventType extends string>(
  eventType: TEventType,
  envelope: EventEnvelopeInput
): Pick<
  DomainEvent<TEventType>,
  "eventId" | "eventType" | "eventVersion" | "aggregatePublicId" | "actorPublicId" | "correlationId" | "occurredAt"
> & { causationId?: string } {
  const base = {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    aggregatePublicId: envelope.aggregatePublicId,
    actorPublicId: envelope.actorPublicId,
    correlationId: envelope.correlationId,
    occurredAt: envelope.occurredAt
  };
  return envelope.causationId === undefined ? base : { ...base, causationId: envelope.causationId };
}

export function createIdentityCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityCreatedPayload
): IdentityCreatedEvent {
  return { ...buildEnvelope("identity.created", envelope), payload };
}

export function createIdentityNameUpdatedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityNameUpdatedPayload
): IdentityNameUpdatedEvent {
  return { ...buildEnvelope("identity.name-updated", envelope), payload };
}

export function createIdentityEmailChangeRequestedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityEmailChangeRequestedPayload
): IdentityEmailChangeRequestedEvent {
  return { ...buildEnvelope("identity.email-change-requested", envelope), payload };
}

export function createIdentityEmailChangedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityEmailChangedPayload
): IdentityEmailChangedEvent {
  return { ...buildEnvelope("identity.email-changed", envelope), payload };
}

export function createIdentityLoginEnabledEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityLoginEnabledPayload
): IdentityLoginEnabledEvent {
  return { ...buildEnvelope("identity.login-enabled", envelope), payload };
}

export function createIdentityLoginDisabledEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityLoginDisabledPayload
): IdentityLoginDisabledEvent {
  return { ...buildEnvelope("identity.login-disabled", envelope), payload };
}

export function createIdentityActivatedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityActivatedPayload
): IdentityActivatedEvent {
  return { ...buildEnvelope("identity.activated", envelope), payload };
}

export function createIdentityBlockedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityBlockedPayload
): IdentityBlockedEvent {
  return { ...buildEnvelope("identity.blocked", envelope), payload };
}

export function createIdentityUnblockedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityUnblockedPayload
): IdentityUnblockedEvent {
  return { ...buildEnvelope("identity.unblocked", envelope), payload };
}

export function createIdentityInactivatedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityInactivatedPayload
): IdentityInactivatedEvent {
  return { ...buildEnvelope("identity.inactivated", envelope), payload };
}

export function createIdentityReactivatedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityReactivatedPayload
): IdentityReactivatedEvent {
  return { ...buildEnvelope("identity.reactivated", envelope), payload };
}

export function createIdentityDeletedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityDeletedPayload
): IdentityDeletedEvent {
  return { ...buildEnvelope("identity.deleted", envelope), payload };
}

/**
 * Evento `identity.discarded` — descarte FÍSICO de uma Identity PENDING
 * que nunca foi usada.
 *
 * Distinto de `identity.deleted`, que é exclusão LÓGICA e preserva a
 * linha: aqui a linha deixa de existir, e este evento passa a ser o
 * único registro de que ela existiu. Por isso o payload carrega o
 * `reasonCode` — sem ele, a trilha diria "algo foi apagado" sem dizer
 * por quê, justamente no caso em que não há mais nada para consultar.
 *
 * Nunca carrega nome, e-mail ou CPF: descartar dado de teste não é
 * motivo para copiá-lo para a trilha.
 */
export interface IdentityDiscardedPayload {
  readonly publicId: string;
  readonly reasonCode: string;
}

export type IdentityDiscardedEvent = DomainEvent<"identity.discarded", IdentityDiscardedPayload>;

export function createIdentityDiscardedEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityDiscardedPayload
): IdentityDiscardedEvent {
  return { ...buildEnvelope("identity.discarded", envelope), payload };
}
