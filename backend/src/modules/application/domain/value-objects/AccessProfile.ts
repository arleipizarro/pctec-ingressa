import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Perfis de acesso global previstos.
 *
 * **G3 (v0.6.x) — extensão formal, conforme ADR-028 já previa
 * explicitamente ("Novos perfis exigem nova decisão formal... nunca uma
 * string arbitrária aceita silenciosamente"):** `USER` foi adicionado —
 * ver ADR-032 para o raciocínio completo. `ADMIN` continua
 * representando administração da PRÓPRIA aplicação (ex.: administração
 * da plataforma Ingressa); `USER` representa uso comum de uma aplicação
 * consumidora (ex.: um cliente final autorizado a usar o Portal) — a
 * mesma distinção "administração da plataforma ou uso comum" que
 * ADR-028 já registrava em prosa, agora com um segundo valor formal.
 *
 * `accessProfile` é uma distinção de nível de acesso GLOBAL à própria
 * aplicação (ex.: administração da plataforma Ingressa) — nunca uma
 * permissão fina de negócio de um produto consumidor (ADR-007).
 */
export const ACCESS_PROFILES = ["ADMIN", "USER"] as const;

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

  public static user(): AccessProfile {
    return new AccessProfile("USER");
  }

  public toString(): AccessProfileValue {
    return this.value;
  }

  public equals(other: AccessProfile): boolean {
    return this.value === other.value;
  }
}
