import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros do processo de bootstrap da primeira Identity (v0.5.0, ADR-027).
 *
 * Deliberadamente separados de `IdentityErrors.ts`: não são invariantes
 * do Aggregate `Identity` em si (nenhum Value Object ou o próprio
 * `Identity` os lança) — são erros de ORQUESTRAÇÃO do processo de
 * bootstrap (`BootstrapFirstIdentityService`), levantados antes ou ao
 * redor da criação da Identity, nunca pelo domínio `Identity`
 * propriamente dito. Ainda assim estendem `DomainError` para reaproveitar
 * o mesmo contrato de erro sanitizado (`code`/`classification`/
 * `message`, nunca SQL/stack) já usado em toda a aplicação.
 *
 * Registrados como PROPOSTA em
 * `docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md` — não
 * adicionados ao catálogo formal `IDENTITY-DOMAIN-ERRORS.md` até decisão
 * explícita do Platform Architect sobre onde devem viver no catálogo.
 */

export class BootstrapAlreadyCompletedError extends DomainError {
  public readonly code = "BOOTSTRAP_ALREADY_COMPLETED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "O bootstrap da primeira Identity já foi concluído — já existe ao menos uma Identity no diretório."
    );
  }
}

/**
 * Lançado quando o named lock `pctec_ingressa_identity_bootstrap` não
 * pôde ser adquirido (GET_LOCK retornou 0 ou NULL) — outro processo de
 * bootstrap está em execução no momento, ou o servidor recusou o lock.
 * Distinto de `BootstrapAlreadyCompletedError`: este erro é sobre
 * concorrência EM ANDAMENTO, não sobre um bootstrap já concluído no
 * passado.
 */
export class BootstrapLockNotAcquiredError extends DomainError {
  public readonly code = "BOOTSTRAP_LOCK_NOT_ACQUIRED";
  public readonly classification = "CONFLICT" as const;

  constructor(
    public readonly lockName: string,
    public readonly timeoutSeconds: number
  ) {
    super(
      `Não foi possível adquirir o lock de bootstrap "${lockName}" em ${timeoutSeconds}s — outro processo de bootstrap parece estar em execução.`
    );
  }
}
