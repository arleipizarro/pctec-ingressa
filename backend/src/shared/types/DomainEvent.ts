/**
 * Formato mínimo conceitual de um evento de domínio, comum a todos os
 * bounded contexts, conforme
 * docs/02-arquitetura/CATALOGO-DE-EVENTOS.md e
 * docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seção 9.
 *
 * Eventos são produzidos em memória pelo Aggregate e coletados pelo
 * Application Service para persistência de auditoria — nesta fatia não
 * há publicação em fila/barramento externo.
 *
 * `TPayload` nunca deve conter dados sensíveis (CPF integral, senha,
 * hash, token, segredo, ID interno) — essa restrição é aplicada por
 * convenção em cada evento concreto do módulo identity.
 */
export interface DomainEvent<TEventType extends string = string, TPayload = unknown> {
  readonly eventId: string;
  readonly eventType: TEventType;
  readonly eventVersion: number;
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}
