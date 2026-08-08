import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Perfis de acesso global previstos. Apenas `ADMIN` tem significado
 * definido nesta entrega (v0.5.0) — os demais valores não existem ainda;
 * a lista é deliberadamente pequena e fechada, não um enum genérico
 * aberto a qualquer string (ver ADR-028, seção "Decisão sobre ADMIN").
 *
 * `accessProfile` é uma distinção de nível de acesso GLOBAL à própria
 * aplicação (ex.: administração da plataforma Ingressa) — nunca uma
 * permissão fina de negócio de um produto consumidor (ADR-007).
 */
export const ACCESS_PROFILES = ["ADMIN"] as const;

export type AccessProfileValue = (typeof ACCESS_PROFILES)[number];

export class ApplicationAccessInvalidProfileError extends DomainError {
  public readonly code = "APPLICATION_ACCESS_INVALID_PROFILE";
  public readonly classification = "VALIDATION" as const;

  constructor(value: string) {
    super(`Perfil de acesso "${value}" não é suportado. Valores válidos: ${ACCESS_PROFILES.join(", ")}.`);
  }
}

/**
 * Value Object AccessProfile.
 *
 * Referência: docs/adr/ADR-028-APPLICATION-ACCESS-E-ACESSO-ADMINISTRATIVO.md.
 */
export class AccessProfile {
  private readonly value: AccessProfileValue;

  private constructor(value: AccessProfileValue) {
    this.value = value;
  }

  public static create(rawValue: string): AccessProfile {
    if (!(ACCESS_PROFILES as readonly string[]).includes(rawValue)) {
      throw new ApplicationAccessInvalidProfileError(rawValue);
    }
    return new AccessProfile(rawValue as AccessProfileValue);
  }

  public static admin(): AccessProfile {
    return new AccessProfile("ADMIN");
  }

  public toString(): AccessProfileValue {
    return this.value;
  }

  public equals(other: AccessProfile): boolean {
    return this.value === other.value;
  }
}
