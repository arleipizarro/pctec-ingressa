import { DomainError } from "../../../../shared/errors/DomainError.js";

export type MembershipProfileValue = "EMPLOYEE" | "CUSTOMER" | "PARTNER" | "SUPPLIER" | "SERVICE_ACCOUNT";

const VALID_PROFILES: readonly MembershipProfileValue[] = [
  "EMPLOYEE",
  "CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "SERVICE_ACCOUNT"
];

export class InvalidMembershipProfileError extends DomainError {
  public readonly code = "MEMBERSHIP_PROFILE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`profile de Membership inválido. Valores aceitos: ${VALID_PROFILES.join(", ")}.`);
  }
}

/**
 * Value Object MembershipProfile.
 *
 * Reconfirmado contra o design aprovado (ADR-025;
 * ORGANIZATION-MEMBERSHIP-DESIGN.md §4/§4.1) — exatamente os 5 valores
 * já formalizados, nenhum novo introduzido em G2.
 *
 * **`profile` descreve RELAÇÃO, nunca autorização funcional** (§4.1,
 * revisão do Product Owner). Interpretações como "CUSTOMER = pode ver
 * contratos" ou "EMPLOYEE = pode fazer tudo" NÃO são implementadas em
 * lugar nenhum deste Value Object nem do Aggregate que o usa —
 * deliberadamente, este VO só sabe validar o formato/pertencimento ao
 * conjunto fechado, nunca interpreta significado de permissão.
 */
export class MembershipProfile {
  private readonly value: MembershipProfileValue;

  private constructor(value: MembershipProfileValue) {
    this.value = value;
  }

  public static create(rawValue: string): MembershipProfile {
    if (!VALID_PROFILES.includes(rawValue as MembershipProfileValue)) {
      throw new InvalidMembershipProfileError();
    }
    return new MembershipProfile(rawValue as MembershipProfileValue);
  }

  public toString(): MembershipProfileValue {
    return this.value;
  }

  public equals(other: MembershipProfile): boolean {
    return this.value === other.value;
  }
}
