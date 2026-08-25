import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

export interface EventEnvelopeInput {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

function envelope(input: EventEnvelopeInput, eventType: string) {
  const base = {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    aggregatePublicId: input.aggregatePublicId,
    actorPublicId: input.actorPublicId,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt
  };
  return input.causationId === undefined ? base : { ...base, causationId: input.causationId };
}

/**
 * Payloads carregam EXCLUSIVAMENTE identificadores e metadados — nunca o
 * código bruto, nunca `codeHash`, nunca `code_verifier`, nunca
 * `code_challenge`, nunca cookie ou token de sessão (checado por teste
 * dedicado). Mesma regra já aplicada a `session.created`.
 *
 * `redirectUri` entra porque é o dado que responde "para onde este
 * código foi autorizado a voltar" — a pergunta central de qualquer
 * auditoria de open redirect — e não é segredo: o próprio cliente o
 * enviou.
 */
export interface SsoAuthorizationCodeIssuedPayload {
  readonly authorizationCodePublicId: string;
  readonly identityPublicId: string;
  readonly audienceApplicationCode: string;
  readonly redirectUri: string;
  readonly expiresAt: string;
}

export type SsoAuthorizationCodeIssuedEvent = DomainEvent<
  "sso.authorization-code.issued",
  SsoAuthorizationCodeIssuedPayload
>;

export function createSsoAuthorizationCodeIssuedEvent(
  input: EventEnvelopeInput,
  payload: SsoAuthorizationCodeIssuedPayload
): SsoAuthorizationCodeIssuedEvent {
  return { ...envelope(input, "sso.authorization-code.issued"), eventType: "sso.authorization-code.issued", payload };
}

export interface SsoAuthorizationCodeConsumedPayload {
  readonly authorizationCodePublicId: string;
  readonly identityPublicId: string;
  readonly audienceApplicationCode: string;
}

export type SsoAuthorizationCodeConsumedEvent = DomainEvent<
  "sso.authorization-code.consumed",
  SsoAuthorizationCodeConsumedPayload
>;

export function createSsoAuthorizationCodeConsumedEvent(
  input: EventEnvelopeInput,
  payload: SsoAuthorizationCodeConsumedPayload
): SsoAuthorizationCodeConsumedEvent {
  return {
    ...envelope(input, "sso.authorization-code.consumed"),
    eventType: "sso.authorization-code.consumed",
    payload
  };
}
