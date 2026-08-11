import { DomainError } from "../../../../shared/errors/DomainError.js";

export class InvalidLegalNameError extends DomainError {
  public readonly code = "ORGANIZATION_LEGAL_NAME_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("legalName é obrigatório e deve ter no máximo 255 caracteres.");
  }
}

/**
 * Value Object LegalName.
 *
 * Razão social (`COMPANY`) ou nome oficial do grupo (`BUSINESS_GROUP`).
 * Obrigatório em ambos os tipos — diferente de `TradeName`, que é sempre
 * opcional. Limite de 255 caracteres alinhado à coluna
 * `organizations.legal_name VARCHAR(255)` (migration 0010).
 */
export class LegalName {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static create(rawValue: string): LegalName {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0 || trimmed.length > 255) {
      throw new InvalidLegalNameError();
    }
    return new LegalName(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: LegalName): boolean {
    return this.value === other.value;
  }
}
