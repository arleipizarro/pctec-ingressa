import { DomainError } from "../../../../shared/errors/DomainError.js";

const MAX_LENGTH = 255;

export class InvalidIdentityNameError extends DomainError {
  public readonly code = "IDENTITY_NAME_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(reason: string) {
    super(`Nome de identidade inválido: ${reason}.`);
  }
}

/**
 * Value Object IdentityName.
 *
 * Representa `full_name`. Obrigatório, não vazio; normaliza apenas
 * espaços redundantes (trim), sem alterar capitalização — nome próprio
 * não deve ser alterado arbitrariamente pelo sistema.
 *
 * Referência: docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seção 6.
 */
export class IdentityName {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static create(rawValue: string): IdentityName {
    const trimmed = rawValue.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) {
      throw new InvalidIdentityNameError("não pode ser vazio");
    }
    if (trimmed.length > MAX_LENGTH) {
      throw new InvalidIdentityNameError(`excede o tamanho máximo de ${MAX_LENGTH} caracteres`);
    }
    return new IdentityName(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: IdentityName): boolean {
    return this.value === other.value;
  }
}
