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
 * termo `Actor`). Pode ser o `public_id` de uma Identity humana, o
 * marcador reservado `SYSTEM`, usado quando a ação é disparada por um
 * processo automatizado interno ao domínio (ver termo `System Actor`),
 * ou o marcador reservado `BOOTSTRAP` (ver nota abaixo).
 *
 * Ausência de actor em um comando que o exige é sempre um erro de domínio
 * (`ACTOR_REQUIRED`) — nunca um valor padrão silencioso.
 *
 * **Nota sobre `BOOTSTRAP` (v0.5.x, Fase C — ADR-029; revisão crítica
 * antes do commit):** `ActorPublicId.bootstrap()` existe para permitir
 * que `Identity` construa internamente um actor válido para os métodos
 * bootstrap-específicos `activateForCredentialBootstrap()`/
 * `enableLoginForCredentialBootstrap()` (ver `Identity.ts`) — nunca
 * chamado a partir de `BootstrapFirstCredentialService` ou de qualquer
 * outro Application Service diretamente.
 *
 * **Decisão arquitetural deliberada, revisada em relação a uma primeira
 * tentativa incorreta:** uma primeira versão desta mudança também
 * ensinava `required()` (o método que faz parsing de uma string externa
 * vinda da borda de um Application Service) a reconhecer
 * `"BOOTSTRAP"` — isso tornaria `ActorPublicId.required("BOOTSTRAP")`
 * aceitável a partir de QUALQUER string vinda de fora (ex.: um header
 * HTTP, um corpo de requisição, um argv), contrariando o princípio já
 * estabelecido na ADR-027 de nunca ampliar `ActorPublicId` genericamente
 * só para acomodar bootstrap. **Corrigido:** `required()` permanece
 * exatamente como estava — `bootstrap()` só é alcançável por código que
 * escreve literalmente essa chamada em tempo de compilação, nunca por
 * uma string de entrada não confiável.
 */
export class ActorPublicId {
  public static readonly SYSTEM_MARKER = "SYSTEM" as const;
  public static readonly BOOTSTRAP_MARKER = "BOOTSTRAP" as const;

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
   * Actor do bootstrap — uso exclusivo interno de `Identity`, nos
   * métodos `activateForCredentialBootstrap()`/
   * `enableLoginForCredentialBootstrap()`. NUNCA chamado a partir de
   * `required()` (parsing de string externa) nem diretamente por
   * nenhum Application Service — ver nota da classe acima.
   */
  public static bootstrap(): ActorPublicId {
    return new ActorPublicId(ActorPublicId.BOOTSTRAP_MARKER, false);
  }

  /**
   * Constrói um ActorPublicId a partir de um valor opcional, lançando
   * ACTOR_REQUIRED se ausente. Uso típico na borda dos Application
   * Services, antes de invocar comandos do Aggregate.
   *
   * Deliberadamente NÃO reconhece `"BOOTSTRAP"` aqui — ver nota da
   * classe acima. Uma string `"BOOTSTRAP"` vinda de fora (ex.: de uma
   * requisição HTTP) é tratada como um `publicId` comum e falhará a
   * validação de UUID de `PublicId.fromString()`, nunca sendo aceita
   * como o actor reservado de bootstrap.
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

  public isBootstrapActor(): boolean {
    return this.value === ActorPublicId.BOOTSTRAP_MARKER;
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: ActorPublicId): boolean {
    return this.value === other.value;
  }
}
