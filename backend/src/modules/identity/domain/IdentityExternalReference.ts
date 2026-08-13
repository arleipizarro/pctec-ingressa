import { PublicId } from "./value-objects/PublicId.js";
import { SystemCode } from "./value-objects/SystemCode.js";
import { EntityType } from "./value-objects/EntityType.js";
import { LegacyId } from "./value-objects/LegacyId.js";
import { MatchMethod } from "./value-objects/MatchMethod.js";
import {
  type EventEnvelopeInput,
  type IdentityExternalReferenceCreatedEvent,
  createIdentityExternalReferenceCreatedEvent
} from "./events/IdentityExternalReferenceDomainEvents.js";

export type IdentityExternalReferenceStatusValue = "ACTIVE" | "SUPERSEDED";

export interface CreateIdentityExternalReferenceProps {
  readonly identityPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly matchMethod: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface IdentityExternalReferencePersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly matchMethod: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Aggregate Root IdentityExternalReference.
 *
 * A ponte de rastreabilidade entre `Identity` (canônica, Ingressa) e
 * os sistemas legados (HUB/Helpdesk/Portal). `identityPublicId` é
 * `string` simples (mesmo precedente de `ApplicationAccess`/`Membership`
 * para referência cross-aggregate).
 *
 * Tabela PARALELA a `OrganizationExternalReference` — sem import
 * cross-module, mesma filosofia de isolamento de bounded context.
 *
 * **Campo novo vs Organization**: `matchMethod` (como o vínculo foi
 * confirmado: email-match ou confirmação manual). Nunca inferido
 * automaticamente — sempre fornecido pelo chamador.
 *
 * **`legacyId` nunca é exposto como identificador de Identity** —
 * só existe para correlação/rastreabilidade. O contrato cross-system
 * oficial é sempre `Identity.publicId`.
 *
 * P1B.0 — escopo autorizado: só `create()` + `reconstitute()`. Nenhum
 * comando para marcar `SUPERSEDED` nesta fatia (fora de escopo).
 */
export class IdentityExternalReference {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly identityPublicId: string;
  private readonly systemCode: SystemCode;
  private readonly entityType: EntityType;
  private readonly legacyId: LegacyId;
  private readonly matchMethod: MatchMethod;
  private readonly status: IdentityExternalReferenceStatusValue;
  private readonly createdAt: Date;
  private readonly updatedAt: Date;

  private readonly domainEvents: IdentityExternalReferenceCreatedEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    identityPublicId: string;
    systemCode: SystemCode;
    entityType: EntityType;
    legacyId: LegacyId;
    matchMethod: MatchMethod;
    status: IdentityExternalReferenceStatusValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.identityPublicId = props.identityPublicId;
    this.systemCode = props.systemCode;
    this.entityType = props.entityType;
    this.legacyId = props.legacyId;
    this.matchMethod = props.matchMethod;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  // ---------------------------------------------------------------------
  // Criação (comando CreateIdentityExternalReference)
  // ---------------------------------------------------------------------

  /**
   * Constrói o Aggregate. **Pré-condição garantida pelo chamador
   * (`CreateIdentityExternalReferenceService`), não por este método:**
   * `identityPublicId` referencia uma Identity já confirmada como
   * existente.
   */
  public static create(props: CreateIdentityExternalReferenceProps): IdentityExternalReference {
    const publicId = PublicId.generate();
    const systemCode = SystemCode.create(props.systemCode);
    const entityType = EntityType.create(props.entityType);
    const legacyId = LegacyId.create(props.legacyId);
    const matchMethod = MatchMethod.create(props.matchMethod);
    const now = props.now ?? new Date();

    const reference = new IdentityExternalReference({
      internalId: undefined,
      publicId,
      identityPublicId: props.identityPublicId,
      systemCode,
      entityType,
      legacyId,
      matchMethod,
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
      createIdentityExternalReferenceCreatedEvent(envelope, {
        identityExternalReferencePublicId: publicId.toString(),
        identityPublicId: props.identityPublicId,
        systemCode: systemCode.toString(),
        entityType: entityType.toString(),
        matchMethod: matchMethod.toString()
      })
    );

    return reference;
  }

  /**
   * Reconstrói uma IdentityExternalReference a partir de estado já
   * persistido. Não valida invariantes de criação e não produz eventos
   * de domínio.
   */
  public static reconstitute(state: IdentityExternalReferencePersistedState): IdentityExternalReference {
    return new IdentityExternalReference({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      identityPublicId: state.identityPublicId,
      systemCode: SystemCode.create(state.systemCode),
      entityType: EntityType.create(state.entityType),
      legacyId: LegacyId.create(state.legacyId),
      matchMethod: MatchMethod.create(state.matchMethod),
      status: state.status === "ACTIVE" || state.status === "SUPERSEDED" ? state.status : "SUPERSEDED",
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    });
  }

  // ---------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------

  private recordEvent(event: IdentityExternalReferenceCreatedEvent): void {
    this.domainEvents.push(event);
  }

  public pullDomainEvents(): IdentityExternalReferenceCreatedEvent[] {
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

  public getSystemCode(): SystemCode {
    return this.systemCode;
  }

  public getEntityType(): EntityType {
    return this.entityType;
  }

  public getLegacyId(): LegacyId {
    return this.legacyId;
  }

  public getMatchMethod(): MatchMethod {
    return this.matchMethod;
  }

  public getStatus(): IdentityExternalReferenceStatusValue {
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
