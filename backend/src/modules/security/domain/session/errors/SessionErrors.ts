import { DomainError } from "../../../../../shared/errors/DomainError.js";

/**
 * Conflito de optimistic locking em `Session` — v0.6.x, Fase E. Mesmo
 * padrão de `IdentityVersionConflictError`/`CredentialVersionConflictError`
 * (ADR-024): o `UPDATE` não afetou nenhuma linha porque a `version` no
 * banco já não era mais a esperada.
 */
export class SessionVersionConflictError extends DomainError {
  public readonly code = "SESSION_VERSION_CONFLICT";
  public readonly classification = "CONFLICT" as const;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Conflito de concorrência otimista em Session: versão esperada ${expectedVersion}, versão atual ${actualVersion}.`
    );
  }
}
