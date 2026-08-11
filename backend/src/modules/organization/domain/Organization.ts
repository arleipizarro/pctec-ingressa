import { PublicId } from "./value-objects/PublicId.js";
import { OrganizationType } from "./value-objects/OrganizationType.js";
import { LegalName } from "./value-objects/LegalName.js";
import { TradeName } from "./value-objects/TradeName.js";
import { DocumentNumber } from "./value-objects/DocumentNumber.js";
import {
  type EventEnvelopeInput,
  type OrganizationCreatedEvent,
  createOrganizationCreatedEvent
} from "./events/OrganizationDomainEvents.js";

export type OrganizationStatusValue = "ACTIVE" | "INACTIVE";

export interface CreateOrganizationProps {
  readonly type: string;
  readonly legalName: string;
  readonly tradeName?: string | undefined;
  readonly documentNumber?: string | undefined;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface OrganizationPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName?: string | undefined;
  readonly documentNumber?: string | undefined;
  readonly status: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Aggregate Root Organization.
 *
 * Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md;
 * docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md.
 *
 * G1 (Organization Foundation, v0.6.x) — escopo autorizado pelo Product
 * Owner: implementa SOMENTE o comando de criação (`create()`) e a
 * reconstituição a partir de estado persistido (`reconstitute()`).
 * **Nenhum comando de mutação existe nesta fatia** (sem `update()`,
 * sem `activate()`/`inactivate()`, sem `rename()`) — mesmo princípio já
 * usado por `Application` (v0.5.0): a coluna `version` existe na
 * migration para consistência arquitetural e uso futuro, mas não é
 * incrementada por nenhum método público nesta entrega, porque não há
 * nenhum comando de mutação para incrementá-la.
 *
 * Regras estruturais impostas por este Aggregate:
 * - `internalId` nunca é exposto por método público de domínio — apenas
 *   por `getInternalIdForPersistence()`, de uso exclusivo da camada de
 *   infraestrutura.
 * - `documentNumber` é opcional para AMBOS os tipos (`BUSINESS_GROUP` e
 *   `COMPANY`) — decisão explícita do Product Owner (ADR-031 §2): um
 *   `BUSINESS_GROUP` frequentemente não possui CNPJ próprio, e este
 *   Aggregate nunca deriva/herda um `documentNumber` a partir de outra
 *   Organization (essa é uma regra de processo/serviço externo, não uma
 *   invariante deste Aggregate — nenhum código aqui sequer tem acesso a
 *   outras Organizations).
 * - A criação produz o evento de domínio `organization.created`,
 *   coletado internamente e lido via `pullDomainEvents()` — mesmo
 *   padrão já usado por `Identity`/`ApplicationAccess`/`Session`/`Credential`.
 */
export class Organization {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly type: OrganizationType;
  private readonly legalName: LegalName;
  private readonly tradeName: TradeName | undefined;
  private readonly documentNumber: DocumentNumber | undefined;
  private readonly status: OrganizationStatusValue;
  private readonly version: number;
  private readonly createdAt: Date;
  private readonly updatedAt: Date;

  private readonly domainEvents: OrganizationCreatedEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    type: OrganizationType;
    legalName: LegalName;
    tradeName: TradeName | undefined;
    documentNumber: DocumentNumber | undefined;
    status: OrganizationStatusValue;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.type = props.type;
    this.legalName = props.legalName;
    this.tradeName = props.tradeName;
    this.documentNumber = props.documentNumber;
    this.status = props.status;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  // ---------------------------------------------------------------------
  // Criação (comando CreateOrganization)
  // ---------------------------------------------------------------------

  public static create(props: CreateOrganizationProps): Organization {
    const type = OrganizationType.create(props.type);
    const legalName = LegalName.create(props.legalName);
    const tradeName = TradeName.createOptional(props.tradeName);
    const documentNumber = DocumentNumber.createOptional(props.documentNumber);
    const now = props.now ?? new Date();
    const publicId = PublicId.generate();

    const organization = new Organization({
      internalId: undefined,
      publicId,
      type,
      legalName,
      tradeName,
      documentNumber,
      status: "ACTIVE",
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

    organization.recordEvent(
      createOrganizationCreatedEvent(envelope, {
        organizationPublicId: publicId.toString(),
        type: type.toString(),
        hasDocumentNumber: documentNumber !== undefined
      })
    );

    return organization;
  }

  /**
   * Reconstrói uma Organization a partir de estado já persistido. Não
   * valida invariantes de criação (dado confiável, já validado no
   * passado) e não produz eventos de domínio.
   */
  public static reconstitute(state: OrganizationPersistedState): Organization {
    return new Organization({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      type: OrganizationType.create(state.type),
      legalName: LegalName.create(state.legalName),
      tradeName: TradeName.createOptional(state.tradeName),
      documentNumber:
        state.documentNumber !== undefined ? DocumentNumber.fromPersistence(state.documentNumber) : undefined,
      status: state.status === "ACTIVE" || state.status === "INACTIVE" ? state.status : "INACTIVE",
      version: state.version,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    });
  }

  // ---------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------

  private recordEvent(event: OrganizationCreatedEvent): void {
    this.domainEvents.push(event);
  }

  /** Retorna e limpa os eventos de domínio produzidos desde a última leitura. */
  public pullDomainEvents(): OrganizationCreatedEvent[] {
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

  public getType(): OrganizationType {
    return this.type;
  }

  public getLegalName(): LegalName {
    return this.legalName;
  }

  public getTradeName(): TradeName | undefined {
    return this.tradeName;
  }

  public getDocumentNumber(): DocumentNumber | undefined {
    return this.documentNumber;
  }

  public getStatus(): OrganizationStatusValue {
    return this.status;
  }

  public isActive(): boolean {
    return this.status === "ACTIVE";
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
   * Retorna a chave interna, exclusivamente para uso da camada de
   * infraestrutura (repository/mapper). NUNCA deve ser chamado por
   * Application Services, testes de domínio ou qualquer código que
   * represente a fronteira pública do agregado (ADR-021).
   */
  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  /**
   * Atribui a chave interna gerada pelo banco após o INSERT inicial. Uso
   * exclusivo da camada de infraestrutura, imediatamente após persistir
   * uma Organization nova.
   */
  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
