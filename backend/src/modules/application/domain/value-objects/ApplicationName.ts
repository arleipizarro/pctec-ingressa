import { DomainError } from "../../../../shared/errors/DomainError.js";

const MAX_LENGTH = 255;

export class InvalidApplicationNameError extends DomainError {
  public readonly code = "APPLICATION_NAME_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(reason: string) {
    super(`Nome de aplicação inválido: ${reason}.`);
  }
}

/** Value Object ApplicationName — nome de exibição de uma Application. */
export class ApplicationName {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static create(rawValue: string): ApplicationName {
    const trimmed = rawValue.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) {
      throw new InvalidApplicationNameError("não pode ser vazio");
    }
    if (trimmed.length > MAX_LENGTH) {
      throw new InvalidApplicationNameError(`excede o tamanho máximo de ${MAX_LENGTH} caracteres`);
    }
    return new ApplicationName(trimmed);
  }

  public toString(): string {
    return this.value;
  }
}
