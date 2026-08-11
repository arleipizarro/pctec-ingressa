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
 * Value Object SystemCode.
 *
 * Enum fechado de sistemas legados conhecidos nesta fase — reconfirmado
 * contra ORGANIZATION-MEMBERSHIP-DESIGN.md §9.2 (auditoria da Fase G):
 * `PCTEC_HUB` (pctcontrol), `PCTEC_HELPDESK` (helpcontrol), `PCTEC_PORTAL`
 * (pctportal). Nenhum sistema fictício adicionado — estes três são os
 * únicos auditados e confirmados como fontes de dado legado de
 * Cliente/Grupo/Empresa.
 *
 * Deliberadamente NÃO inclui `PCTEC_INGRESSA` — o próprio Ingressa nunca
 * é "sistema de origem" de uma referência externa, ele é o destino
 * (`Organization.publicId` é o contrato canônico, ADR-031).
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
