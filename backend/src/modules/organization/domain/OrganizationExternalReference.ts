import { PublicId } from "./value-objects/PublicId.js";
import { SystemCode } from "./value-objects/SystemCode.js";
import { EntityType } from "./value-objects/EntityType.js";
import { LegacyId } from "./value-objects/LegacyId.js";
import {
  type EventEnvelopeInput,
  type OrganizationExternalReferenceCreatedEvent,
  createOrganizationExternalReferenceCreatedEvent
} from "./events/OrganizationExternalReferenceDomainEvents.js";

export type OrganizationExternalReferenceStatusValue = "ACTIVE" | "SUPERSEDED";

export interface CreateOrganizationExternalReferenceProps {
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface OrganizationExternalReferencePersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Aggregate Root OrganizationExternalReference.
 *
 * Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md;
 * docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md, §9.1.
 *
 * A ponte de rastreabilidade entre `Organization` (canônica, Ingressa) e
 * os sistemas legados (HUB/Helpdesk/Portal). `organizationPublicId` é
 * `string` simples (mesmo precedente de `ApplicationAccess`/
 * `Membership` para referência cross-aggregate).
 *
 * **`legacyId` nunca é exposto como identificador de Organization** —
 * só existe para correlação/rastreabilidade (ADR-031). O contrato
 * cross-system oficial é sempre `Organization.publicId`.
 *
 * G2 — escopo autorizado: só `create()` + `reconstitute()`. Nenhum
 * comando para marcar `SUPERSEDED` nesta fatia (isso é parte do
 * processo de correção de matching, fora de escopo G2) — `create()`
 * sempre produz `status=ACTIVE`.
 */
export class OrganizationExternalReference {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly organizationPublicId: string;
  private readonly systemCode: SystemCode;
  private readonly entityType: EntityType;
  private readonly legacyId: LegacyId;
  private readonly status: OrganizationExternalReferenceStatusValue;
  private readonly createdAt: Date;
  private readonly updatedAt: Date;

  private readonly domainEvents: OrganizationExternalReferenceCreatedEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    organizationPublicId: string;
    systemCode: SystemCode;
    entityType: EntityType;
    legacyId: LegacyId;
    status: OrganizationExternalReferenceStatusValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.organizationPublicId = props.organizationPublicId;
    this.systemCode = props.systemCode;
    this.entityType = props.entityType;
    this.legacyId = props.legacyId;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  // ---------------------------------------------------------------------
  // Criação (comando CreateOrganizationExternalReference)
  // ---------------------------------------------------------------------

  /**
   * Constrói o Aggregate. **Pré-condição garantida pelo chamador
   * (`CreateOrganizationExternalReferenceService`), não por este
   * método:** `organizationPublicId` referencia uma Organization já
   * confirmada como existente.
   */
  public static create(props: CreateOrganizationExternalReferenceProps): OrganizationExternalReference {
    const publicId = PublicId.generate();
    const systemCode = SystemCode.create(props.systemCode);
    const entityType = EntityType.create(props.entityType);
    const legacyId = LegacyId.create(props.legacyId);
    const now = props.now ?? new Date();

    const reference = new OrganizationExternalReference({
      internalId: undefined,
      publicId,
      organizationPublicId: props.organizationPublicId,
      systemCode,
      entityType,
      legacyId,
      status: "ACTIVE",
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

    reference.recordEvent(
      createOrganizationExternalReferenceCreatedEvent(envelope, {
        organizationExternalReferencePublicId: publicId.toString(),
        organizationPublicId: props.organizationPublicId,
        systemCode: systemCode.toString(),
        entityType: entityType.toString()
      })
    );

    return reference;
  }

  /**
   * Reconstrói uma OrganizationExternalReference a partir de estado já
   * persistido. Não valida invariantes de criação e não produz eventos
   * de domínio.
   */
  public static reconstitute(state: OrganizationExternalReferencePersistedState): OrganizationExternalReference {
    return new OrganizationExternalReference({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      organizationPublicId: state.organizationPublicId,
      systemCode: SystemCode.create(state.systemCode),
      entityType: EntityType.create(state.entityType),
      legacyId: LegacyId.create(state.legacyId),
      status: state.status === "ACTIVE" || state.status === "SUPERSEDED" ? state.status : "SUPERSEDED",
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    });
  }

  // ---------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------

  private recordEvent(event: OrganizationExternalReferenceCreatedEvent): void {
    this.domainEvents.push(event);
  }

  public pullDomainEvents(): OrganizationExternalReferenceCreatedEvent[] {
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

  public getOrganizationPublicId(): string {
    return this.organizationPublicId;
  }

  public getSystemCode(): SystemCode {
    return this.systemCode;
  }

  public getEntityType(): EntityType {
    return this.entityType;
  }

  public getLegacyId(): LegacyId {
    return this.legacyId;
  }

  public getStatus(): OrganizationExternalReferenceStatusValue {
    return this.status;
  }

  public isActive(): boolean {
    return this.status === "ACTIVE";
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
