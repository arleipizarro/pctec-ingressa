import { PublicId } from "./value-objects/PublicId.js";
import { OrganizationType } from "./value-objects/OrganizationType.js";
import { LegalName } from "./value-objects/LegalName.js";
import { TradeName } from "./value-objects/TradeName.js";
import { DocumentNumber } from "./value-objects/DocumentNumber.js";
import { OrganizationVersionConflictError } from "./errors/OrganizationErrors.js";
import {
  createOrganizationCreatedEvent,
  createOrganizationUpdatedEvent,
  type EventEnvelopeInput,
  type OrganizationCreatedEvent,
  type OrganizationUpdatedEvent
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
/** Eventos que este Aggregate sabe emitir. */
export type OrganizationDomainEvent = OrganizationCreatedEvent | OrganizationUpdatedEvent;

export interface RenameOrganizationProps {
  readonly legalName: string;
  /**
   * `undefined` = não mexer no nome fantasia. `null` = limpar.
   *
   * A distinção existe porque a tela envia os dois campos sempre, e
   * "não informei" e "quero apagar" não podem colapsar no mesmo valor —
   * colapsar apagaria o nome fantasia de quem só corrigiu a razão
   * social.
   */
  readonly tradeName: string | null | undefined;
  readonly expectedVersion: number;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

export class Organization {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly type: OrganizationType;
  private legalName: LegalName;
  private tradeName: TradeName | undefined;
  private readonly documentNumber: DocumentNumber | undefined;
  private readonly status: OrganizationStatusValue;
  private version: number;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private readonly domainEvents: OrganizationDomainEvent[] = [];

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

  private recordEvent(event: OrganizationDomainEvent): void {
    this.domainEvents.push(event);
  }

  /** Retorna e limpa os eventos de domínio produzidos desde a última leitura. */
  // ---------------------------------------------------------------------
  // Correção administrativa de nomes (comando RenameOrganization, v0.10.1)
  // ---------------------------------------------------------------------

  /**
   * Corrige razão social e/ou nome fantasia.
   *
   * É o PRIMEIRO comando de mutação deste Aggregate, e o escopo é
   * deliberadamente estreito: só nome. `type`, `status`,
   * `documentNumber` e referências externas continuam sem caminho de
   * alteração aqui — cada um deles muda o significado da organização
   * para quem já depende dela (o `type` decide o que pode ser pai de
   * quem, o `status` decide quem enxerga o quê, o documento é chave de
   * unicidade). Nome é a única correção que não reescreve autorização
   * nenhuma, e por isso é a única que cabe numa tela de edição.
   *
   * `expectedVersion` é exigido, não derivado do estado carregado: quem
   * salva precisa afirmar QUAL versão revisou. Derivar internamente
   * transformaria "duas pessoas editando" em "a última vence em
   * silêncio".
   *
   * Sem mudança efetiva, nada acontece: nem versão, nem evento, nem
   * `updated_at`. Salvar duas vezes o mesmo texto não é uma correção, e
   * registrar uma auditoria vazia só suja a trilha de quem depois
   * procura quando o nome de fato mudou.
   */
  public rename(props: RenameOrganizationProps): void {
    if (props.expectedVersion !== this.version) {
      throw new OrganizationVersionConflictError(props.expectedVersion, this.version);
    }

    const novaRazaoSocial = LegalName.create(props.legalName);
    const novoNomeFantasia =
      props.tradeName === undefined ? this.tradeName : TradeName.createOptional(props.tradeName);

    const mudou: string[] = [];
    if (novaRazaoSocial.toString() !== this.legalName.toString()) {
      mudou.push("legal_name");
    }
    if ((novoNomeFantasia?.toString() ?? null) !== (this.tradeName?.toString() ?? null)) {
      mudou.push("trade_name");
    }
    if (mudou.length === 0) {
      return;
    }

    const now = props.now ?? new Date();
    const versaoAnterior = this.version;

    this.legalName = novaRazaoSocial;
    this.tradeName = novoNomeFantasia;
    this.version = versaoAnterior + 1;
    this.updatedAt = now;

    const envelope: EventEnvelopeInput = {
      aggregatePublicId: this.publicId.toString(),
      actorPublicId: props.actorPublicId,
      correlationId: props.correlationId,
      ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
      occurredAt: now
    };

    this.recordEvent(
      createOrganizationUpdatedEvent(envelope, {
        organizationPublicId: this.publicId.toString(),
        // Nomes dos campos, nunca os valores: um evento circula mais
        // longe do que a linha da tabela.
        changedFields: mudou,
        previousVersion: versaoAnterior,
        version: this.version
      })
    );
  }

  public pullDomainEvents(): OrganizationDomainEvent[] {
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
