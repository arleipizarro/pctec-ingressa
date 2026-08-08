import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de orquestração do processo de bootstrap da primeira concessão
 * administrativa — paralelo direto de
 * `modules/identity/application/errors/BootstrapErrors.ts` (v0.4.0/ADR-027),
 * mesma distinção entre "já concluído" e "lock indisponível" (concorrência
 * em andamento).
 */

export class ApplicationAccessBootstrapAlreadyCompletedError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_BOOTSTRAP_ALREADY_COMPLETED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "A primeira concessão administrativa já foi realizada anteriormente — já existe um ApplicationAccess ADMIN ativo para PCTEC_INGRESSA."
    );
  }
}

export class ApplicationAccessLockNotAcquiredError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_LOCK_NOT_ACQUIRED";
  public readonly classification = "CONFLICT" as const;

  constructor(lockName: string, timeoutSeconds: number) {
    super(
      `Não foi possível adquirir o lock "${lockName}" em ${timeoutSeconds}s — outro processo de bootstrap de acesso administrativo parece estar em execução.`
    );
  }
}
