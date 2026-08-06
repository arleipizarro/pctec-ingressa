import { DomainError } from "../../../../shared/errors/DomainError.js";

const MAX_LENGTH = 64;

export class DeletionReasonRequiredError extends DomainError {
  public readonly code = "DELETION_REASON_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Motivo de exclusão (deletion_reason) é obrigatório em LogicallyDeleteIdentity.");
  }
}

/**
 * Value Object DeletionReason.
 *
 * Código categórico (não texto livre) que documenta o motivo de uma
 * exclusão lógica, para auditoria — nunca deve conter nomes, e-mails ou
 * qualquer dado pessoal de terceiros.
 *
 * A lista fechada de valores válidos é **Pendente de decisão** nesta
 * fatia (ver IDENTITY-DOMAIN-DESIGN.md, seção 17); por isso, aceitamos
 * qualquer código não vazio dentro do tamanho máximo, sem validar contra
 * um enum fechado ainda.
 */
export class DeletionReason {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static create(rawValue: string | undefined | null): DeletionReason {
    if (rawValue === undefined || rawValue === null || rawValue.trim().length === 0) {
      throw new DeletionReasonRequiredError();
    }
    const trimmed = rawValue.trim();
    if (trimmed.length > MAX_LENGTH) {
      throw new DeletionReasonRequiredError();
    }
    return new DeletionReason(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: DeletionReason): boolean {
    return this.value === other.value;
  }
}
