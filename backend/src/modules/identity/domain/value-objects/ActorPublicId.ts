import { DomainError } from "../../../../shared/errors/DomainError.js";
import { PublicId } from "./PublicId.js";

export class ActorRequiredError extends DomainError {
  public readonly code = "ACTOR_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "Todo comando que altera uma Identity de forma relevante exige um actor identificado."
    );
  }
}

/**
 * Value Object ActorPublicId.
 *
 * Representa "quem realizou a ação de domínio" (ver Linguagem Ubíqua,
 * termo `Actor`). Pode ser o `public_id` de uma Identity humana, ou o
 * marcador reservado `SYSTEM`, usado quando a ação é disparada por um
 * processo automatizado interno ao domínio (ver termo `System Actor`).
 *
 * Ausência de actor em um comando que o exige é sempre um erro de domínio
 * (`ACTOR_REQUIRED`) — nunca um valor padrão silencioso.
 */
export class ActorPublicId {
  public static readonly SYSTEM_MARKER = "SYSTEM" as const;

  private readonly value: string;
  private readonly isSystem: boolean;

  private constructor(value: string, isSystem: boolean) {
    this.value = value;
    this.isSystem = isSystem;
  }

  /** Actor humano, identificado por seu PublicId de Identity. */
  public static fromIdentityPublicId(publicId: PublicId): ActorPublicId {
    return new ActorPublicId(publicId.toString(), false);
  }

  /** Actor do sistema (processo automatizado interno, sem Identity humana responsável). */
  public static system(): ActorPublicId {
    return new ActorPublicId(ActorPublicId.SYSTEM_MARKER, true);
  }

  /**
   * Constrói um ActorPublicId a partir de um valor opcional, lançando
   * ACTOR_REQUIRED se ausente. Uso típico na borda dos Application
   * Services, antes de invocar comandos do Aggregate.
   */
  public static required(value: string | undefined | null): ActorPublicId {
    if (value === undefined || value === null || value.trim().length === 0) {
      throw new ActorRequiredError();
    }
    if (value === ActorPublicId.SYSTEM_MARKER) {
      return ActorPublicId.system();
    }
    return ActorPublicId.fromIdentityPublicId(PublicId.fromString(value));
  }

  public isSystemActor(): boolean {
    return this.isSystem;
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: ActorPublicId): boolean {
    return this.value === other.value;
  }
}
