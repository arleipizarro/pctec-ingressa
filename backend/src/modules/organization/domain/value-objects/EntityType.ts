import { DomainError } from "../../../../shared/errors/DomainError.js";

export class InvalidEntityTypeError extends DomainError {
  public readonly code = "ENTITY_TYPE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("entityType é obrigatório e deve ter no máximo 64 caracteres.");
  }
}

/**
 * Value Object EntityType.
 *
 * Nome da tabela/entidade de origem no sistema legado (ex.: `clientes`,
 * `clientes_grupo`, `clients`). **Deliberadamente uma string validada,
 * não um ENUM fechado** — diferente de `SystemCode`. Cada sistema legado
 * tem seus próprios nomes de tabela, incompatíveis entre si (confirmado
 * na auditoria da Fase G: HUB usa `clientes`/`clientes_grupo`, Helpdesk
 * usa `clients`, Portal usa `clientes` — três schemas físicos
 * diferentes); fechar isso em ENUM exigiria este bounded context
 * conhecer o schema interno de 3 sistemas externos em detalhe, o que não
 * é desejável. Limite de 64 caracteres alinhado à coluna
 * `organization_external_references.entity_type VARCHAR(64)`
 * (migration 0013).
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
