import { DomainError } from "../../../../shared/errors/DomainError.js";

export type MembershipScopeValue = "ORGANIZATION_ONLY" | "ORGANIZATION_AND_DESCENDANTS";

const VALID_SCOPES: readonly MembershipScopeValue[] = ["ORGANIZATION_ONLY", "ORGANIZATION_AND_DESCENDANTS"];

export class InvalidMembershipScopeError extends DomainError {
  public readonly code = "MEMBERSHIP_SCOPE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`scope de Membership inválido. Valores aceitos: ${VALID_SCOPES.join(", ")}.`);
  }
}

/**
 * Value Object MembershipScope.
 *
 * Reconfirmado contra o design aprovado
 * (ORGANIZATION-MEMBERSHIP-DESIGN.md §4) — nomes completos, sem
 * abreviação (`ORGANIZATION_AND_DESCENDANTS`, não `AND_DESCENDANTS`).
 *
 * Semântica (nunca reinterpretada como permissão):
 * - `ORGANIZATION_ONLY`: alcance comercial limitado à própria
 *   Organization referenciada pelo Membership.
 * - `ORGANIZATION_AND_DESCENDANTS`: se a Organization referenciada for
 *   `BUSINESS_GROUP`, o alcance inclui as `COMPANY` descendentes válidas
 *   (via `OrganizationRelationship`, G1). Para uma Organization do tipo
 *   `COMPANY`, este scope não tem descendentes a incluir — não é erro,
 *   apenas não amplia nada na prática (COMPANY não tem filhos no MVP).
 *
 * **Scope não é role. Scope não define operações** — só delimita o
 * alcance organizacional do vínculo, nunca o que a Identity pode fazer
 * dentro desse alcance (isso é autorização funcional, fora do escopo de
 * `Membership`).
 */
export class MembershipScope {
  private readonly value: MembershipScopeValue;

  private constructor(value: MembershipScopeValue) {
    this.value = value;
  }

  public static create(rawValue: string): MembershipScope {
    if (!VALID_SCOPES.includes(rawValue as MembershipScopeValue)) {
      throw new InvalidMembershipScopeError();
    }
    return new MembershipScope(rawValue as MembershipScopeValue);
  }

  public static organizationOnly(): MembershipScope {
    return new MembershipScope("ORGANIZATION_ONLY");
  }

  public static organizationAndDescendants(): MembershipScope {
    return new MembershipScope("ORGANIZATION_AND_DESCENDANTS");
  }

  public includesDescendants(): boolean {
    return this.value === "ORGANIZATION_AND_DESCENDANTS";
  }

  public toString(): MembershipScopeValue {
    return this.value;
  }

  public equals(other: MembershipScope): boolean {
    return this.value === other.value;
  }
}
