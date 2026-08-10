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

  /**
   * Constrói um ActorPublicId a partir de um valor JÁ PERSISTIDO no
   * banco (dado confiável, nunca uma entrada externa não confiável) —
   * v0.6.0, correção de bug pós-publicação. Uso exclusivo de
   * `Identity.reconstitute()`, para `created_by`/`updated_by`/
   * `deleted_by_identity_public_id`.
   *
   * **Diferença deliberada em relação a `required()`:** `required()`
   * faz parsing de uma string EXTERNA, na borda de um Application
   * Service (ex.: um header HTTP, um corpo de requisição) — por isso
   * nunca reconhece `"BOOTSTRAP"` (ver nota da classe acima, e
   * ADR-027: nunca ampliar `ActorPublicId` genericamente só para
   * acomodar bootstrap a partir de entrada não confiável).
   * `fromPersistence()` é diferente: lê um valor que a própria
   * plataforma já gravou no banco, legitimamente, através de um
   * `Application Service` de bootstrap (`activateForCredentialBootstrap()`/
   * `enableLoginForCredentialBootstrap()`, ADR-029) — nesse contexto,
   * `"BOOTSTRAP"` é um dado confiável esperado, não uma tentativa de
   * personificação vinda de fora.
   *
   * **Bug real corrigido:** antes desta correção,
   * `Identity.reconstitute()` usava `required()` para esses três
   * campos — como o bootstrap de `Credential` legitimamente grava
   * `"BOOTSTRAP"` em `updated_by_identity_public_id`, toda tentativa de
   * carregar essa `Identity` (incluindo durante login) falhava com
   * `IDENTITY_PUBLIC_ID_INVALID` (422), mesmo com senha correta — o
   * bug ocorria antes da verificação de senha, na reconstituição da
   * entidade a partir do banco.
   *
   * Semântica:
   * - `"SYSTEM"` → `ActorPublicId.system()`
   * - `"BOOTSTRAP"` → `ActorPublicId.bootstrap()`
   * - UUID válido → `fromIdentityPublicId(PublicId.fromString(value))`
   * - qualquer outro valor → erro (`PublicId.fromString` lança
   *   `InvalidPublicIdError`) — uma string persistida corrompida/
   *   inesperada continua falhando, nunca aceita silenciosamente.
   *
   * Não trata ausência (`undefined`/`null`/vazio) — o chamador
   * (`Identity.reconstitute()`) já guarda essa checagem antes de
   * invocar este método, mesmo padrão já usado por
   * `createdByPublicId`/`updatedByPublicId`/`deletedByPublicId`.
   */
  public static fromPersistence(value: string): ActorPublicId {
    if (value === ActorPublicId.SYSTEM_MARKER) {
      return ActorPublicId.system();
    }
    if (value === ActorPublicId.BOOTSTRAP_MARKER) {
      return ActorPublicId.bootstrap();
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
