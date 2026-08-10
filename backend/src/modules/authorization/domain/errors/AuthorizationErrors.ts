import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erro externo único para toda falha de AUTORIZAÇÃO de acesso a uma
 * aplicação — v0.6.x, Fase F.
 *
 * Mesma filosofia já aplicada a `AuthenticationFailedError` (login) e
 * `SessionValidationFailedError` (validação de sessão): todas as causas
 * internas de negação colapsam externamente em um único código,
 * `APPLICATION_ACCESS_DENIED` — o motivo real (`reason`) fica só
 * internamente, nunca exposto.
 *
 * **Nunca 401 aqui** — a autenticação já ocorreu (via
 * `requireAuthenticatedSession`, antes deste middleware/serviço). 403
 * (`AUTHORIZATION`) significa "você é quem diz ser, mas não pode fazer
 * isto" — categoria diferente de "não sei quem você é" (401,
 * `AUTHENTICATION`).
 *
 * Cobre: aplicação inexistente, aplicação inativa, `ApplicationAccess`
 * inexistente, `ApplicationAccess` `REVOKED`, perfil insuficiente,
 * identidade/aplicação não correspondem ao acesso encontrado.
 */
export class ApplicationAccessDeniedError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_DENIED";
  public readonly classification = "AUTHORIZATION" as const;

  public readonly reason: ApplicationAccessDenialReason;

  constructor(reason: ApplicationAccessDenialReason) {
    super("Acesso negado a esta aplicação.");
    this.reason = reason;
  }
}

/**
 * Motivo interno — usado exclusivamente para auditoria/telemetria
 * futura, nunca exposto externamente. Enum fechado, não string livre.
 */
export type ApplicationAccessDenialReason =
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_NOT_ACTIVE"
  | "ACCESS_NOT_FOUND"
  | "ACCESS_NOT_GRANTED"
  | "PROFILE_INSUFFICIENT";
