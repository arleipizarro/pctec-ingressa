import { PublicId } from "./value-objects/PublicId.js";
import { IdentityType } from "./value-objects/IdentityType.js";
import { IdentityName } from "./value-objects/IdentityName.js";
import { Email } from "./value-objects/Email.js";
import { Cpf } from "./value-objects/Cpf.js";
import { IdentityStatus, type IdentityStatusValue } from "./value-objects/IdentityStatus.js";
import { ActorPublicId } from "./value-objects/ActorPublicId.js";
import { DeletionReason } from "./value-objects/DeletionReason.js";
import { IdentityDeletedError } from "./value-objects/IdentityStatus.js";
import { IdentityVersionConflictError } from "./errors/IdentityErrors.js";
import {
  type IdentityDomainEvent,
  type EventEnvelopeInput,
  createIdentityCreatedEvent,
  createIdentityNameUpdatedEvent,
  createIdentityEmailChangeRequestedEvent,
  createIdentityEmailChangedEvent,
  createIdentityLoginEnabledEvent,
  createIdentityLoginDisabledEvent,
  createIdentityActivatedEvent,
  createIdentityBlockedEvent,
  createIdentityUnblockedEvent,
  createIdentityInactivatedEvent,
  createIdentityReactivatedEvent,
  createIdentityDeletedEvent
} from "./events/IdentityDomainEvents.js";

export interface CreateIdentityProps {
  readonly type: string;
  readonly fullName: string;
  readonly email: string;
  readonly cpf?: string | undefined;
  readonly actor: ActorPublicId;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/**
 * Entrada de `Identity.createFoundational()` — deliberadamente SEM
 * `type` (sempre `HUMAN`) e SEM `actor` (não existe Actor real no
 * bootstrap). Ver `docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md`.
 */
export interface CreateFoundationalIdentityProps {
  readonly fullName: string;
  readonly email: string;
  readonly cpf?: string | undefined;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface IdentityPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly type: string;
  readonly fullName: string;
  readonly email: string;
  readonly emailNormalized: string;
  readonly cpf?: string | undefined;
  readonly cpfNormalized?: string | undefined;
  readonly status: string;
  readonly loginEnabled: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly createdByPublicId?: string | undefined;
  readonly updatedAt: Date;
  readonly updatedByPublicId?: string | undefined;
  readonly deletedAt?: Date | undefined;
  readonly deletedByPublicId?: string | undefined;
  readonly deletionReason?: string | undefined;
}

/**
 * Aggregate Root Identity.
 *
 * Referência: docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md.
 *
 * Regras estruturais impostas por este Aggregate (não repetidas em cada
 * método):
 * - Nenhuma senha, hash ou segredo de autenticação existe aqui (ADR-022).
 * - Nenhum IdentityProfile é filho deste agregado (ADR-025).
 * - `internalId` nunca é exposto por método público de domínio — apenas
 *   por `getInternalIdForPersistence()`, de uso exclusivo da camada de
 *   infraestrutura (mappers/repository).
 * - Toda mutação relevante exige um `ActorPublicId` e produz um evento de
 *   domínio, coletado internamente e lido via `pullDomainEvents()`.
 * - Concorrência controlada por `version` (optimistic locking, ADR-024):
 *   todo comando que muta uma Identity já existente recebe a
 *   `expectedVersion` e a compara com a versão interna atual antes de
 *   aplicar a mudança.
 */
export class Identity {
  /**
   * Marcador reservado usado EXCLUSIVAMENTE no `actorPublicId` do evento
   * de domínio produzido por `createFoundational()` — nunca em
   * `createdByPublicId`/`updatedByPublicId` (que ficam `undefined`/`NULL`
   * para a Identity fundacional). Distinto de `ActorPublicId.SYSTEM_MARKER`
   * por design (ADR-027): o bootstrap é um evento único na vida da
   * plataforma, não um processo automatizado recorrente.
   */
  public static readonly BOOTSTRAP_EVENT_ACTOR_MARKER = "BOOTSTRAP" as const;

  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly type: IdentityType;
  private fullName: IdentityName;
  private email: Email;
  private cpf: Cpf | undefined;
  private status: IdentityStatus;
  private loginEnabled: boolean;
  private version: number;
  private readonly createdAt: Date;
  private readonly createdByPublicId: ActorPublicId | undefined;
  private updatedAt: Date;
  private updatedByPublicId: ActorPublicId | undefined;
  private deletedAt: Date | undefined;
  private deletedByPublicId: ActorPublicId | undefined;
  private deletionReason: DeletionReason | undefined;

