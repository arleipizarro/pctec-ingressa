import { DomainError } from "../../../../shared/errors/DomainError.js";

export type ImportBatchModeValue = "DRY_RUN" | "APPLY";

const VALID_MODES: readonly ImportBatchModeValue[] = ["DRY_RUN", "APPLY"];

export class InvalidImportBatchModeError extends DomainError {
  public readonly code = "IMPORT_BATCH_MODE_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`mode inválido. Valores aceitos: ${VALID_MODES.join(", ")}.`);
  }
}

/**
 * Value Object ImportBatchMode.
 *
 * - `DRY_RUN`: o importador calcula todas as decisões e as grava em
 *   `import_batch_items`, mas NÃO escreve nenhuma entidade de domínio.
 * - `APPLY`: escreve de fato. Exige um `DRY_RUN` COMPLETED de origem com
 *   `scopeFingerprint` idêntico — ver `ImportBatch.startApply`.
 */
export class ImportBatchMode {
  private constructor(private readonly value: ImportBatchModeValue) {}

  public static create(rawValue: string): ImportBatchMode {
    if (!VALID_MODES.includes(rawValue as ImportBatchModeValue)) {
      throw new InvalidImportBatchModeError();
    }
    return new ImportBatchMode(rawValue as ImportBatchModeValue);
  }

  public isApply(): boolean {
    return this.value === "APPLY";
  }

  public isDryRun(): boolean {
    return this.value === "DRY_RUN";
  }

  public toString(): ImportBatchModeValue {
    return this.value;
  }

  public equals(other: ImportBatchMode): boolean {
    return this.value === other.value;
  }
}
