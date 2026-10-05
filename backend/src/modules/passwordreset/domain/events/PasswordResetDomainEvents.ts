import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

export interface PasswordResetEventEnvelope {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

function envelope(input: PasswordResetEventEnvelope) {
  const base = {
    eventId: randomUUID(),
    eventVersion: 1,
    aggregatePublicId: input.aggregatePublicId,
    actorPublicId: input.actorPublicId,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt
  };
  return input.causationId === undefined ? base : { ...base, causationId: input.causationId };
}

/**
 * `aggregate_public_id` dos pedidos que NÃO têm Identity por trás — o
 * e-mail informado não corresponde a ninguém.
 *
 * A coluna é `NOT NULL`, então o pedido vai para um valor FIXO e
 * documentado que representa "o formulário Esqueci minha senha", mesmo
 * raciocínio de `AUTH_RATE_LIMIT_AGGREGATE_PUBLIC_ID`. Nunca o
 * `publicId` de nada real.
 */
export const PASSWORD_RESET_FORM_AGGREGATE_PUBLIC_ID = "00000000-0000-4000-8000-0000000000a2";

/** Ator quando ninguém se autenticou — quem decide é o servidor. */
export const PASSWORD_RESET_SYSTEM_ACTOR = "SYSTEM" as const;

/**
 * Desfecho de um pedido "Esqueci minha senha".
 *
 * Existe SÓ para a trilha de auditoria: a resposta HTTP é a mesma em
 * todos os casos, e é justamente por isso que o motivo precisa ficar
 * registrado aqui — senão um titular com login desabilitado pedindo
 * redefinição seria invisível para o ADMIN.
 */
export type PasswordResetRequestOutcome =
  /** Link emitido e entregue ao adaptador de e-mail. */
  | "ISSUED"
  /** Nenhuma Identity com esse e-mail. */
  | "IGNORED_UNKNOWN_EMAIL"
  /** Identity existe mas não está ACTIVE (PENDING, BLOCKED, INACTIVE...). */
  | "IGNORED_IDENTITY_NOT_ACTIVE"
  /** Identity ACTIVE com `login_enabled = 0` — sem regra explícita, não redefine. */
  | "IGNORED_LOGIN_DISABLED"
  /** Nunca definiu senha: o caminho é o convite de primeiro acesso, não a redefinição. */
  | "IGNORED_NO_CREDENTIAL"
  /** Teto de pedidos por titular na janela foi atingido. */
  | "THROTTLED"
  /** `INGRESSA_PUBLIC_BASE_URL` ausente — não há como montar o link. */
  | "IGNORED_LINK_NOT_CONFIGURED";

/**
 * Payloads carregam SOMENTE identificadores e metadados — nunca o
 * e-mail digitado, nunca o token, nunca o hash, nunca o link, nunca a
 * senha. Nomes de campo evitam `token`/`password` de propósito: a
 * redação da tela de auditoria esconderia o valor (ver
 * `redactionPolicy`), e um identificador escondido não serve para nada.
 *
 * `identityPublicId` só existe quando o e-mail correspondia a alguém. O
 * e-mail em si NUNCA é gravado: a auditoria não pode virar uma lista de
 * endereços que alguém testou no formulário.
 */
export interface PasswordResetRequestedPayload {
  readonly outcome: PasswordResetRequestOutcome;
  readonly identityPublicId?: string;
  readonly resetRequestPublicId?: string;
  readonly expiresAt?: string;
  /** Pedidos anteriores ainda abertos que este revogou. */
  readonly supersededCount?: number;
}

export type PasswordResetRequestedEvent = DomainEvent<"password-reset.requested", PasswordResetRequestedPayload>;

export function createPasswordResetRequestedEvent(
  input: PasswordResetEventEnvelope,
  payload: PasswordResetRequestedPayload
): PasswordResetRequestedEvent {
  return { ...envelope(input), eventType: "password-reset.requested", payload };
}

export interface PasswordResetDeliveryFailedPayload {
  readonly resetRequestPublicId: string;
  readonly identityPublicId: string;
}

export type PasswordResetDeliveryFailedEvent = DomainEvent<
  "password-reset.delivery-failed",
  PasswordResetDeliveryFailedPayload
>;

export function createPasswordResetDeliveryFailedEvent(
  input: PasswordResetEventEnvelope,
  payload: PasswordResetDeliveryFailedPayload
): PasswordResetDeliveryFailedEvent {
  return { ...envelope(input), eventType: "password-reset.delivery-failed", payload };
}

export interface PasswordResetCompletedPayload {
  readonly resetRequestPublicId: string;
  readonly identityPublicId: string;
  readonly credentialPublicId: string;
  readonly revokedSessions: number;
}

export type PasswordResetCompletedEvent = DomainEvent<"password-reset.completed", PasswordResetCompletedPayload>;

export function createPasswordResetCompletedEvent(
  input: PasswordResetEventEnvelope,
  payload: PasswordResetCompletedPayload
): PasswordResetCompletedEvent {
  return { ...envelope(input), eventType: "password-reset.completed", payload };
}