  private readonly domainEvents: IdentityDomainEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    type: IdentityType;
    fullName: IdentityName;
    email: Email;
    cpf: Cpf | undefined;
    status: IdentityStatus;
    loginEnabled: boolean;
    version: number;
    createdAt: Date;
    createdByPublicId: ActorPublicId | undefined;
    updatedAt: Date;
    updatedByPublicId: ActorPublicId | undefined;
    deletedAt: Date | undefined;
    deletedByPublicId: ActorPublicId | undefined;
    deletionReason: DeletionReason | undefined;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.type = props.type;
    this.fullName = props.fullName;
    this.email = props.email;
    this.cpf = props.cpf;
    this.status = props.status;
    this.loginEnabled = props.loginEnabled;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.createdByPublicId = props.createdByPublicId;
    this.updatedAt = props.updatedAt;
    this.updatedByPublicId = props.updatedByPublicId;
    this.deletedAt = props.deletedAt;
    this.deletedByPublicId = props.deletedByPublicId;
    this.deletionReason = props.deletionReason;
  }

  // ---------------------------------------------------------------------
  // Criação (comando CreateIdentity)
  // ---------------------------------------------------------------------

  public static create(props: CreateIdentityProps): Identity {
    const type = IdentityType.forCreation(props.type);
    const fullName = IdentityName.create(props.fullName);
    const email = Email.create(props.email);
    const cpf = Cpf.createOptional(props.cpf);
    const now = props.now ?? new Date();
    const publicId = PublicId.generate();
    const status = IdentityStatus.pending();

    const identity = new Identity({
      internalId: undefined,
      publicId,
      type,
      fullName,
      email,
      cpf,
      status,
      loginEnabled: false,
      version: 1,
      createdAt: now,
      createdByPublicId: props.actor,
      updatedAt: now,
      updatedByPublicId: props.actor,
      deletedAt: undefined,
      deletedByPublicId: undefined,
      deletionReason: undefined
    });

    identity.recordEvent(
      createIdentityCreatedEvent(
        identity.envelope(props.actor, props.correlationId, props.causationId, now),
        {
          publicId: publicId.toString(),
          type: type.toString(),
          email: email.toString(),
          status: status.toString()
        }
      )
    );

    return identity;
  }

  /**
   * Cria a Identity FUNDACIONAL da plataforma — usada exclusivamente pelo
   * processo de bootstrap (v0.5.0, ver `docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md`),
   * quando ainda não existe nenhuma Identity autenticada capaz de atuar
   * como `Actor`.
   *
   * Diferenças deliberadas em relação a `create()`:
   *
   * - Não recebe (nem aceita) `actor`: não existe Actor real para esta
   *   operação — é precisamente o problema que o bootstrap resolve.
   * - `createdByPublicId`/`updatedByPublicId` ficam `undefined` — nunca
   *   um marcador fingindo ser um `public_id` de Identity (ADR-027,
   *   correção "não usar 'BOOTSTRAP' como Identity public ID"). Isso é
   *   persistido como `NULL` em `identities.created_by_identity_public_id`
   *   sem qualquer alteração em `MariaDbIdentityRepository.insert()` —
   *   o método já trata `undefined` corretamente (`createdBy ?? null`).
   * - O evento de domínio `identity.created` é construído diretamente
   *   aqui (não via `envelope()`, que exige um `ActorPublicId` real, usado
   *   por todo o resto dos comandos de mutação — nenhum deles é tocado
   *   por este método), com `actorPublicId` fixado no marcador reservado
   *   `BOOTSTRAP_EVENT_ACTOR_MARKER` — usado SOMENTE aqui, SOMENTE no
   *   evento/auditoria, nunca em `createdByPublicId`.
   * - `type` é sempre `HUMAN`, fixo — nenhum parâmetro de tipo é aceito
   *   (o CLI de bootstrap não deve poder escolher outro tipo).
   *
   * Nenhum outro comportamento de `Identity` é alterado por este método
   * — é aditivo, isolado, e não modifica `create()` nem qualquer comando
   * de mutação existente.
   */
  public static createFoundational(props: CreateFoundationalIdentityProps): Identity {
    const type = IdentityType.human();
    const fullName = IdentityName.create(props.fullName);
    const email = Email.create(props.email);
    const cpf = Cpf.createOptional(props.cpf);
    const now = props.now ?? new Date();
    const publicId = PublicId.generate();
    const status = IdentityStatus.pending();

    const identity = new Identity({
      internalId: undefined,
      publicId,
      type,
      fullName,
      email,
      cpf,
      status,
      loginEnabled: false,
      version: 1,
      createdAt: now,
      createdByPublicId: undefined,
      updatedAt: now,
      updatedByPublicId: undefined,
      deletedAt: undefined,
      deletedByPublicId: undefined,
      deletionReason: undefined
    });

    const envelope: EventEnvelopeInput = {
      aggregatePublicId: publicId.toString(),
      actorPublicId: Identity.BOOTSTRAP_EVENT_ACTOR_MARKER,
      correlationId: props.correlationId,
      ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
      occurredAt: now
    };

    identity.recordEvent(
      createIdentityCreatedEvent(envelope, {
        publicId: publicId.toString(),
        type: type.toString(),
        email: email.toString(),
        status: status.toString()
      })
    );

    return identity;
  }

