import { DomainError } from "../../../../shared/errors/DomainError.js";

const MAX_LENGTH = 255;

// Validação sintática pragmática — não é uma implementação completa de
// RFC 5322, propositalmente: biblioteca de validação de e-mail é
// "Pendente de decisão" (fora do escopo desta fatia). Suficiente para
// rejeitar entradas obviamente inválidas.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailRequiredError extends DomainError {
  public readonly code = "IDENTITY_EMAIL_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("E-mail é obrigatório.");
  }
}

export class EmailInvalidError extends DomainError {
  public readonly code = "IDENTITY_EMAIL_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(value: string) {
    super(`E-mail "${value}" tem formato inválido.`);
  }
}

/**
 * Value Object Email.
 *
 * Representa o e-mail de exibição de uma Identity e sua forma normalizada
 * (comparação de unicidade case-insensitive). A normalização, nesta
 * fatia, é apenas conversão para minúsculas — sem tratamento de sufixos
 * do tipo `+tag@dominio` (regra Pendente de decisão, ver
 * IDENTITY-DOMAIN-DESIGN.md, seção 17).
 *
 * Referência: docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seção 6, termos
 * `Email`/`Normalized Email` em IDENTITY-UBIQUITOUS-LANGUAGE.md.
 */
export class Email {
  private readonly displayValue: string;
  private readonly normalizedValue: string;

  private constructor(displayValue: string, normalizedValue: string) {
    this.displayValue = displayValue;
    this.normalizedValue = normalizedValue;
  }

  public static create(rawValue: string | undefined | null): Email {
    if (rawValue === undefined || rawValue === null || rawValue.trim().length === 0) {
      throw new EmailRequiredError();
    }
    const trimmed = rawValue.trim();
    if (trimmed.length > MAX_LENGTH || !EMAIL_PATTERN.test(trimmed)) {
      throw new EmailInvalidError(trimmed);
    }
    return new Email(trimmed, trimmed.toLowerCase());
  }

  /**
   * Reconstrói um Email a partir de valores já persistidos (display +
   * normalizado), sem reexecutar a validação de formato — usado pela
   * camada de infraestrutura ao carregar uma Identity do banco.
   */
  public static fromPersistence(displayValue: string, normalizedValue: string): Email {
    return new Email(displayValue, normalizedValue);
  }

  public toString(): string {
    return this.displayValue;
  }

  public normalized(): string {
    return this.normalizedValue;
  }

  public equals(other: Email): boolean {
    return this.normalizedValue === other.normalizedValue;
  }
}
