import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../../../../shared/types/DomainEvent.js";

/**
 * Evento `auth.rate-limit.blocked`.
 *
 * ## O que ele NÃO carrega, e por quê
 *
 * Nem IP, nem e-mail, nem o digest do contador. O digest parece
 * inofensivo, mas o espaço de endereços IPv4 é pequeno o bastante para
 * ser percorrido inteiro em minutos — gravar o digest de um IP é gravar
 * o IP com um passo a mais. E-mail idem: quem tem a lista de
 * colaboradores confere qualquer digest. `auth_rate_limit_counters`
 * existe justamente para NÃO virar uma lista de quem tentou entrar, e a
 * auditoria não pode desfazer isso.
 *
 * Sobra o que a operação de fato precisa: que um limite foi atingido,
 * qual escopo, com que teto e em que janela. É o suficiente para
 * alertar sobre volume anômalo e para ajustar a configuração. Investigar
 * um caso específico é trabalho de log de borda (Nginx), que já tem o IP
 * legitimamente e com retenção própria — não do registro permanente de
 * auditoria do servidor de identidade.
 *
 * ## Por que só na TRANSIÇÃO
 *
 * O evento é emitido apenas na requisição que CRUZA o limite, nunca nas
 * seguintes da mesma janela. Auditar toda requisição barrada entregaria
 * a quem ataca uma escrita em banco por requisição — o limitador viraria
 * amplificador do ataque que existe para conter. Uma linha por contador
 * por janela é um teto conhecido.
 */
export interface AuthRateLimitBlockedPayload {
  /** `IP` ou `IP_IDENTIFIER` — nunca o valor que originou o contador. */
  readonly scopeKind: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export type AuthRateLimitBlockedEvent = DomainEvent<"auth.rate-limit.blocked", AuthRateLimitBlockedPayload>;

export interface AuthRateLimitEventEnvelope {
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly occurredAt: Date;
}

export function createAuthRateLimitBlockedEvent(
  envelope: AuthRateLimitEventEnvelope,
  payload: AuthRateLimitBlockedPayload
): AuthRateLimitBlockedEvent {
  const base = {
    eventId: randomUUID(),
    eventType: "auth.rate-limit.blocked" as const,
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
