import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Tipos de Credential previstos. Apenas `LOCAL_PASSWORD` tem significado
 * definido nesta entrega — enum deliberadamente pequeno e fechado, não
 * aberto a qualquer string (ADR-029, "Nomenclatura de type": `LOCAL_PASSWORD`
 * preservado, não renomeado para `PASSWORD`). Nenhum campo específico de
 * OAuth/Entra é inventado nesta fatia — um futuro `MICROSOFT_ENTRA` (ou
 * equivalente) seria adicionado aqui quando desenhado, sem quebrar
 * `Identity` nem `Credential`.
 */
export const CREDENTIAL_TYPES = ["LOCAL_PASSWORD"] as const;

export type CredentialTypeValue = (typeof CREDENTIAL_TYPES)[number];

export class CredentialTypeNotSupportedError extends DomainError {
  public readonly code = "CREDENTIAL_TYPE_NOT_SUPPORTED";
  public readonly classification = "VALIDATION" as const;

  constructor(value: string) {
    super(`Tipo de credencial "${value}" não é suportado. Valores válidos: ${CREDENTIAL_TYPES.join(", ")}.`);
  }
}

/** Value Object CredentialType. Referência: ADR-022, ADR-029. */
export class CredentialType {
  private readonly value: CredentialTypeValue;

  private constructor(value: CredentialTypeValue) {
    this.value = value;
  }

  public static create(rawValue: string): CredentialType {
    if (!(CREDENTIAL_TYPES as readonly string[]).includes(rawValue)) {
      throw new CredentialTypeNotSupportedError(rawValue);
    }
    return new CredentialType(rawValue as CredentialTypeValue);
  }

  public static localPassword(): CredentialType {
    return new CredentialType("LOCAL_PASSWORD");
  }

  public toString(): CredentialTypeValue {
    return this.value;
  }

  public equals(other: CredentialType): boolean {
    return this.value === other.value;
  }
}
