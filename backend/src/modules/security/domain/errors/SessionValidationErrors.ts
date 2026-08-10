import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erro externo único para toda falha de VALIDAÇÃO de uma sessão já
 * existente — v0.6.x, Fase E.
 *
 * **Decisão fechada nesta fatia (revisão do que ADR-030 havia deixado em
 * aberto):** ADR-030 havia considerado `SESSION_NOT_FOUND`/
 * `SESSION_EXPIRED`/`SESSION_REVOKED` como potencialmente distinguíveis
 * externamente (contexto de posse prévia de token, diferente do
 * enumeration de contas no login). Nesta implementação, optamos por
 * COLAPSAR todos os casos em um único código externo,
 * `SESSION_INVALID` — mesma filosofia de `AuthenticationFailedError`
 * (login): o motivo real (`reason`) fica só internamente, nunca
 * exposto. Justificativa: mesmo sem vazar existência de OUTRAS contas,
 * distinguir "revogada" de "expirada" de "nunca existiu" ainda entrega
 * um sinal comportamental a quem possui um token roubado/copiado (ex.:
 * "revogada" sugere que o dono legítimo agiu; "expirada" sugere só
 * passagem de tempo) — colapsar é estritamente mais seguro e não custa
 * usabilidade real (a resposta correta do cliente é sempre a mesma:
 * "autentique novamente").
 *
 * Cobre: cookie ausente, cookie malformado, token desconhecido, Session
 * REVOKED, Session expirada, Identity inexistente, Identity não ACTIVE,
 * `loginEnabled=false`.
 */
export class SessionValidationFailedError extends DomainError {
  public readonly code = "SESSION_INVALID";
  public readonly classification = "AUTHENTICATION" as const;

  public readonly reason: SessionValidationFailureReason;

  constructor(reason: SessionValidationFailureReason) {
    super("Sessão inválida ou expirada.");
    this.reason = reason;
  }
}

/**
 * Motivo interno — usado exclusivamente para auditoria/telemetria
 * futura, nunca exposto externamente. Enum fechado, não string livre.
 */
export type SessionValidationFailureReason =
  | "COOKIE_ABSENT"
  | "COOKIE_MALFORMED"
  | "SESSION_NOT_FOUND"
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_NOT_ACTIVE"
  | "LOGIN_NOT_ENABLED";
