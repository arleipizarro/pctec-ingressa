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

/**
 * A Identity informada não é a que possui o ADMIN fundacional (v1.0,
 * ADR-027 emenda).
 *
 * O guard global acima já impede uma SEGUNDA Credential. Este impede a
 * PRIMEIRA na Identity errada — que é o erro silencioso de verdade:
 * bastaria um `publicId` trocado no passo 3 para a plataforma nascer com
 * a senha pertencendo a uma conta sem acesso administrativo nenhum,
 * enquanto a conta ADMIN fica sem como entrar. O sistema ficaria
 * consistente e inutilizável ao mesmo tempo, e o guard global não teria
 * o que reclamar.
 */
export class CredentialIdentityNotFoundationalAdminError extends DomainError {
  public readonly code = "CREDENTIAL_IDENTITY_NOT_FOUNDATIONAL_ADMIN";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "A Identity informada não possui o acesso ADMIN fundacional de PCTEC_INGRESSA — " +
        "a primeira Credential só pode ser criada para ela. Execute o passo de concessão administrativa antes."
    );
  }
}
