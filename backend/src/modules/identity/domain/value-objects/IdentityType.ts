import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Valores previstos no domínio (ADR-018). Apenas HUMAN é aceito em
 * operações de criação nesta fatia (v0.4.0) — os demais permanecem
 * reservados, sem comportamento implementado.
 */
export const IDENTITY_TYPES = [
  "HUMAN",
  "SERVICE",
  "APPLICATION",
  "DEVICE",
  "AGENT"
] as const;

export type IdentityTypeValue = (typeof IDENTITY_TYPES)[number];

export class IdentityTypeNotSupportedError extends DomainError {
  public readonly code = "IDENTITY_TYPE_NOT_SUPPORTED";
  public readonly classification = "VALIDATION" as const;

  constructor(value: string) {
    super(
      `Tipo de identidade "${value}" não é suportado nesta fase. Apenas HUMAN é aceito no primeiro escopo funcional (ADR-018).`
    );
  }
}

/**
 * Value Object IdentityType.
 *
 * Referência: docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seção 6;
 * ADR-018.
 */
export class IdentityType {
  private readonly value: IdentityTypeValue;

  private constructor(value: IdentityTypeValue) {
    this.value = value;
  }

  /**
   * Reconstrói um IdentityType a partir de um valor já persistido —
   * aceita qualquer valor do enum reservado, sem impor a restrição de
   * "somente HUMAN" (essa restrição é de criação, não de leitura; ver
   * `forCreation`).
   */
  public static fromString(value: string): IdentityType {
    if (!(IDENTITY_TYPES as readonly string[]).includes(value)) {
      throw new IdentityTypeNotSupportedError(value);
    }
    return new IdentityType(value as IdentityTypeValue);
  }

  /**
   * Constrói um IdentityType para uso em CreateIdentity. Nesta fatia,
   * exige explicitamente HUMAN — qualquer outro valor válido do enum
   * reservado é rejeitado com IDENTITY_TYPE_NOT_SUPPORTED (ver caso de
   * uso 15 do documento de domínio).
   */
  public static forCreation(value: string): IdentityType {
    const type = IdentityType.fromString(value);
    if (type.value !== "HUMAN") {
      throw new IdentityTypeNotSupportedError(value);
    }
    return type;
  }

  public static human(): IdentityType {
    return new IdentityType("HUMAN");
  }

  public toString(): IdentityTypeValue {
    return this.value;
  }

  public equals(other: IdentityType): boolean {
    return this.value === other.value;
  }
}
