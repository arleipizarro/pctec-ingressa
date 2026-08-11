import { DomainError } from "../../../../shared/errors/DomainError.js";

export class InvalidLegacyIdError extends DomainError {
  public readonly code = "LEGACY_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("legacyId deve ser um inteiro positivo (id BIGINT do sistema legado).");
  }
}

/**
 * Value Object LegacyId.
 *
 * Representa o identificador LOCAL de um sistema legado (HUB/Helpdesk/
 * Portal) — um `id INT`/`BIGINT` autoincrement daquele sistema,
 * serializado de forma canônica (string de dígitos, sem formatação).
 *
 * **`legacyId` NUNCA vira contrato externo.** Nunca é exposto como
 * identificador de Organization em nenhuma API, evento ou payload — é
 * usado exclusivamente para rastreabilidade/correlação dentro de
 * `OrganizationExternalReference` (ADR-031). O único identificador
 * cross-system oficial é `Organization.publicId`.
 */
export class LegacyId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Aceita number ou string numérica; sempre normaliza para string de dígitos, sem sinal, sem casas decimais. */
  public static create(rawValue: string | number): LegacyId {
    const asString = String(rawValue).trim();
    if (!/^[1-9][0-9]*$/.test(asString)) {
      throw new InvalidLegacyIdError();
    }
    return new LegacyId(asString);
  }

  public toString(): string {
    return this.value;
  }

  public toNumber(): number {
    return Number(this.value);
  }

  public equals(other: LegacyId): boolean {
    return this.value === other.value;
  }
}
