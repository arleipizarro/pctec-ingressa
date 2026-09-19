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

/**
 * Evento de domínio `identity-external-reference.superseded` — fundação
 * PCTEC Meu RH.
 *
 * Registra que um binding deixou de valer. É o par obrigatório de
 * `.created`: sem ele, a única forma de descobrir que um vínculo mudou
 * seria comparar o `status` da linha com uma memória que ninguém tem.
 *
 * **`replacedByPublicId` fecha a cadeia.** Quando a correção substitui o
 * vínculo, este campo aponta para a referência nova, e o `.created` dela
 * carrega o `causationId` deste evento. A auditoria fica navegável nos
 * dois sentidos — "o que substituiu isto?" e "por causa de quê isto
 * nasceu?" — sem nenhum join por horário de gravação.
 *
 * **Payload sem dado pessoal e sem `legacyId`**, pelo mesmo critério do
 * `.created`: `legacyId` não é identificador cross-system e não precisa
 * circular. `reason` é enum fechado (`SupersedeReason`), nunca texto
 * livre — ver o raciocínio no próprio Value Object.
 */
export interface IdentityExternalReferenceSupersededPayload {
  readonly identityExternalReferencePublicId: string;
  readonly identityPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly reason: string;
  /** `publicId` da referência que assumiu o binding, quando houve substituição. */
  readonly replacedByPublicId?: string;
}

export type IdentityExternalReferenceSupersededEvent = DomainEvent<
  "identity-external-reference.superseded",
  IdentityExternalReferenceSupersededPayload
>;

export function createIdentityExternalReferenceSupersededEvent(
  envelope: EventEnvelopeInput,
  payload: IdentityExternalReferenceSupersededPayload
): IdentityExternalReferenceSupersededEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "identity-external-reference.superseded" as const,
    // Versão 1 — primeiro formato deste evento. Acrescentar campo
    // opcional mantém a versão; remover ou reinterpretar campo exige
    // bump, mesma convenção dos demais eventos desta base.
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

/** União dos eventos que `IdentityExternalReference` pode produzir. */
export type IdentityExternalReferenceDomainEvent =
  | IdentityExternalReferenceCreatedEvent
  | IdentityExternalReferenceSupersededEvent;
