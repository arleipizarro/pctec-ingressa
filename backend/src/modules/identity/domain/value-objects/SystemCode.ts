import { DomainError } from "../../../../shared/errors/DomainError.js";

export type SystemCodeValue = "PCTEC_HUB" | "PCTEC_HELPDESK" | "PCTEC_PORTAL";

const VALID_SYSTEM_CODES: readonly SystemCodeValue[] = ["PCTEC_HUB", "PCTEC_HELPDESK", "PCTEC_PORTAL"];

export class InvalidSystemCodeError extends DomainError {
  public readonly code = "SYSTEM_CODE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`systemCode inválido. Valores aceitos: ${VALID_SYSTEM_CODES.join(", ")}.`);
  }
}

/**
 * Value Object SystemCode — cópia deliberada de modules/organization/domain/value-objects/SystemCode.ts.
 *
 * **Sem import cross-module** — a mesma filosofia de "tabela paralela"
 * aplicada ao código: `identity_external_references` é paralela a
 * `organization_external_references`, e o domínio identity não depende
 * do domínio organization. Copiar é correto aqui.
 *
 * Enum fechado de sistemas legados conhecidos: `PCTEC_HUB` (pctcontrol),
 * `PCTEC_HELPDESK` (helpcontrol), `PCTEC_PORTAL` (pctportal). Nenhum
 * sistema fictício adicionado.
 */
export class SystemCode {
  private readonly value: SystemCodeValue;

  private constructor(value: SystemCodeValue) {
    this.value = value;
  }

  public static create(rawValue: string): SystemCode {
    if (!VALID_SYSTEM_CODES.includes(rawValue as SystemCodeValue)) {
      throw new InvalidSystemCodeError();
    }
    return new SystemCode(rawValue as SystemCodeValue);
  }

  public toString(): SystemCodeValue {
    return this.value;
  }

  public equals(other: SystemCode): boolean {
    return this.value === other.value;
  }
}
