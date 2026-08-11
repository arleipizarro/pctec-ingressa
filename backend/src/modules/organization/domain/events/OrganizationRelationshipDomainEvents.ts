import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento de domínio `organization-relationship.created`.
 *
 * **Decisão formalizada (G1 — v0.6.x, mini revisão arquitetural antes do
 * fechamento de G1):** `docs/02-arquitetura/CATALOGO-DE-EVENTOS.md`
 * (seção `organization.updated`, redação anterior) antecipava que
 * mudanças em `OrganizationRelationship` seriam reportadas via
 * `organization.updated`. Comparado formalmente contra criar um evento
 * próprio, e decidido por um evento dedicado, com base no precedente
 * direto já existente no repositório: `ApplicationAccess` (vínculo entre
 * `Identity` e `Application`, estruturalmente idêntico a
 * `OrganizationRelationship`) já tem evento próprio
 * (`application-access.granted`), não é dobrado em
 * `identity.updated`/`application.updated`. Além disso, a criação de um
 * `OrganizationRelationship` não altera nenhuma coluna de `organizations`
 * (sem `version`/`updated_at` bump — migration 0010) e envolve DUAS
 * Organizations (parent e child), incompatível com o
 * `aggregatePublicId` único de um evento `organization.updated`.
 * `CATALOGO-DE-EVENTOS.md` foi atualizado nesta mesma entrega para
 * refletir esta decisão.
 */
export interface OrganizationRelationshipCreatedPayload {
  readonly organizationRelationshipPublicId: string;
  readonly parentOrganizationPublicId: string;
  readonly childOrganizationPublicId: string;
}

export type OrganizationRelationshipCreatedEvent = DomainEvent<
  "organization-relationship.created",
  OrganizationRelationshipCreatedPayload
>;

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export function createOrganizationRelationshipCreatedEvent(
  envelope: EventEnvelopeInput,
  payload: OrganizationRelationshipCreatedPayload
): OrganizationRelationshipCreatedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "organization-relationship.created" as const,
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
