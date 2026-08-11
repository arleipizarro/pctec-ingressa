import { PublicId } from "./value-objects/PublicId.js";
import { MembershipProfile } from "./value-objects/MembershipProfile.js";
import { MembershipScope } from "./value-objects/MembershipScope.js";
import {
  type EventEnvelopeInput,
  type MembershipCreatedEvent,
  createMembershipCreatedEvent
} from "./events/MembershipDomainEvents.js";

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
 * G2 — escopo autorizado: só `create()` + `reconstitute()`. **Nenhum
 * comando de mutação nesta fatia** (sem `revoke()`/`end()`/
 * `reactivate()`) — mesmo princípio já usado por `Organization`/
 * `OrganizationRelationship` (G1): `version` existe na migration para
 * consistência arquitetural futura, mas não é incrementada por nenhum
 * método público aqui, porque não há nenhum comando de mutação para
 * incrementá-la. `status`/`startedAt`/`endedAt` são modelados no estado
 * (schema completo, conforme o design), mas `create()` sempre produz
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
  private readonly status: MembershipStatusValue;
  private readonly startedAt: Date;
  private readonly endedAt: Date | undefined;
  private readonly version: number;
  private readonly createdAt: Date;
  private readonly updatedAt: Date;

  private readonly domainEvents: MembershipCreatedEvent[] = [];

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
  // Helpers internos
  // ---------------------------------------------------------------------

  private recordEvent(event: MembershipCreatedEvent): void {
    this.domainEvents.push(event);
  }

  public pullDomainEvents(): MembershipCreatedEvent[] {
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
