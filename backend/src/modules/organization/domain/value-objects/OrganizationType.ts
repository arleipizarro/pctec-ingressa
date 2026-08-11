import { DomainError } from "../../../../shared/errors/DomainError.js";

export type OrganizationTypeValue = "BUSINESS_GROUP" | "COMPANY";

const VALID_TYPES: readonly OrganizationTypeValue[] = ["BUSINESS_GROUP", "COMPANY"];

export class InvalidOrganizationTypeError extends DomainError {
  public readonly code = "ORGANIZATION_TYPE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`Type de Organization inválido. Valores aceitos: ${VALID_TYPES.join(", ")}.`);
  }
}

/**
 * Value Object OrganizationType.
 *
 * Conforme ADR-031 / ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 2: apenas
 * `BUSINESS_GROUP` (grupo empresarial) e `COMPANY` (empresa individual)
 * são aceitos no MVP. Nenhum outro tipo (filial, departamento, unidade
 * operacional) é aceito nesta fatia — fora de escopo, já registrado em
 * MODELO-DE-DOMINIO.md.
 */
export class OrganizationType {
  private readonly value: OrganizationTypeValue;

  private constructor(value: OrganizationTypeValue) {
    this.value = value;
  }

  public static create(rawValue: string): OrganizationType {
    if (!VALID_TYPES.includes(rawValue as OrganizationTypeValue)) {
      throw new InvalidOrganizationTypeError();
    }
    return new OrganizationType(rawValue as OrganizationTypeValue);
  }

  public static businessGroup(): OrganizationType {
    return new OrganizationType("BUSINESS_GROUP");
  }

  public static company(): OrganizationType {
    return new OrganizationType("COMPANY");
  }

  public isBusinessGroup(): boolean {
    return this.value === "BUSINESS_GROUP";
  }

  public isCompany(): boolean {
    return this.value === "COMPANY";
  }

  public toString(): OrganizationTypeValue {
    return this.value;
  }

  public equals(other: OrganizationType): boolean {
    return this.value === other.value;
  }
}
