import { DomainError } from "../../../../shared/errors/DomainError.js";

export const IDENTITY_STATUSES = [
  "PENDING",
  "ACTIVE",
  "BLOCKED",
  "INACTIVE",
  "DELETED"
] as const;

export type IdentityStatusValue = (typeof IDENTITY_STATUSES)[number];

export class InvalidIdentityStatusTransitionError extends DomainError {
  public readonly code = "IDENTITY_STATUS_TRANSITION_INVALID";
  public readonly classification = "CONFLICT" as const;

  constructor(from: IdentityStatusValue, to: IdentityStatusValue) {
    super(`Transição de status inválida: ${from} → ${to}.`);
  }
}

export class IdentityDeletedError extends DomainError {
  public readonly code = "IDENTITY_DELETED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("A identidade está excluída logicamente (status = DELETED); a operação não é permitida.");
  }
}

/**
 * Máquina de estados de Identity, conforme
 * docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seção 10.
 *
 * DELETED é terminal: nenhuma transição sai dele pelo fluxo operacional
 * comum (ADR-019, ADR-020).
 */
const ALLOWED_TRANSITIONS: Record<IdentityStatusValue, readonly IdentityStatusValue[]> = {
  PENDING: ["ACTIVE", "INACTIVE", "DELETED"],
  ACTIVE: ["BLOCKED", "INACTIVE", "DELETED"],
  BLOCKED: ["ACTIVE", "INACTIVE", "DELETED"],
  INACTIVE: ["ACTIVE", "DELETED"],
  DELETED: []
};

/**
 * Value Object IdentityStatus.
 *
 * Referência: docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md, seções 6, 7, 10.
 */
export class IdentityStatus {
  private readonly value: IdentityStatusValue;

  private constructor(value: IdentityStatusValue) {
    this.value = value;
  }

  public static fromString(value: string): IdentityStatus {
    if (!(IDENTITY_STATUSES as readonly string[]).includes(value)) {
      throw new Error(`Valor de status desconhecido: "${value}".`);
    }
    return new IdentityStatus(value as IdentityStatusValue);
  }

  public static pending(): IdentityStatus {
    return new IdentityStatus("PENDING");
  }

  public toString(): IdentityStatusValue {
    return this.value;
  }

  public equals(other: IdentityStatus): boolean {
    return this.value === other.value;
  }

  public isDeleted(): boolean {
    return this.value === "DELETED";
  }

  public isActive(): boolean {
    return this.value === "ACTIVE";
  }

  public isBlocked(): boolean {
    return this.value === "BLOCKED";
  }

  /**
   * Valida se a transição para `target` é permitida pela máquina de
   * estados e retorna o novo IdentityStatus. Lança
   * IDENTITY_DELETED se o estado atual já é DELETED (mensagem mais
   * específica que a transição genérica), ou
   * IDENTITY_STATUS_TRANSITION_INVALID para qualquer outra transição não
   * listada.
   */
  public transitionTo(target: IdentityStatusValue): IdentityStatus {
    if (this.value === "DELETED") {
      throw new IdentityDeletedError();
    }
    const allowed = ALLOWED_TRANSITIONS[this.value];
    if (!allowed.includes(target)) {
      throw new InvalidIdentityStatusTransitionError(this.value, target);
    }
    return new IdentityStatus(target);
  }
}