  /**
   * Reconstrói uma Identity a partir de estado já persistido. Não valida
   * invariantes de criação (dado confiável, já validado no passado) e não
   * produz eventos de domínio.
   */
  public static reconstitute(state: IdentityPersistedState): Identity {
    return new Identity({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      type: IdentityType.fromString(state.type),
      fullName: IdentityName.create(state.fullName),
      email: Email.fromPersistence(state.email, state.emailNormalized),
      cpf:
        state.cpf !== undefined && state.cpfNormalized !== undefined
          ? Cpf.fromPersistence(state.cpf, state.cpfNormalized)
          : undefined,
      status: IdentityStatus.fromString(state.status),
      loginEnabled: state.loginEnabled,
      version: state.version,
      createdAt: state.createdAt,
      createdByPublicId:
        state.createdByPublicId !== undefined
          ? ActorPublicId.required(state.createdByPublicId)
          : undefined,
      updatedAt: state.updatedAt,
      updatedByPublicId:
        state.updatedByPublicId !== undefined
          ? ActorPublicId.required(state.updatedByPublicId)
          : undefined,
      deletedAt: state.deletedAt,
      deletedByPublicId:
        state.deletedByPublicId !== undefined
          ? ActorPublicId.required(state.deletedByPublicId)
          : undefined,
      deletionReason:
        state.deletionReason !== undefined ? DeletionReason.create(state.deletionReason) : undefined
    });
  }

  // ---------------------------------------------------------------------
  // Comandos de mutação
  // ---------------------------------------------------------------------

