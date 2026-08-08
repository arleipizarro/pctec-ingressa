import { DomainError } from "../../../../shared/errors/DomainError.js";

const MAX_LENGTH = 64;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export class InvalidApplicationCodeError extends DomainError {
  public readonly code = "APPLICATION_CODE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(reason: string) {
    super(`Código de aplicação inválido: ${reason}.`);
  }
}

/**
 * Value Object ApplicationCode.
 *
 * Identificador técnico curto e estável (ex.: `PCTEC_INGRESSA`,
 * `PCTEC-PORTAL` na convenção histórica de `MODELO-DE-DOMINIO.md` —
 * `PCTEC_INGRESSA` usa `_` para ser um identificador de programação
 * válido em todos os contextos, incluindo nomes de variável/constante).
 * Único e imutável após a criação (`MODELO-DE-DOMINIO.md`, seção 7).
 */
export class ApplicationCode {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static create(rawValue: string): ApplicationCode {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
      throw new InvalidApplicationCodeError("não pode ser vazio");
    }
    if (trimmed.length > MAX_LENGTH) {
      throw new InvalidApplicationCodeError(`excede o tamanho máximo de ${MAX_LENGTH} caracteres`);
    }
    if (!CODE_PATTERN.test(trimmed)) {
      throw new InvalidApplicationCodeError(
        "deve começar com letra maiúscula e conter apenas letras maiúsculas, dígitos e underscore"
      );
    }
    return new ApplicationCode(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: ApplicationCode): boolean {
    return this.value === other.value;
  }
}
