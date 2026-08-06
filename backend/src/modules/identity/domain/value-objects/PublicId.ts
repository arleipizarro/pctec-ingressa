import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors/DomainError.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidPublicIdError extends DomainError {
  public readonly code = "IDENTITY_PUBLIC_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(value: string) {
    super(`Public ID inválido: "${value}" não é um UUID sintaticamente válido.`);
  }
}

/**
 * Value Object PublicId.
 *
 * Identifica uma Identity externamente de forma única, imutável e sem
 * significado de negócio. Formato: UUID textual (CHAR(36) na persistência).
 *
 * Referência: docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seção 6.
 * Nunca é derivado de e-mail, CPF ou qualquer dado pessoal/sequencial.
 */
export class PublicId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Gera um novo PublicId aleatório (uso em CreateIdentity). */
  public static generate(): PublicId {
    return new PublicId(randomUUID());
  }

  /** Reconstrói um PublicId a partir de um valor já existente (ex.: vindo do banco). */
  public static fromString(value: string): PublicId {
    if (!UUID_PATTERN.test(value)) {
      throw new InvalidPublicIdError(value);
    }
    return new PublicId(value.toLowerCase());
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: PublicId): boolean {
    return this.value === other.value;
  }
}
