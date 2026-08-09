import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de orquestração do processo de bootstrap da primeira Credential —
 * paralelo direto de `BootstrapErrors.ts` (identity) e
 * `ApplicationAccessBootstrapErrors.ts` (application), mesma distinção
 * entre "já concluído" (guard global) e "lock indisponível" (concorrência
 * em andamento).
 */

export class CredentialBootstrapAlreadyCompletedError extends DomainError {
  public readonly code = "CREDENTIAL_BOOTSTRAP_ALREADY_COMPLETED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "O bootstrap da primeira Credential já foi realizado anteriormente — já existe uma Credential LOCAL_PASSWORD na plataforma, de qualquer Identity."
    );
  }
}

export class CredentialLockNotAcquiredError extends DomainError {
  public readonly code = "CREDENTIAL_LOCK_NOT_ACQUIRED";
  public readonly classification = "CONFLICT" as const;

  constructor(lockName: string, timeoutSeconds: number) {
    super(
      `Não foi possível adquirir o lock "${lockName}" em ${timeoutSeconds}s — outro processo de bootstrap de credencial parece estar em execução.`
    );
  }
}
