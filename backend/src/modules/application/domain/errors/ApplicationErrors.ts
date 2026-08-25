import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio do bounded context `application`/`access`, conforme
 * seção 14 da task de implementação v0.5.0 e formalizados em
 * `docs/03-dominio/APPLICATION-ACCESS-DESIGN.md`.
 */

export class ApplicationNotFoundError extends DomainError {
  public readonly code = "APPLICATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identifier: string) {
    super(`Application não encontrada: ${identifier}.`);
  }
}

export class ApplicationCodeAlreadyExistsError extends DomainError {
  public readonly code = "APPLICATION_CODE_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe uma Application com este code.");
  }
}

export class IdentityNotFoundForAccessError extends DomainError {
  public readonly code = "IDENTITY_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identityPublicId: string) {
    super(`Identity não encontrada: ${identityPublicId}.`);
  }
}

export class ApplicationAccessActiveGrantConflictError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_ACTIVE_GRANT_CONFLICT";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "Já existe um ApplicationAccess GRANTED para esta identidade nesta aplicação. " +
        "A regra é um acesso ativo por identidade por aplicação — o perfil é atributo do acesso, " +
        "não parte da identidade dele. Para trocar de perfil, revogue o acesso atual e conceda o novo " +
        "na mesma transação."
    );
  }
}

export class ApplicationAccessVersionConflictError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_VERSION_CONFLICT";
  public readonly classification = "CONFLICT" as const;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Conflito de concorrência otimista em ApplicationAccess: versão esperada ${expectedVersion}, versão atual ${actualVersion}.`
    );
  }
}

/**
 * Revogar acesso que não está GRANTED.
 *
 * Recusa em vez de no-op: quem chamou acreditava haver acesso ativo, e
 * silenciar essa divergência esconderia um estado que o operador
 * precisa ver — inclusive o caso de duas pessoas revogando o mesmo
 * acesso ao mesmo tempo.
 */
export class ApplicationAccessNotGrantedError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_NOT_GRANTED";
  public readonly classification = "CONFLICT" as const;

  constructor(status: string) {
    super(`acesso está ${status} — somente acesso GRANTED pode ser revogado.`);
  }
}

/** Acesso inexistente — 404, nunca 500. */
export class ApplicationAccessNotFoundError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`ApplicationAccess ${publicId} não encontrado.`);
  }
}
