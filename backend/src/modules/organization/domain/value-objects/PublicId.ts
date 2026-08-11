import { randomUUID } from "node:crypto";
import { DomainError } from "../../../../shared/errors/DomainError.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidOrganizationPublicIdError extends DomainError {
  public readonly code = "ORGANIZATION_PUBLIC_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  /**
   * Deliberadamente NÃO recebe/inclui o valor bruto inválido na
   * mensagem — mesmo princípio já aplicado em
   * `identity/domain/value-objects/PublicId.ts`.
   */
  constructor() {
    super("Public ID inválido: não é um UUID sintaticamente válido.");
  }
}

/**
 * Value Object PublicId — escopo do bounded context `organization`.
 *
 * Identifica uma Organization (ou OrganizationRelationship) externamente
 * de forma única, imutável e sem significado de negócio. Formato: UUID
 * textual (CHAR(36) na persistência), conforme ADR-021.
 *
 * Cópia deliberada do padrão já usado em `identity` e `application` (não
 * um VO compartilhado entre módulos) — mesma convenção adotada em todo o
 * repositório: cada bounded context possui seu próprio PublicId,
 * evitando acoplamento estrutural entre módulos que, por ora, não
 * dependem um do outro para este conceito.
 */
export class PublicId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Gera um novo PublicId aleatório (uso em Organization.create() / OrganizationRelationship.create()). */
  public static generate(): PublicId {
    return new PublicId(randomUUID());
  }

  /** Reconstrói um PublicId a partir de um valor já existente (ex.: vindo do banco). */
  public static fromString(value: string): PublicId {
    if (!UUID_PATTERN.test(value)) {
      throw new InvalidOrganizationPublicIdError();
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
