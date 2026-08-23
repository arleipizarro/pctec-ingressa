import { PublicId } from "./value-objects/PublicId.js";
import { MembershipProfile } from "./value-objects/MembershipProfile.js";
import { MembershipScope } from "./value-objects/MembershipScope.js";
import {
  type EventEnvelopeInput,
  type MembershipCreatedEvent,
  type MembershipUpdatedEvent,
  createMembershipCreatedEvent,
  createMembershipUpdatedEvent
} from "./events/MembershipDomainEvents.js";
import { MembershipAlreadyEndedError, InvalidMembershipEndReasonError } from "./errors/MembershipErrors.js";

export type MembershipStatusValue = "ACTIVE" | "INACTIVE";

export interface CreateMembershipProps {
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface MembershipPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly status: string;
  readonly startedAt: Date;
  readonly endedAt?: Date | undefined;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Aggregate Root Membership.
 *
 * Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md;
 * docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md, §4/§4.1.
 *
 * Vincula `Identity` ↔ `Organization` — G2 (v0.6.x). Referências
 * cross-aggregate (`identityPublicId`, `organizationPublicId`) são
 * `string` simples, não Value Objects de outros módulos — mesmo
 * precedente já usado por `ApplicationAccess` (identityPublicId/
 * applicationPublicId como `string`), evitando acoplamento estrutural
 * entre bounded contexts.
 *
 * **`profile` é relação, nunca autorização** (§4.1) — este Aggregate não
 * interpreta `profile` de nenhuma forma além de armazená-lo; nenhuma
 * lógica condicional aqui jamais decide "o que a Identity pode fazer"
 * com base em `profile` ou `scope`.
 *
 * G2 — escopo autorizado: só `create()` + `reconstitute()`. **P1D.1
 * acrescentou `end()`** — o encerramento de vínculo que a decisão de
 * lifecycle abaixo já havia fechado e deixado fora do escopo de G2.
 * `version` passou a ser incrementada por ele, exatamente como a
 * migration previa. `reactivate()` continua fora de escopo: não houve
 * necessidade concreta, e um comando sem caso de uso real é desenho
 * especulativo. `create()` continua sempre produzindo
 * `status=ACTIVE`/`endedAt=undefined`.
 *
 * **Decisão fechada sobre lifecycle (revisão do Product Owner, antes do
 * commit de G2): encerrar (`end()`) e reativar (`reactivate()`) — ambos
 * comandos futuros, fora de escopo G2 — SEMPRE operam sobre a MESMA
 * linha.** Nunca existe uma segunda linha para a mesma
 * (identity, organization, profile), mesmo depois de um ciclo
 * encerrar→reativar. Isso é o que torna `uk_membership_unique`
 * (não condicionada a status, migration 0012) correta e definitiva —
 * não um gap a resolver depois, e nenhuma migration futura precisa
 * alterá-la. Mesmo princípio já usado por `Identity` (uma única linha,
 * transições de status via comando, histórico via `audit_events`
 * através dos eventos `membership.created`/`membership.updated` já
 * catalogados — nunca uma segunda linha "reencarnando" o mesmo vínculo).
 */
export class Membership {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly identityPublicId: string;
  private readonly organizationPublicId: string;
  private readonly profile: MembershipProfile;
  private readonly scope: MembershipScope;
  // Mutáveis a partir de P1D.1 (comando `end()`): a transição de status
  // acontece SEMPRE na mesma linha — nunca uma segunda linha
  // "reencarnando" o vínculo (decisão de lifecycle, nota de classe).
  private status: MembershipStatusValue;
  private readonly startedAt: Date;
  private endedAt: Date | undefined;
  private version: number;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private readonly domainEvents: Array<MembershipCreatedEvent | MembershipUpdatedEvent> = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    identityPublicId: string;
    organizationPublicId: string;
    profile: MembershipProfile;
    scope: MembershipScope;
    status: MembershipStatusValue;
    startedAt: Date;
    endedAt: Date | undefined;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.identityPublicId = props.identityPublicId;
    this.organizationPublicId = props.organizationPublicId;
    this.profile = props.profile;
    this.scope = props.scope;
    this.status = props.status;
    this.startedAt = props.startedAt;
    this.endedAt = props.endedAt;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  // ---------------------------------------------------------------------
  // Criação (comando CreateMembership)
  // ---------------------------------------------------------------------

