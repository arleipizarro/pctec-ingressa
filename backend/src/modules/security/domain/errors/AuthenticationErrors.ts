import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erro externo único de falha de autenticação (login) — v0.6.0, ADR-030.
 *
 * Deliberadamente genérico: cobre e-mail inexistente, senha incorreta,
 * `Identity` não `ACTIVE`, `loginEnabled=false`, `Credential` inexistente,
 * `Credential` `REVOKED` — todos produzem esta MESMA instância de erro,
 * mesma mensagem, mesmo código. Nunca revela qual causa específica
 * ocorreu (proteção contra enumeração de usuário, ADR-029/ADR-030).
 *
 * O motivo real (`reason`) é opcional e usado APENAS para
 * auditoria/telemetria interna (log operacional `authentication.failed`)
 * — nunca serializado na resposta HTTP (`mapDomainErrorToHttp` só expõe
 * `code`/`message`, nunca `reason`).
 */
export class AuthenticationFailedError extends DomainError {
  public readonly code = "AUTHENTICATION_FAILED";
  public readonly classification = "AUTHENTICATION" as const;

  public readonly reason: AuthenticationFailureReason;

  constructor(reason: AuthenticationFailureReason) {
    // Mensagem sempre genérica — nunca inclui o e-mail informado, nunca
    // menciona a causa real.
    super("Não foi possível autenticar com as credenciais informadas.");
    this.reason = reason;
  }
}

/**
 * Motivo interno da falha — usado exclusivamente para
 * auditoria/telemetria (`authentication.failed`), nunca exposto
 * externamente. Enum fechado, não string livre — evita que um motivo
 * inesperado (ex.: um erro de digitação em uma string solta) escape sem
 * ser notado.
 */
export type AuthenticationFailureReason =
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_NOT_ACTIVE"
  | "LOGIN_NOT_ENABLED"
  | "CREDENTIAL_NOT_FOUND"
  | "CREDENTIAL_NOT_ACTIVE"
  | "INVALID_PASSWORD";
