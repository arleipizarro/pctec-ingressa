import { DomainError } from "../../../../shared/errors/DomainError.js";

export class InvalidEntityTypeError extends DomainError {
  public readonly code = "ENTITY_TYPE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("entityType é obrigatório e deve ter no máximo 64 caracteres.");
  }
}

/**
 * Value Object EntityType — cópia deliberada de modules/organization/domain/value-objects/EntityType.ts.
 *
 * **Sem import cross-module** — mesma filosofia de "tabela paralela".
 *
 * Nome da tabela/entidade de origem no sistema legado (ex.: `portal_acesso`,
 * `clientes`). Deliberadamente uma string validada, não um ENUM fechado —
 * cada sistema legado tem seus próprios nomes de tabela. Limite de 64
 * caracteres alinhado à coluna `identity_external_references.entity_type
 * VARCHAR(64)` (migration 0016).
 */
export class EntityType {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static create(rawValue: string): EntityType {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0 || trimmed.length > 64) {
      throw new InvalidEntityTypeError();
    }
    return new EntityType(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: EntityType): boolean {
    return this.value === other.value;
  }
}
