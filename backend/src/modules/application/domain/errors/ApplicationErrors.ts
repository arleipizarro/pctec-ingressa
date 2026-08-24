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

export class ApplicationAccessAlreadyGrantedError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_ALREADY_GRANTED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe um ApplicationAccess ativo (GRANTED) para esta combinação de identidade/aplicação/perfil.");
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
