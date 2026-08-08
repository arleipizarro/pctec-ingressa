import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors/DomainError.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidApplicationPublicIdError extends DomainError {
  public readonly code = "APPLICATION_PUBLIC_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(value: string) {
    super(`Public ID inválido: "${value}" não é um UUID sintaticamente válido.`);
  }
}

/**
 * Value Object PublicId, específico do bounded context `application`.
 *
 * Deliberadamente duplicado do equivalente em `modules/identity` (não
 * importado de lá) — cada bounded context possui seus próprios Value
 * Objects genéricos, por isolamento (ADR-014); a duplicação de ~40 linhas
 * de utilitário puro é preferível a acoplar `application` ao módulo
 * `identity` para um tipo puramente técnico.
 */
export class PublicId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static generate(): PublicId {
    return new PublicId(randomUUID());
  }

  public static fromString(value: string): PublicId {
    if (!UUID_PATTERN.test(value)) {
      throw new InvalidApplicationPublicIdError(value);
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
