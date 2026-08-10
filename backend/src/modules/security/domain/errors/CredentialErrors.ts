import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio do bounded context `security`, conforme ADR-029,
 * seção "Erros".
 */

export class CredentialNotFoundError extends DomainError {
  public readonly code = "CREDENTIAL_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identifier: string) {
    super(`Credential não encontrada: ${identifier}.`);
  }
}

export class CredentialAlreadyExistsError extends DomainError {
  public readonly code = "CREDENTIAL_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    // Reservado para um futuro comando não-bootstrap de criação de
    // credencial (ADR-029) — não lançado pelo fluxo de bootstrap, que usa
    // CredentialBootstrapAlreadyCompletedError (guard global).
    super("Já existe uma Credential deste tipo para esta identidade.");
  }
}

export class IdentityNotFoundForCredentialError extends DomainError {
  public readonly code = "IDENTITY_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identityPublicId: string) {
    super(`Identity não encontrada: ${identityPublicId}.`);
  }
}

/**
 * Conflito de optimistic locking em `Credential` — v0.6.0, Fase D.
 * Mesmo padrão de `IdentityVersionConflictError` (ADR-024): o `UPDATE`
 * não afetou nenhuma linha porque a `version` no banco já não era mais a
 * esperada.
 */
export class CredentialVersionConflictError extends DomainError {
  public readonly code = "CREDENTIAL_VERSION_CONFLICT";
  public readonly classification = "CONFLICT" as const;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Conflito de concorrência otimista em Credential: versão esperada ${expectedVersion}, versão atual ${actualVersion}.`
    );
  }
}
