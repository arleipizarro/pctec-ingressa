import { DomainError } from "../../../../shared/errors/DomainError.js";

export class ApplyWithoutDryRunError extends DomainError {
  public readonly code = "IMPORT_APPLY_WITHOUT_DRY_RUN";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Um lote APPLY exige o publicId de um DRY_RUN de origem. Dry-run é obrigatório.");
  }
}

export class DryRunBatchNotFoundError extends DomainError {
  public readonly code = "IMPORT_DRY_RUN_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`Lote de dry-run não encontrado: ${publicId}.`);
  }
}

export class DryRunBatchNotCompletedError extends DomainError {
  public readonly code = "IMPORT_DRY_RUN_NOT_COMPLETED";
  public readonly classification = "CONFLICT" as const;

  constructor(status: string) {
    super(`O dry-run referenciado está em ${status}; apply exige um dry-run COMPLETED.`);
  }
}

export class DryRunModeMismatchError extends DomainError {
  public readonly code = "IMPORT_DRY_RUN_MODE_MISMATCH";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("O lote referenciado como dry-run não está em mode=DRY_RUN.");
  }
}

export class SourceChangedSinceDryRunError extends DomainError {
  public readonly code = "IMPORT_SOURCE_CHANGED_SINCE_DRY_RUN";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "A origem mudou dentro do escopo desde o dry-run: scopeFingerprint divergente. " +
        "Rode um novo dry-run e aprove-o. Uma aprovação vale para um scopeFingerprint, nunca para outro."
    );
  }
}

export class MappingRulesVersionMismatchError extends DomainError {
  public readonly code = "IMPORT_MAPPING_RULES_VERSION_MISMATCH";
  public readonly classification = "CONFLICT" as const;

  constructor(dryRunVersion: string, applyVersion: string) {
    super(
      `Versão de regras divergente: dry-run usou "${dryRunVersion}" e o apply pediu "${applyVersion}". ` +
        "A mesma origem sob regras diferentes é outro lote."
    );
  }
}

export class SourceSystemMismatchError extends DomainError {
  public readonly code = "IMPORT_SOURCE_SYSTEM_MISMATCH";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("O sistema de origem do apply difere do sistema de origem do dry-run referenciado.");
  }
}

export class ImportBatchNotFoundError extends DomainError {
  public readonly code = "IMPORT_BATCH_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`Lote de importação não encontrado: ${publicId}.`);
  }
}

export class ImportBatchNotRunningError extends DomainError {
  public readonly code = "IMPORT_BATCH_NOT_RUNNING";
  public readonly classification = "CONFLICT" as const;

  constructor(status: string) {
    super(`O lote está em ${status}; só um lote RUNNING aceita novos itens ou mudança de estado.`);
  }
}

export class DryRunCannotWriteError extends DomainError {
  public readonly code = "IMPORT_DRY_RUN_CANNOT_WRITE";
  public readonly classification = "CONFLICT" as const;

  constructor(action: string) {
    super(
      `Um lote DRY_RUN registrou a decisão ${action} com targetPublicId preenchido. ` +
        "Dry-run descreve o que FARIA; nunca aponta para entidade escrita."
    );
  }
}

export class UnapprovedApplyError extends DomainError {
  public readonly code = "IMPORT_APPLY_NOT_APPROVED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Um lote APPLY exige aprovação registrada (aprovador e data) antes de escrever.");
  }
}
