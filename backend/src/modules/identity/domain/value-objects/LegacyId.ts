import { DomainError } from "../../../../shared/errors/DomainError.js";

export class InvalidLegacyIdError extends DomainError {
  public readonly code = "LEGACY_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("legacyId deve ser um inteiro positivo (id BIGINT do sistema legado).");
  }
}

/**
 * Value Object LegacyId — cópia deliberada de modules/organization/domain/value-objects/LegacyId.ts.
 *
 * **Sem import cross-module** — mesma filosofia de "tabela paralela".
 *
 * Representa o identificador LOCAL de um sistema legado (HUB/Helpdesk/
 * Portal) — um `id INT`/`BIGINT` autoincrement daquele sistema.
 *
 * **`legacyId` NUNCA vira contrato externo.** Nunca é exposto como
 * identificador de Identity em nenhuma API, evento ou payload — é
 * usado exclusivamente para rastreabilidade/correlação dentro de
 * `IdentityExternalReference`. O único identificador cross-system
 * oficial é `Identity.publicId`.
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