  /**
   * Constrói o Aggregate. **Pré-condições garantidas pelo chamador
   * (`CreateMembershipService`), não por este método:** `identityPublicId`
   * referencia uma Identity já confirmada como existente, e
   * `organizationPublicId` referencia uma Organization já confirmada
   * como existente E `ACTIVE` — este Aggregate não tem acesso a
   * repositórios para checar isso sozinho (mesmo princípio já usado em
   * `OrganizationRelationship.create()`, G1).
   */
  public static create(props: CreateMembershipProps): Membership {
    const publicId = PublicId.generate();
    const profile = MembershipProfile.create(props.profile);
    const scope = MembershipScope.create(props.scope);
    const now = props.now ?? new Date();

    const membership = new Membership({
      internalId: undefined,
      publicId,
      identityPublicId: props.identityPublicId,
      organizationPublicId: props.organizationPublicId,
      profile,
      scope,
      status: "ACTIVE",
      startedAt: now,
      endedAt: undefined,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    const envelope: EventEnvelopeInput = {
      aggregatePublicId: publicId.toString(),
      actorPublicId: props.actorPublicId,
      correlationId: props.correlationId,
      ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
      occurredAt: now
    };

    membership.recordEvent(
      createMembershipCreatedEvent(envelope, {
        membershipPublicId: publicId.toString(),
        identityPublicId: props.identityPublicId,
        organizationPublicId: props.organizationPublicId,
        scope: scope.toString()
      })
    );

    return membership;
  }

  /**
   * Reconstrói um Membership a partir de estado já persistido. Não
   * valida invariantes de criação e não produz eventos de domínio.
   */
  public static reconstitute(state: MembershipPersistedState): Membership {
    return new Membership({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      identityPublicId: state.identityPublicId,
      organizationPublicId: state.organizationPublicId,
      profile: MembershipProfile.create(state.profile),
      scope: MembershipScope.create(state.scope),
      status: state.status === "ACTIVE" || state.status === "INACTIVE" ? state.status : "INACTIVE",
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      version: state.version,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    });
  }

  // ---------------------------------------------------------------------
  // Encerramento (comando EndMembership — P1D.1)
  // ---------------------------------------------------------------------

  /**
   * Encerra o vínculo: `ACTIVE` → `INACTIVE`, com `endedAt` preenchido.
   *
   * **Opera sempre sobre a MESMA linha** — nunca cria uma segunda,
   * conforme a decisão de lifecycle já fechada (nota de classe). É o que
   * mantém `uk_membership_unique` correta: um par
   * (identity, organization, profile) tem exatamente um registro, e o
   * histórico das transições vive em `audit_events`, não em linhas
   * duplicadas.
   *
   * **Encerrar não apaga**: o vínculo permanece consultável por
   * `findAllByIdentityPublicId` e continua provando que existiu. O que
   * muda é que ele deixa de compor o `PortalContext` — que lê
   * exclusivamente `findActiveByIdentityPublicId`.
   *
   * **`reason` é obrigatório e não vazio.** Uma revogação sem motivo
   * registrado é uma revogação que ninguém consegue explicar depois; o
   * texto vai para o payload de `membership.updated` e daí para
   * `audit_events`.
   *
   * `expectedVersion` implementa o mesmo optimistic locking de
   * `Identity`: quem chama leu uma versão, e a persistência só aceita o
   * `UPDATE` se ela ainda for a corrente.
   *
   * Este comando **não** decide se a revogação é legítima — não conhece
   * ApplicationAccess, não conhece a Organization, não sabe quem é o
   * ator. Ele garante apenas a integridade da transição.
   */
  public end(props: {
    readonly actorPublicId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly causationId?: string | undefined;
    readonly now?: Date | undefined;
  }): void {
    if (this.status !== "ACTIVE") {
      throw new MembershipAlreadyEndedError();
    }
    const reason = props.reason.trim();
    if (reason.length === 0) {
      throw new InvalidMembershipEndReasonError();
    }

    const now = props.now ?? new Date();
    const previousStatus = this.status;

    this.status = "INACTIVE";
    this.endedAt = now;
    this.version += 1;
    this.updatedAt = now;

    const envelope: EventEnvelopeInput = {
      aggregatePublicId: this.publicId.toString(),
      actorPublicId: props.actorPublicId,
      correlationId: props.correlationId,
      ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
      occurredAt: now
    };

    this.recordEvent(
      createMembershipUpdatedEvent(envelope, {
        membershipPublicId: this.publicId.toString(),
        identityPublicId: this.identityPublicId,
        organizationPublicId: this.organizationPublicId,
        previousStatus,
        status: this.status,
        endedAt: now.toISOString(),
        reason
      })
    );
  }

  // ---------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------

  private recordEvent(event: MembershipCreatedEvent | MembershipUpdatedEvent): void {
    this.domainEvents.push(event);
  }

  public pullDomainEvents(): Array<MembershipCreatedEvent | MembershipUpdatedEvent> {
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

  public getIdentityPublicId(): string {
    return this.identityPublicId;
  }

  public getOrganizationPublicId(): string {
    return this.organizationPublicId;
  }

  public getProfile(): MembershipProfile {
    return this.profile;
  }

  public getScope(): MembershipScope {
    return this.scope;
  }

  public getStatus(): MembershipStatusValue {
    return this.status;
  }

  public isActive(): boolean {
    return this.status === "ACTIVE";
  }

  public getStartedAt(): Date {
    return this.startedAt;
  }

  public getEndedAt(): Date | undefined {
    return this.endedAt;
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

  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
