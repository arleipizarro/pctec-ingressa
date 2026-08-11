import { DomainError } from "../../../../shared/errors/DomainError.js";

export class InvalidTradeNameError extends DomainError {
  public readonly code = "ORGANIZATION_TRADE_NAME_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("tradeName, quando informado, deve ter no máximo 255 caracteres.");
  }
}

/**
 * Value Object TradeName.
 *
 * Nome fantasia — sempre opcional, para ambos os tipos de Organization
 * (ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 1). Limite de 255 caracteres
 * alinhado à coluna `organizations.trade_name VARCHAR(255) NULL`
 * (migration 0010).
 */
export class TradeName {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /**
   * Retorna `undefined` quando o valor de entrada é ausente/vazio
   * (tradeName é sempre opcional) — mesmo princípio de
   * `Cpf.createOptional()`.
   */
  public static createOptional(rawValue: string | undefined | null): TradeName | undefined {
    if (rawValue === undefined || rawValue === null || rawValue.trim().length === 0) {
      return undefined;
    }
    const trimmed = rawValue.trim();
    if (trimmed.length > 255) {
      throw new InvalidTradeNameError();
    }
    return new TradeName(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: TradeName): boolean {
    return this.value === other.value;
  }
}
