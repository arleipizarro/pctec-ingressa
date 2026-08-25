import {
  CredentialNotActiveError,
  CredentialVersionConflictError
} from "./errors/CredentialErrors.js";
import { PublicId } from "./value-objects/PublicId.js";
import { CredentialType } from "./value-objects/CredentialType.js";
import { CredentialStatus } from "./value-objects/CredentialStatus.js";
import { PasswordHash } from "./value-objects/PasswordHash.js";
import {
  createCredentialCreatedEvent,
  createCredentialChangedEvent,
  type CredentialCreatedEvent,
  type CredentialChangedEvent
} from "./events/CredentialDomainEvents.js";

export interface CreateFoundationalCredentialProps {
  readonly identityPublicId: string;
  readonly passwordHash: PasswordHash;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface CredentialPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly type: string;
  readonly passwordHash: string;
  readonly status: string;
  readonly lastAuthenticatedAt?: Date | undefined;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Marcador reservado usado EXCLUSIVAMENTE no `actorPublicId` do evento de
 * domínio produzido por `createFoundational()` — mesmo princípio de
 * `Identity.BOOTSTRAP_EVENT_ACTOR_MARKER` (ADR-027) e
 * `ApplicationAccess.APPLICATION_ACCESS_BOOTSTRAP_EVENT_ACTOR_MARKER`
 * (ADR-028), reaproveitado aqui (ADR-029): a primeira credencial não tem
 * um Actor autenticado real para atribuir.
 */
export const CREDENTIAL_BOOTSTRAP_EVENT_ACTOR_MARKER = "BOOTSTRAP" as const;

/**
 * Aggregate Credential.
 *
 * Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 9 (revisada);
 * docs/adr/ADR-022-CREDENTIAL-SEPARADA-DE-IDENTITY.md;
 * docs/adr/ADR-029-CREDENTIAL-E-AUTENTICACAO.md;
 * docs/03-dominio/CREDENTIAL-AUTH-DESIGN.md.
 *
 * Nesta fatia, o único comando implementado é `createFoundational()` — a
 * criação da primeira credencial da plataforma, one-shot, sem Actor
 * autenticado real (mesmo padrão dos dois bootstraps anteriores). Um
 * comando de criação por fluxo normal (`MagicLink ACTIVATION`, ADR-022) e
 * um comando de rotação (`UPDATE` em lugar, ADR-029) ficam para uma fatia
 * futura — não implementados aqui para não ampliar o escopo além do que
 * esta entrega exige.
 *
 * Existe no máximo UMA linha de `Credential` por `(identity_public_id,
 * type)`, para sempre (ADR-029, "Rotação de senha e unicidade") —
 * garantido pelo banco (`UNIQUE`), não pelo domínio em memória.
 */
/** Eventos que este agregado emite. */
export type CredentialDomainEvent = CredentialCreatedEvent | CredentialChangedEvent;

export class Credential {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly identityPublicId: string;
  private readonly type: CredentialType;
  private passwordHash: PasswordHash;
  private readonly status: CredentialStatus;
  private lastAuthenticatedAt: Date | undefined;
  private version: number;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private readonly domainEvents: CredentialDomainEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    identityPublicId: string;
    type: CredentialType;
    passwordHash: PasswordHash;
    status: CredentialStatus;
    lastAuthenticatedAt: Date | undefined;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.identityPublicId = props.identityPublicId;
    this.type = props.type;
    this.passwordHash = props.passwordHash;
    this.status = props.status;
    this.lastAuthenticatedAt = props.lastAuthenticatedAt;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /**
   * Cria a primeira `Credential` `LOCAL_PASSWORD` da plataforma — usada
   * exclusivamente pelo processo de bootstrap
   * (`BootstrapFirstCredentialService`, ADR-029).
   *
   * Recebe `passwordHash` já calculado (`PasswordHash`, produzido pela
   * camada de infraestrutura de hashing) — o Aggregate nunca conhece a
   * senha em texto puro nem executa hashing, mantendo o domínio livre de
   * dependência de bibliotecas de criptografia.
   */
  public static createFoundational(props: CreateFoundationalCredentialProps): Credential {
    const publicId = PublicId.generate();
    const type = CredentialType.localPassword();
    const status = CredentialStatus.active();
    const now = props.now ?? new Date();

    const credential = new Credential({
      internalId: undefined,
      publicId,
      identityPublicId: props.identityPublicId,
      type,
      passwordHash: props.passwordHash,
      status,
      lastAuthenticatedAt: undefined,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    credential.domainEvents.push(
      createCredentialCreatedEvent(
        {
          aggregatePublicId: publicId.toString(),
          actorPublicId: CREDENTIAL_BOOTSTRAP_EVENT_ACTOR_MARKER,
          correlationId: props.correlationId,
          ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
          occurredAt: now
        },
        {
          credentialPublicId: publicId.toString(),
          identityPublicId: props.identityPublicId,
          type: type.toString()
        }
      )
    );

    return credential;
  }

  /**
   * Cria a `Credential` `LOCAL_PASSWORD` de uma Identity que acabou de
   * definir a própria senha por convite — v1.0.
   *
   * Distinta de `createFoundational()` num único ponto, e é o ponto que
   * importa: aqui EXISTE um ator real — a própria pessoa — então o
   * evento nunca carrega o marcador `"BOOTSTRAP"`. Reutilizar
   * `createFoundational()` faria a auditoria dizer que a plataforma
   * criou a senha, quando quem criou foi o titular.
   *
   * Continua sem conhecer senha em texto puro: recebe o `PasswordHash`
   * já calculado pela infraestrutura, exatamente como as demais
   * fábricas deste agregado.
   */
  public static createForInvitedIdentity(props: CreateFoundationalCredentialProps): Credential {
    const publicId = PublicId.generate();
    const type = CredentialType.localPassword();
    const now = props.now ?? new Date();

    const credential = new Credential({
      internalId: undefined,
      publicId,
      identityPublicId: props.identityPublicId,
      type,
      passwordHash: props.passwordHash,
      status: CredentialStatus.active(),
      lastAuthenticatedAt: undefined,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    credential.domainEvents.push(
      createCredentialCreatedEvent(
        {
          aggregatePublicId: publicId.toString(),
          actorPublicId: props.identityPublicId,
          correlationId: props.correlationId,
          ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
          occurredAt: now
        },
        {
          credentialPublicId: publicId.toString(),
          identityPublicId: props.identityPublicId,
          type: type.toString()
        }
      )
    );

    return credential;
  }

  public static reconstitute(state: CredentialPersistedState): Credential {
    return new Credential({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      identityPublicId: state.identityPublicId,
      type: CredentialType.create(state.type),
      passwordHash: PasswordHash.fromPersistence(state.passwordHash),
      status: CredentialStatus.fromString(state.status),
      lastAuthenticatedAt: state.lastAuthenticatedAt,
      version: state.version,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    });
  }

  public pullDomainEvents(): CredentialDomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;
    return events;
  }

  public getPublicId(): PublicId {
    return this.publicId;
  }

  public getIdentityPublicId(): string {
    return this.identityPublicId;
  }

  public getType(): CredentialType {
    return this.type;
  }

  public getPasswordHash(): PasswordHash {
    return this.passwordHash;
  }

  public getStatus(): CredentialStatus {
    return this.status;
  }

  public isActive(): boolean {
    return this.status.isActive();
  }

  public getLastAuthenticatedAt(): Date | undefined {
    return this.lastAuthenticatedAt;
  }

  public getVersion(): number {
    return this.version;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getUpdatedAt(): Date {
    return this.updatedAt;
  }

  /**
   * Registra uma autenticação bem-sucedida — v0.6.0, Fase D (ADR-030,
   * "`last_authenticated_at` — quando atualizar"). Chamado exclusivamente
   * por `AuthenticateIdentityService`, exclusivamente após
   * `Argon2id.verify()` retornar verdadeiro (nunca em falha de senha,
   * nunca em validação de sessão já existente, nunca em refresh futuro —
   * ver ADR-030 para os três não-gatilhos formais).
   *
   * Não produz nenhum `Domain Event` — `authentication.succeeded` é log
   * operacional/telemetria, não evento de domínio (decisão explícita de
   * ADR-030, "Eventos": a mudança de estado real e auditável é a criação
   * da `Session`, já coberta por `session.created`).
   *
   * Incrementa `version` — a persistência (`CredentialRepository.update`)
   * usa optimistic locking, mesmo padrão já usado para `Identity`.
   */
  /**
   * Redefine a senha de uma credencial existente — recuperação
   * administrativa.
   *
   * NÃO cria credencial nova: a mesma linha muda de hash e sobe de
   * versão. Criar outra deixaria duas credenciais LOCAL_PASSWORD para a
   * mesma identidade, e a autenticação passaria a depender de qual delas
   * o repositório devolvesse primeiro.
   *
   * O Aggregate continua sem conhecer senha em texto puro: recebe o
   * `PasswordHash` já calculado pela infraestrutura, exatamente como em
   * `createFoundational`.
   *
   * `expectedVersion` é comparado aqui e de novo no `WHERE version = ?`
   * do UPDATE: o primeiro dá erro legível, o segundo é a trava real sob
   * concorrência.
   */
  public resetPassword(input: {
    readonly newPasswordHash: PasswordHash;
    readonly actorPublicId: string;
    readonly reasonCode: string;
    readonly expectedVersion: number;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly now?: Date | undefined;
  }): void {
    if (!this.status.isActive()) {
      throw new CredentialNotActiveError(this.status.toString());
    }
    if (this.version !== input.expectedVersion) {
      throw new CredentialVersionConflictError(input.expectedVersion, this.version);
    }

    const agora = input.now ?? new Date();
    this.passwordHash = input.newPasswordHash;
    this.version += 1;
    this.updatedAt = agora;

    this.domainEvents.push(
      createCredentialChangedEvent(
        {
          aggregatePublicId: this.publicId.toString(),
          actorPublicId: input.actorPublicId,
          correlationId: input.correlationId,
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          occurredAt: agora
        },
        {
          credentialPublicId: this.publicId.toString(),
          identityPublicId: this.identityPublicId,
          type: this.type.toString(),
          reasonCode: input.reasonCode
        }
      )
    );
  }

  public recordSuccessfulAuthentication(now: Date = new Date()): void {
    this.lastAuthenticatedAt = now;
    this.updatedAt = now;
    this.version += 1;
  }

  /** Uso exclusivo da camada de infraestrutura — nunca exposto por getter público comum. */
  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
