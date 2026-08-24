import { DomainError } from "../../../../shared/errors/DomainError.js";

export type ImportBatchStatusValue = "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";

const VALID_STATUSES: readonly ImportBatchStatusValue[] = ["RUNNING", "COMPLETED", "FAILED", "ABORTED"];

/**
 * Transições permitidas. Um lote nasce RUNNING e termina em exatamente
 * um estado terminal; nenhum estado terminal volta atrás. Reabrir um
 * lote concluído apagaria a explicação do que já foi escrito.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ImportBatchStatusValue, readonly ImportBatchStatusValue[]>> = {
  RUNNING: ["COMPLETED", "FAILED", "ABORTED"],
  COMPLETED: [],
  FAILED: [],
  ABORTED: []
};

export class InvalidImportBatchStatusError extends DomainError {
  public readonly code = "IMPORT_BATCH_STATUS_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`status inválido. Valores aceitos: ${VALID_STATUSES.join(", ")}.`);
  }
}

export class InvalidImportBatchTransitionError extends DomainError {
  public readonly code = "IMPORT_BATCH_TRANSITION_INVALID";
  public readonly classification = "CONFLICT" as const;

  constructor(from: ImportBatchStatusValue, to: ImportBatchStatusValue) {
    super(`Transição de lote inválida: ${from} -> ${to}. Um estado terminal nunca é reaberto.`);
  }
}

export class ImportBatchStatus {
  private constructor(private readonly value: ImportBatchStatusValue) {}

  public static create(rawValue: string): ImportBatchStatus {
    if (!VALID_STATUSES.includes(rawValue as ImportBatchStatusValue)) {
      throw new InvalidImportBatchStatusError();
    }
    return new ImportBatchStatus(rawValue as ImportBatchStatusValue);
  }

  public static running(): ImportBatchStatus {
    return new ImportBatchStatus("RUNNING");
  }

  public canTransitionTo(next: ImportBatchStatus): boolean {
    return ALLOWED_TRANSITIONS[this.value].includes(next.value);
  }

  public assertCanTransitionTo(next: ImportBatchStatus): void {
    if (!this.canTransitionTo(next)) {
      throw new InvalidImportBatchTransitionError(this.value, next.value);
    }
  }

  public isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this.value].length === 0;
  }

  public isCompleted(): boolean {
    return this.value === "COMPLETED";
  }

  public toString(): ImportBatchStatusValue {
    return this.value;
  }

  public equals(other: ImportBatchStatus): boolean {
    return this.value === other.value;
  }
}
