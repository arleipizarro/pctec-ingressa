import { DomainError } from "../../../../shared/errors/DomainError.js";

export type ImportActionValue = "CREATE" | "UPDATE" | "SKIP" | "CONFLICT" | "QUARANTINE";

const VALID_ACTIONS: readonly ImportActionValue[] = ["CREATE", "UPDATE", "SKIP", "CONFLICT", "QUARANTINE"];

/** Ações que NÃO escrevem nada no destino, nem em modo APPLY. */
const NON_WRITING: readonly ImportActionValue[] = ["SKIP", "CONFLICT", "QUARANTINE"];

export class InvalidImportActionError extends DomainError {
  public readonly code = "IMPORT_ACTION_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`action inválida. Valores aceitos: ${VALID_ACTIONS.join(", ")}.`);
  }
}

/**
 * Value Object ImportAction — a decisão do importador sobre UM registro.
 *
 * `QUARANTINE` é o fail-closed: ambiguidade nunca vira palpite. Um
 * e-mail que casa com uma Identity existente, um `client_id` órfão, uma
 * empresa sem contrapartida comercial — todos param aqui e esperam
 * decisão humana.
 *
 * `CONFLICT` é diferente: origem e destino divergem de forma que exige
 * decisão, mas a correspondência entre eles não está em dúvida.
 */
export class ImportAction {
  private constructor(private readonly value: ImportActionValue) {}

  public static create(rawValue: string): ImportAction {
    if (!VALID_ACTIONS.includes(rawValue as ImportActionValue)) {
      throw new InvalidImportActionError();
    }
    return new ImportAction(rawValue as ImportActionValue);
  }

  /** `true` quando a ação produz escrita no destino em modo APPLY. */
  public writes(): boolean {
    return !NON_WRITING.includes(this.value);
  }

  public isQuarantine(): boolean {
    return this.value === "QUARANTINE";
  }

  public toString(): ImportActionValue {
    return this.value;
  }

  public equals(other: ImportAction): boolean {
    return this.value === other.value;
  }
}
