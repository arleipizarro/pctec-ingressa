/**
 * Status de Credential — somente `ACTIVE`/`REVOKED` (ADR-029, "Status de
 * Credential"). `PENDING`, `LOCKED` e `DISABLED` foram avaliados e
 * explicitamente rejeitados: `PENDING` pertence ao `MagicLink`, não à
 * `Credential`; um lock temporário futuro seria um campo
 * (`lockedUntil`), nunca um terceiro valor de `status`; `DISABLED`
 * seria redundante com `REVOKED`.
 */
export const CREDENTIAL_STATUSES = ["ACTIVE", "REVOKED"] as const;

export type CredentialStatusValue = (typeof CREDENTIAL_STATUSES)[number];

export class CredentialStatus {
  private readonly value: CredentialStatusValue;

  private constructor(value: CredentialStatusValue) {
    this.value = value;
  }

  public static fromString(value: string): CredentialStatus {
    if (!(CREDENTIAL_STATUSES as readonly string[]).includes(value)) {
      throw new Error(`Valor de status de Credential desconhecido: "${value}".`);
    }
    return new CredentialStatus(value as CredentialStatusValue);
  }

  public static active(): CredentialStatus {
    return new CredentialStatus("ACTIVE");
  }

  public toString(): CredentialStatusValue {
    return this.value;
  }

  public isActive(): boolean {
    return this.value === "ACTIVE";
  }

  public equals(other: CredentialStatus): boolean {
    return this.value === other.value;
  }
}
