import { DomainError } from "../../../../shared/errors/DomainError.js";

export class CpfInvalidError extends DomainError {
  public readonly code = "IDENTITY_CPF_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(value: string) {
    super(`CPF "${value}" tem formato inválido.`);
  }
}

/**
 * Value Object Cpf.
 *
 * Opcional. Quando informado, deve ter formato compatível com CPF (11
 * dígitos, com ou sem pontuação na entrada) e é normalizado (apenas
 * dígitos) para fins de unicidade.
 *
 * Validação de dígito verificador é **Pendente de decisão** nesta fatia
 * (ver IDENTITY-DOMAIN-DESIGN.md, seção 17) — verificamos apenas formato
 * estrutural (11 dígitos numéricos após remover pontuação).
 *
 * Nunca é exposto integralmente em eventos, logs ou payloads externos
 * (ver IDENTITY-DOMAIN-DESIGN.md, seção 14, Privacidade).
 */
export class Cpf {
  private readonly displayValue: string;
  private readonly normalizedValue: string;

  private constructor(displayValue: string, normalizedValue: string) {
    this.displayValue = displayValue;
    this.normalizedValue = normalizedValue;
  }

  /**
   * Cria um Cpf a partir de um valor bruto. Retorna `undefined` quando o
   * valor de entrada é ausente/vazio (CPF é opcional) — o chamador decide
   * o que fazer com a ausência; esta função nunca lança erro para
   * ausência, apenas para formato inválido quando algo foi informado.
   */
  public static createOptional(rawValue: string | undefined | null): Cpf | undefined {
    if (rawValue === undefined || rawValue === null || rawValue.trim().length === 0) {
      return undefined;
    }
    const digitsOnly = rawValue.replace(/\D/g, "");
    if (digitsOnly.length !== 11) {
      throw new CpfInvalidError(rawValue);
    }
    return new Cpf(rawValue.trim(), digitsOnly);
  }

  public static fromPersistence(displayValue: string, normalizedValue: string): Cpf {
    return new Cpf(displayValue, normalizedValue);
  }

  public toString(): string {
    return this.displayValue;
  }

  public normalized(): string {
    return this.normalizedValue;
  }

  public equals(other: Cpf): boolean {
    return this.normalizedValue === other.normalizedValue;
  }
}
