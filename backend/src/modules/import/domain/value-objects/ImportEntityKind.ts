import { DomainError } from "../../../../shared/errors/DomainError.js";

export type ImportEntityKindValue =
  | "ORGANIZATION"
  | "ORGANIZATION_RELATIONSHIP"
  | "ORGANIZATION_EXTERNAL_REFERENCE"
  | "IDENTITY"
  | "IDENTITY_EXTERNAL_REFERENCE"
  | "MEMBERSHIP"
  | "APPLICATION_ACCESS";

const VALID_KINDS: readonly ImportEntityKindValue[] = [
  "ORGANIZATION",
  "ORGANIZATION_RELATIONSHIP",
  "ORGANIZATION_EXTERNAL_REFERENCE",
  "IDENTITY",
  "IDENTITY_EXTERNAL_REFERENCE",
  "MEMBERSHIP",
  "APPLICATION_ACCESS"
];

export class InvalidImportEntityKindError extends DomainError {
  public readonly code = "IMPORT_ENTITY_KIND_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`entityKind inválido. Valores aceitos: ${VALID_KINDS.join(", ")}.`);
  }
}

/**
 * Entidade de DESTINO no Ingressa afetada por uma decisão de importação.
 *
 * Note o que NÃO está aqui e nunca estará: fila/equipe de atendimento e
 * papel/perfil do sistema de origem. Fila não é Organization; papel não
 * é Membership. A auditoria do Helpdesk mostrou 21 pessoas com fila e
 * nenhum vínculo cadastral — se fila virasse Organization, essas 21
 * ganhariam acesso que não têm.
 */
export class ImportEntityKind {
  private constructor(private readonly value: ImportEntityKindValue) {}

  public static create(rawValue: string): ImportEntityKind {
    if (!VALID_KINDS.includes(rawValue as ImportEntityKindValue)) {
      throw new InvalidImportEntityKindError();
    }
    return new ImportEntityKind(rawValue as ImportEntityKindValue);
  }

  public toString(): ImportEntityKindValue {
    return this.value;
  }

  public equals(other: ImportEntityKind): boolean {
    return this.value === other.value;
  }
}
