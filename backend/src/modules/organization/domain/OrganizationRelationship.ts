import { PublicId } from "./value-objects/PublicId.js";
import {
  type EventEnvelopeInput,
  type OrganizationRelationshipCreatedEvent,
  createOrganizationRelationshipCreatedEvent
} from "./events/OrganizationRelationshipDomainEvents.js";

export interface CreateOrganizationRelationshipProps {
  readonly parentOrganizationPublicId: string;
  readonly childOrganizationPublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface OrganizationRelationshipPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly parentOrganizationPublicId: string;
  readonly childOrganizationPublicId: string;
  readonly createdAt: Date;
}

/**
 * Aggregate Root OrganizationRelationship.
 *
 * Representa o vínculo hierárquico `BUSINESS_GROUP` -> `COMPANY`.
 * Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md;
 * docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 3.
 *
 * **Este Aggregate NÃO valida, por si só, que o parent é BUSINESS_GROUP
 * e o child é COMPANY** — ele não tem acesso a outra Organization para
 * checar seu `type`. Essa validação é responsabilidade do Application
 * Service (`CreateOrganizationRelationshipService`), que carrega ambas
 * as Organizations via repository antes de construir este Aggregate
 * (mesmo princípio já documentado na migration 0011: "validação de tipo
 * é responsabilidade da camada de aplicação/domínio; MariaDB não
 * expressa essa restrição nativamente sem trigger").
 *
 * G1 — só o comando de criação (`create()`) e reconstituição existem
 * nesta fatia. Nenhum comando para encerrar/mover um relacionamento
 * (empresa sai do grupo) — fora de escopo, registrado como gap no
 * relatório desta entrega.
 */
export class OrganizationRelationship {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly parentOrganizationPublicId: PublicId;
  private readonly childOrganizationPublicId: PublicId;
  private readonly createdAt: Date;

  private readonly domainEvents: OrganizationRelationshipCreatedEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    parentOrganizationPublicId: PublicId;
    childOrganizationPublicId: PublicId;
    createdAt: Date;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.parentOrganizationPublicId = props.parentOrganizationPublicId;
    this.childOrganizationPublicId = props.childOrganizationPublicId;
    this.createdAt = props.createdAt;
  }

  // ---------------------------------------------------------------------
  // Criação (comando CreateOrganizationRelationship)
  // ---------------------------------------------------------------------

  /**
   * Constrói o Aggregate. **Pré-condição, garantida pelo chamador
   * (`CreateOrganizationRelationshipService`), não por este método:**
   * `parentOrganizationPublicId` referencia uma Organization já
   * confirmada como `BUSINESS_GROUP`, e `childOrganizationPublicId`
   * referencia uma Organization já confirmada como `COMPANY` — ver
   * nota de classe acima.
   */
  public static create(props: CreateOrganizationRelationshipProps): OrganizationRelationship {
    const publicId = PublicId.generate();
    const parentOrganizationPublicId = PublicId.fromString(props.parentOrganizationPublicId);
    const childOrganizationPublicId = PublicId.fromString(props.childOrganizationPublicId);
    const now = props.now ?? new Date();

    const relationship = new OrganizationRelationship({
      internalId: undefined,
      publicId,
      parentOrganizationPublicId,
      childOrganizationPublicId,
      createdAt: now
    });

    const envelope: EventEnvelopeInput = {
      aggregatePublicId: publicId.toString(),
      actorPublicId: props.actorPublicId,
      correlationId: props.correlationId,
      ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
      occurredAt: now
    };

    relationship.recordEvent(
      createOrganizationRelationshipCreatedEvent(envelope, {
        organizationRelationshipPublicId: publicId.toString(),
        parentOrganizationPublicId: parentOrganizationPublicId.toString(),
        childOrganizationPublicId: childOrganizationPublicId.toString()
      })
    );

    return relationship;
  }

  /**
   * Reconstrói um OrganizationRelationship a partir de estado já
   * persistido. Não valida invariantes de criação e não produz eventos
   * de domínio.
   */
  public static reconstitute(state: OrganizationRelationshipPersistedState): OrganizationRelationship {
    return new OrganizationRelationship({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      parentOrganizationPublicId: PublicId.fromString(state.parentOrganizationPublicId),
      childOrganizationPublicId: PublicId.fromString(state.childOrganizationPublicId),
      createdAt: state.createdAt
    });
  }

  // ---------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------

  private recordEvent(event: OrganizationRelationshipCreatedEvent): void {
    this.domainEvents.push(event);
  }

  public pullDomainEvents(): OrganizationRelationshipCreatedEvent[] {
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

  public getParentOrganizationPublicId(): PublicId {
    return this.parentOrganizationPublicId;
  }

  public getChildOrganizationPublicId(): PublicId {
    return this.childOrganizationPublicId;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