  public updateName(input: {
    fullName: string;
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.assertNotDeleted();
    this.assertVersion(input.expectedVersion);
    const fullName = IdentityName.create(input.fullName);
    const now = input.now ?? new Date();

    this.fullName = fullName;
    this.touch(input.actor, now);
    this.bumpVersion();

    this.recordEvent(
      createIdentityNameUpdatedEvent(this.envelope(input.actor, input.correlationId, input.causationId, now), {
        publicId: this.publicId.toString(),
        fullName: fullName.toString()
      })
    );
  }

  public requestEmailChange(input: {
    newEmail: string;
    actor: ActorPublicId;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.assertNotDeleted();
    const newEmail = Email.create(input.newEmail);
    const now = input.now ?? new Date();

    // Não muta o e-mail efetivo — apenas sinaliza a intenção (ver
    // ConfirmEmailChange). Não incrementa version, pois nenhum estado
    // persistido de Identity muda aqui.
    this.recordEvent(
      createIdentityEmailChangeRequestedEvent(
        this.envelope(input.actor, input.correlationId, input.causationId, now),
        {
          publicId: this.publicId.toString(),
          requestedEmail: newEmail.toString()
        }
      )
    );
  }

  public confirmEmailChange(input: {
    newEmail: string;
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.assertNotDeleted();
    this.assertVersion(input.expectedVersion);
    const newEmail = Email.create(input.newEmail);
    const now = input.now ?? new Date();

    this.email = newEmail;
    this.touch(input.actor, now);
    this.bumpVersion();

    this.recordEvent(
      createIdentityEmailChangedEvent(this.envelope(input.actor, input.correlationId, input.causationId, now), {
        publicId: this.publicId.toString(),
        email: newEmail.toString()
      })
    );
  }

  /**
   * Habilita login. Idempotente: repetir sobre uma identidade já com
   * loginEnabled=true não falha, não incrementa version e não reemite
   * evento (ver IDENTITY-DOMAIN-DESIGN.md, seção 8, recomendação
   * registrada para EnableLogin).
   */
  public enableLogin(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.assertNotDeleted();
    if (this.loginEnabled) {
      return;
    }
    this.assertVersion(input.expectedVersion);
    const now = input.now ?? new Date();

    this.loginEnabled = true;
    this.touch(input.actor, now);
    this.bumpVersion();

    this.recordEvent(
      createIdentityLoginEnabledEvent(this.envelope(input.actor, input.correlationId, input.causationId, now), {
        publicId: this.publicId.toString()
      })
    );
  }

  /**
   * Ativa a Identity como parte do bootstrap da primeira Credential
   * (v0.5.x, Fase C — ADR-029) — mesma transição `PENDING → ACTIVE` de
   * `activate()`, mas SEM receber um `actor` externo: internamente usa
   * `ActorPublicId.bootstrap()`, produzindo um evento com
   * `actorPublicId = "BOOTSTRAP"`, mesmo princípio já usado por
   * `createFoundational()` (ADR-027) e por
   * `ApplicationAccess.grantFoundationalAdminAccess()` (ADR-028).
   *
   * **Uso exclusivo de `BootstrapFirstCredentialService`.** Deliberadamente
   * não reutiliza `activate({ actor: ActorPublicId.bootstrap(), ... })`
   * a partir do serviço — o serviço nunca importa nem constrói
   * `ActorPublicId.bootstrap()` diretamente; só `Identity` conhece esse
   * marcador reservado, mantendo-o localizado (revisão crítica: uma
   * primeira versão desta funcionalidade ampliava `ActorPublicId` para
   * reconhecer `"BOOTSTRAP"` genericamente via `required()`, o que teria
   * permitido que QUALQUER string externa fosse aceita como esse actor —
   * corrigido).
   */
  public activateForCredentialBootstrap(input: {
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.activate({ actor: ActorPublicId.bootstrap(), ...input });
  }

  /**
   * Habilita login como parte do bootstrap da primeira Credential
   * (v0.5.x, Fase C — ADR-029) — mesmo princípio de
   * `activateForCredentialBootstrap()` acima, aplicado a `enableLogin()`.
   */
  public enableLoginForCredentialBootstrap(input: {
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.enableLogin({ actor: ActorPublicId.bootstrap(), ...input });
  }

  /** Desabilita login. Idempotente, mesmo padrão de `enableLogin`. */
  public disableLogin(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.assertNotDeleted();
    if (!this.loginEnabled) {
      return;
    }
    this.assertVersion(input.expectedVersion);
    const now = input.now ?? new Date();

    this.loginEnabled = false;
    this.touch(input.actor, now);
    this.bumpVersion();

    this.recordEvent(
      createIdentityLoginDisabledEvent(this.envelope(input.actor, input.correlationId, input.causationId, now), {
        publicId: this.publicId.toString()
      })
    );
  }

  public activate(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.transitionStatus("ACTIVE", input, (envelope) =>
      createIdentityActivatedEvent(envelope, { publicId: this.publicId.toString() })
    );
  }

  public block(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    reasonCode?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.transitionStatus("BLOCKED", input, (envelope) =>
      createIdentityBlockedEvent(envelope, {
        publicId: this.publicId.toString(),
        ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {})
      })
    );
  }

  public unblock(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.transitionStatus("ACTIVE", input, (envelope) =>
      createIdentityUnblockedEvent(envelope, { publicId: this.publicId.toString() })
    );
  }

  public inactivate(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.transitionStatus("INACTIVE", input, (envelope) =>
      createIdentityInactivatedEvent(envelope, { publicId: this.publicId.toString() })
    );
  }

  public reactivate(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    this.transitionStatus("ACTIVE", input, (envelope) =>
      createIdentityReactivatedEvent(envelope, { publicId: this.publicId.toString() })
    );
  }

  public logicallyDelete(input: {
    actor: ActorPublicId;
    expectedVersion: number;
    deletionReason: string;
    correlationId: string;
    causationId?: string | undefined;
    now?: Date | undefined;
  }): void {
    const reason = DeletionReason.create(input.deletionReason);
    const now = input.now ?? new Date();

    this.assertVersion(input.expectedVersion);
    this.status = this.status.transitionTo("DELETED");
    this.loginEnabled = false;
    this.deletedAt = now;
    this.deletedByPublicId = input.actor;
    this.deletionReason = reason;
    this.touch(input.actor, now);
    this.bumpVersion();

    this.recordEvent(
      createIdentityDeletedEvent(this.envelope(input.actor, input.correlationId, input.causationId, now), {
        publicId: this.publicId.toString(),
        deletionReason: reason.toString()
      })
    );
  }

  // ---------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------

  private transitionStatus(
    target: IdentityStatusValue,
    input: {
      actor: ActorPublicId;
      expectedVersion: number;
      correlationId: string;
      causationId?: string | undefined;
      now?: Date | undefined;
    },
    buildEvent: (envelope: EventEnvelopeInput) => IdentityDomainEvent
  ): void {
    this.assertVersion(input.expectedVersion);
    const now = input.now ?? new Date();

    this.status = this.status.transitionTo(target);
    this.touch(input.actor, now);
    this.bumpVersion();

    this.recordEvent(buildEvent(this.envelope(input.actor, input.correlationId, input.causationId, now)));
  }

  private assertNotDeleted(): void {
    if (this.status.isDeleted()) {
      throw new IdentityDeletedError();
    }
  }

  private assertVersion(expectedVersion: number): void {
    if (expectedVersion !== this.version) {
      throw new IdentityVersionConflictError(expectedVersion, this.version);
    }
  }

  private bumpVersion(): void {
    this.version += 1;
  }

  private touch(actor: ActorPublicId, now: Date): void {
    this.updatedAt = now;
    this.updatedByPublicId = actor;
  }

  private envelope(
    actor: ActorPublicId,
    correlationId: string,
    causationId: string | undefined,
    occurredAt: Date
  ): EventEnvelopeInput {
    return {
      aggregatePublicId: this.publicId.toString(),
      actorPublicId: actor.toString(),
      correlationId,
      ...(causationId !== undefined ? { causationId } : {}),
      occurredAt
    };
  }

  private recordEvent(event: IdentityDomainEvent): void {
    this.domainEvents.push(event);
  }

  /** Retorna e limpa os eventos de domínio produzidos desde a última leitura. */
  public pullDomainEvents(): IdentityDomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;
    return events;
  }

  // ---------------------------------------------------------------------
  // Leituras públicas (nunca expõem internalId)
  // ---------------------------------------------------------------------

  public getPublicId(): PublicId {
    return this.publicId;
  }

  public getType(): IdentityType {
    return this.type;
  }

  public getFullName(): IdentityName {
    return this.fullName;
  }

  public getEmail(): Email {
    return this.email;
  }

  public getCpf(): Cpf | undefined {
    return this.cpf;
  }

  public getStatus(): IdentityStatus {
    return this.status;
  }

  public isLoginEnabled(): boolean {
    return this.loginEnabled;
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

  public getDeletedAt(): Date | undefined {
    return this.deletedAt;
  }

  public getDeletionReason(): DeletionReason | undefined {
    return this.deletionReason;
  }

  /**
   * Retorna a chave interna, exclusivamente para uso da camada de
   * infraestrutura (repository/mapper). NUNCA deve ser chamado por
   * Application Services, testes de domínio ou qualquer código que
   * represente a fronteira pública do agregado — internalId nunca é
   * exposto pelo domínio público (ADR-021).
   */
  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  /**
   * Atribui a chave interna gerada pelo banco após o INSERT inicial. Uso
   * exclusivo da camada de infraestrutura, imediatamente após persistir
   * uma Identity nova.
   */
  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }

  /** Uso exclusivo da camada de infraestrutura (mapeamento de colunas `*_identity_public_id`). */
  public getCreatedAtActorPublicIdForPersistence(): string | undefined {
    return this.createdByPublicId?.toString();
  }

  /** Uso exclusivo da camada de infraestrutura. */
  public getUpdatedByPublicIdForPersistence(): string | undefined {
    return this.updatedByPublicId?.toString();
  }

  /** Uso exclusivo da camada de infraestrutura. */
  public getDeletedByPublicIdForPersistence(): string | undefined {
    return this.deletedByPublicId?.toString();
  }
}
