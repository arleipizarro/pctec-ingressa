import { PublicId } from "./value-objects/PublicId.js";
import { AccessProfile } from "./value-objects/AccessProfile.js";
import {
  createApplicationAccessGrantedEvent,
  type ApplicationAccessGrantedEvent
} from "./events/ApplicationAccessDomainEvents.js";

export type ApplicationAccessStatusValue = "GRANTED" | "REVOKED";

export interface GrantFoundationalAdminAccessProps {
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface ApplicationAccessPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly accessProfile: string;
  readonly status: string;
  readonly grantedAt: Date;
  readonly grantedByIdentityPublicId?: string | undefined;
  readonly revokedAt?: Date | undefined;
  readonly revokedByIdentityPublicId?: string | undefined;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Marcador reservado usado EXCLUSIVAMENTE no `actorPublicId` do evento de
 * domínio produzido por `grantFoundationalAdminAccess()` — mesmo
 * princípio do `Identity.BOOTSTRAP_EVENT_ACTOR_MARKER` (ADR-027),
 * reaproveitado aqui pela mesma razão (ADR-028): a primeira concessão
 * administrativa não tem um Actor autenticado real para atribuir.
 */
export const APPLICATION_ACCESS_BOOTSTRAP_EVENT_ACTOR_MARKER = "BOOTSTRAP" as const;

/**
 * Aggregate ApplicationAccess.
 *
 * Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 8 (revisada);
 * docs/adr/ADR-028-APPLICATION-ACCESS-E-ACESSO-ADMINISTRATIVO.md;
 * docs/03-dominio/APPLICATION-ACCESS-DESIGN.md.
 *
 * Nesta fatia, o único comando implementado é
 * `grantFoundationalAdminAccess()` — a concessão administrativa inicial,
 * one-shot, sem Actor autenticado real (mesmo padrão do bootstrap de
 * Identity, ADR-027). Um comando genérico de concessão por um Actor real
 * (`grant(actor, ...)`) e de revogação (`revoke(...)`) ficam para uma
 * fatia futura, quando existir autenticação (Fase C/D do ADR-027) — não
 * implementados aqui para não ampliar o escopo além do que esta entrega
 * exige.
 */
export class ApplicationAccess {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly identityPublicId: string;
  private readonly applicationPublicId: string;
  private readonly accessProfile: AccessProfile;
  private status: ApplicationAccessStatusValue;
  private readonly grantedAt: Date;
  private readonly grantedByIdentityPublicId: string | undefined;
  private revokedAt: Date | undefined;
  private revokedByIdentityPublicId: string | undefined;
  private version: number;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private readonly domainEvents: ApplicationAccessGrantedEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    identityPublicId: string;
    applicationPublicId: string;
    accessProfile: AccessProfile;
    status: ApplicationAccessStatusValue;
    grantedAt: Date;
    grantedByIdentityPublicId: string | undefined;
    revokedAt: Date | undefined;
    revokedByIdentityPublicId: string | undefined;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.identityPublicId = props.identityPublicId;
    this.applicationPublicId = props.applicationPublicId;
    this.accessProfile = props.accessProfile;
    this.status = props.status;
    this.grantedAt = props.grantedAt;
    this.grantedByIdentityPublicId = props.grantedByIdentityPublicId;
    this.revokedAt = props.revokedAt;
    this.revokedByIdentityPublicId = props.revokedByIdentityPublicId;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /**
   * Concede a primeira `ApplicationAccess` com `accessProfile = ADMIN` —
   * usada exclusivamente pelo processo de bootstrap
   * (`BootstrapFirstApplicationAccessService`, v0.5.0, ADR-028).
   *
   * Diferenças deliberadas em relação a um eventual `grant(actor, ...)`
   * futuro:
   *
   * - Não recebe `actor`: não existe Actor autenticado real (mesmo
   *   motivo do bootstrap de Identity — ADR-027, reaplicado aqui).
   * - `grantedByIdentityPublicId` fica `undefined` — nunca um marcador
   *   fingindo ser um `public_id` de Identity (mesmo princípio de
   *   `identities.created_by_identity_public_id = NULL`).
   * - O evento de domínio é construído com `actorPublicId` fixado no
   *   marcador reservado `APPLICATION_ACCESS_BOOTSTRAP_EVENT_ACTOR_MARKER`
   *   ("BOOTSTRAP") — usado SOMENTE aqui, SOMENTE no evento/auditoria,
   *   nunca em `grantedByIdentityPublicId`.
   * - `accessProfile` é sempre `ADMIN`, fixo — nenhum parâmetro de perfil
   *   é aceito (o CLI de bootstrap não deve poder escolher outro
   *   perfil).
   */
  public static grantFoundationalAdminAccess(props: GrantFoundationalAdminAccessProps): ApplicationAccess {
    const publicId = PublicId.generate();
    const accessProfile = AccessProfile.admin();
    const now = props.now ?? new Date();

    const applicationAccess = new ApplicationAccess({
      internalId: undefined,
      publicId,
      identityPublicId: props.identityPublicId,
      applicationPublicId: props.applicationPublicId,
      accessProfile,
      status: "GRANTED",
      grantedAt: now,
      grantedByIdentityPublicId: undefined,
      revokedAt: undefined,
      revokedByIdentityPublicId: undefined,
      version: 1,
      createdAt: now,
      updatedAt: now
    });

    applicationAccess.domainEvents.push(
      createApplicationAccessGrantedEvent(
        {
          aggregatePublicId: publicId.toString(),
          actorPublicId: APPLICATION_ACCESS_BOOTSTRAP_EVENT_ACTOR_MARKER,
          correlationId: props.correlationId,
          ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
          occurredAt: now
        },
        {
          applicationAccessPublicId: publicId.toString(),
          identityPublicId: props.identityPublicId,
          applicationPublicId: props.applicationPublicId,
          accessProfile: accessProfile.toString()
        }
      )
    );

    return applicationAccess;
  }

  public static reconstitute(state: ApplicationAccessPersistedState): ApplicationAccess {
    return new ApplicationAccess({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      identityPublicId: state.identityPublicId,
      applicationPublicId: state.applicationPublicId,
      accessProfile: AccessProfile.create(state.accessProfile),
      status: state.status === "GRANTED" || state.status === "REVOKED" ? state.status : "REVOKED",
      grantedAt: state.grantedAt,
      grantedByIdentityPublicId: state.grantedByIdentityPublicId,
      revokedAt: state.revokedAt,
      revokedByIdentityPublicId: state.revokedByIdentityPublicId,
      version: state.version,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    });
  }

  public pullDomainEvents(): ApplicationAccessGrantedEvent[] {
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

  public getApplicationPublicId(): string {
    return this.applicationPublicId;
  }

  public getAccessProfile(): AccessProfile {
    return this.accessProfile;
  }

  public getStatus(): ApplicationAccessStatusValue {
    return this.status;
  }

  public isGranted(): boolean {
    return this.status === "GRANTED";
  }

  public getGrantedAt(): Date {
    return this.grantedAt;
  }

  /** `undefined` (⇒ `NULL` na persistência) para a primeira concessão administrativa (bootstrap). */
  public getGrantedByIdentityPublicId(): string | undefined {
    return this.grantedByIdentityPublicId;
  }

  public getVersion(): number {
    return this.version;
  }

  /** Uso exclusivo da camada de infraestrutura — nunca exposto por getter público comum. */
  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
