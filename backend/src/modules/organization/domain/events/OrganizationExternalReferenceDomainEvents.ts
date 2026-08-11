import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `organization-external-reference.created`.
 *
 * **Decisão formalizada nesta entrega (G2):** o prompt de implementação
 * levantou explicitamente a possibilidade de `OrganizationExternalReference`
 * não precisar de DomainEvent nesta fase, deixando a decisão a cargo do
 * precedente do repositório. Precedente verificado: **100% das entidades
 * deste repositório que têm um comando de criação de domínio emitem um
 * evento `.created`** (Identity, Session, Credential, ApplicationAccess,
 * Organization, OrganizationRelationship, Membership) — a única exceção
 * é `Application`, que não tem NENHUM comando de criação (só seed
 * técnico de migration), o que não é o caso aqui
 * (`CreateOrganizationExternalReferenceService` existe). Além disso, esta
 * entidade é textualmente descrita como "a ponte de rastreabilidade de
 * toda a migração pelos próximos anos" (ADR-031) — auditoria de quando
 * cada vínculo legado foi registrado é exatamente o tipo de fato que um
 * evento de domínio existe para capturar. Por precedente e por
 * propósito, esta entrega EMITE o evento. `CATALOGO-DE-EVENTOS.md`
 * ganhou uma entrada nova nesta mesma entrega.
 *
 * Nunca inclui `legacy_id` no payload sem necessidade — não é
 * identificador cross-system (ADR-031) e não deve circular
 * desnecessariamente fora do bounded context `organization`. Payload
 * mínimo: apenas os `public_id`s e o `systemCode`/`entityType` (não o
 * dado numérico legado em si).
 */
export interface OrganizationExternalReferenceCreatedPayload {
  readonly organizationExternalReferencePublicId: string;
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
}

export type OrganizationExternalReferenceCreatedEvent = DomainEvent<
  "organization-external-reference.created",
  OrganizationExternalReferenceCreatedPayload
>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createOrganizationExternalReferenceCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: OrganizationExternalReferenceCreatedPayload
): OrganizationExternalReferenceCreatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "organization-external-reference.created" as const,
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
