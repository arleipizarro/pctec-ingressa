import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationDocumentMatchRepository } from "../domain/OrganizationDocumentMatchRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { Organization } from "../domain/Organization.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";
import { DomainError } from "../../../shared/errors/DomainError.js";

/**
 * Violação de invariante — `uk_organizations_document_type` (migration
 * 0010) garante no máximo 1 `Organization` por `(document_number,
 * type)`. Se `findAllByDocumentNumberAndType` retornar mais de 1 linha,
 * isso nunca é um cenário de negócio esperado — é sinal de corrupção de
 * dado ou de a constraint ter sido contornada fora da aplicação. Erro
 * rígido, nunca uma classificação reportável do bootstrap.
 */
export class OrganizationDocumentUniquenessInvariantViolatedError extends DomainError {
  public readonly code = "ORGANIZATION_DOCUMENT_UNIQUENESS_INVARIANT_VIOLATED";
  public readonly classification = "CONFLICT" as const;

  constructor(candidateCount: number) {
    super(
      `Invariante violada: ${candidateCount} Organizations encontradas para o mesmo (document_number, type) — ` +
        `uk_organizations_document_type deveria garantir no máximo 1. Corrupção de dado ou constraint ausente.`
    );
  }
}

/**
 * Mecanismo de bootstrap/importação — G2 (v0.6.x), seção 19 do prompt de
 * implementação: **PREPARADO nesta entrega, NÃO EXECUTADO contra dados
 * reais.** Nenhum código deste arquivo é chamado fora de testes com
 * fixtures/fakes nesta rodada.
 *
 * Implementa a classificação de correlação exigida pelo design
 * (ORGANIZATION-MEMBERSHIP-DESIGN.md §9.2, §9.1-bis) para migrar
 * registros de Cliente/Grupo de um sistema legado (HUB/Helpdesk/Portal)
 * para `Organization` canônica + `OrganizationExternalReference`, usando
 * `documentNumber` (CNPJ) **como evidência de correlação, nunca como
 * identificador cross-system** (ADR-031 §9.1-bis).
 *
 * **Revisão do Product Owner (antes do commit de G2) — por que só 3
 * classificações, não 4:** o design original (redigido antes de G1)
 * previa uma quarta classificação, `AMBIGUOUS` ("2+ Organizations
 * candidatas para o mesmo CNPJ"). G1 implementou
 * `UNIQUE KEY uk_organizations_document_type (document_number, type)`
 * em `organizations` (migration 0010) — essa constraint garante, no
 * próprio banco, no máximo UMA `Organization` por `(document_number,
 * type)`. Logo, contra o schema real, `findAllByDocumentNumberAndType`
 * **nunca pode retornar mais de 1 linha** — `AMBIGUOUS`, como definido
 * originalmente, é código morto: nenhuma execução real contra MariaDB
 * jamais alcançaria esse branch. Mantê-lo como uma classificação de
 * negócio normal (reportável, ignorável) seria documentar uma
 * possibilidade que o próprio schema já eliminou — pior que remover, é
 * enganoso. Por isso: `AMBIGUOUS` foi removido do tipo
 * `OrganizationMatchClassification`; se `candidates.length > 1` ocorrer
 * mesmo assim, isso indica uma violação de invariante (constraint
 * ausente/corrompida, manipulação direta de banco fora da aplicação) —
 * tratado como erro rígido (`OrganizationDocumentUniquenessInvariantViolatedError`),
 * não como uma linha no relatório de bootstrap. A constraint de G1
 * (`uk_organizations_document_type`) **não foi alterada** por esta
 * revisão — só o código em volta dela, que assumia uma possibilidade
 * que ela mesma impede.
 *
 * Requisitos não negociáveis desta seção, todos implementados:
 * - **idempotente**: rodar o mesmo lote duas vezes não duplica nada —
 *   `existsActiveBySystemCodeEntityTypeAndLegacyId` (filtra
 *   `status='ACTIVE'`) é checado antes de criar qualquer
 *   `OrganizationExternalReference`, e um registro já com referência
 *   **ACTIVE** é classificado `MATCHED` (idempotência), nunca recriado.
 *   **Deliberadamente NÃO considera referências `SUPERSEDED` como "já
 *   processadas"** — depois de uma correção de matching (uma referência
 *   antiga marcada `SUPERSEDED`, fora de escopo G2 implementar esse
 *   comando), rodar o mesmo lote de novo deve RE-AVALIAR o matching do
 *   zero, não pular o registro como se ainda estivesse correto;
 * - **auditável**: toda criação real (não dry-run) produz os mesmos
 *   eventos de domínio já emitidos por `CreateOrganizationService`/
 *   `CreateOrganizationExternalReferenceService` (reaproveitados
 *   internamente, não duplicados);
 * - **dry-run primeiro**: `dryRun: true` NUNCA chama `insert()` em
 *   nenhum repositório — computa e retorna só o relatório de
 *   classificação;
 * - **nunca resolve CONFLICT automaticamente**: esse caso nunca resulta
 *   em escrita, dry-run ou não — sempre reportado para decisão humana
 *   (`AMBIGUOUS`, definido originalmente no design, foi removido —
 *   ver nota acima sobre por que é código morto dado
 *   `uk_organizations_document_type`);
 * - **preserva legacy IDs**: todo `MATCHED`/`UNMATCHED-criado` grava um
 *   `OrganizationExternalReference` com o `legacyId` original.
 */

export type OrganizationMatchClassification = "MATCHED" | "UNMATCHED" | "CONFLICT";

export interface LegacyOrganizationRecord {
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly legalName: string;
  readonly tradeName?: string | undefined;
  readonly documentNumber?: string | undefined;
  readonly type: string;
}

export interface OrganizationBootstrapReportEntry {
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string;
  readonly classification: OrganizationMatchClassification;
  readonly matchedOrganizationPublicId?: string | undefined;
  readonly createdOrganizationPublicId?: string | undefined;
  readonly reason: string;
}

export interface BootstrapOrganizationsRequest {
  readonly records: readonly LegacyOrganizationRecord[];
  /** `true` (padrão, mais seguro): NUNCA escreve, só classifica e reporta. */
  readonly dryRun: boolean;
  /**
   * Quando `true`, um registro `UNMATCHED` (nenhuma Organization com
   * esse documentNumber+type) resulta na CRIAÇÃO de uma Organization
   * nova + ExternalReference — comportamento apropriado para o
   * bootstrap PRIMÁRIO a partir do HUB (Ingressa começa vazio, ver
   * ORGANIZATION-MEMBERSHIP-DESIGN.md §9.2 passo 1-2).
   *
   * Quando `false`, um registro `UNMATCHED` é só reportado como gap —
   * comportamento apropriado para a correlação de Portal/Helpdesk
   * contra Organizations já bootstrapadas do HUB (§9.2 passos 3-4): "se
   * não encontrado, é um GAP de dados a reportar... não resolver
   * silenciosamente".
   */
  readonly createOrganizationForUnmatched: boolean;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface BootstrapOrganizationsResult {
  readonly dryRun: boolean;
  readonly entries: readonly OrganizationBootstrapReportEntry[];
  readonly summary: {
    readonly matched: number;
    readonly unmatched: number;
    readonly conflict: number;
  };
}

export class BootstrapOrganizationsService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly organizationDocumentMatchRepositoryFactory: (
      connection: Queryable
    ) => OrganizationDocumentMatchRepository,
    private readonly organizationExternalReferenceRepositoryFactory: (
      connection: Queryable
    ) => OrganizationExternalReferenceRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: BootstrapOrganizationsRequest): Promise<BootstrapOrganizationsResult> {
    const entries: OrganizationBootstrapReportEntry[] = [];

    // Cada registro é processado na SUA PRÓPRIA transação — um registro
    // problemático (ex.: CONFLICT) nunca impede os demais de serem
    // processados, e um lote parcialmente aplicado em modo real nunca
    // deixa uma transação gigante pendurada.
    for (const record of request.records) {
      const entry = await this.processRecord(record, request);
      entries.push(entry);
    }

    return {
      dryRun: request.dryRun,
      entries,
      summary: {
        matched: entries.filter((e) => e.classification === "MATCHED").length,
        unmatched: entries.filter((e) => e.classification === "UNMATCHED").length,
        conflict: entries.filter((e) => e.classification === "CONFLICT").length
      }
    };
  }

  private async processRecord(
    record: LegacyOrganizationRecord,
    request: BootstrapOrganizationsRequest
  ): Promise<OrganizationBootstrapReportEntry> {
    const systemCode = SystemCode.create(record.systemCode);
    const entityType = EntityType.create(record.entityType);
    const legacyId = LegacyId.create(record.legacyId);

    return this.unitOfWork.runInTransaction(async (connection) => {
      const organizationRepository = this.organizationRepositoryFactory(connection);
      const organizationDocumentMatchRepository = this.organizationDocumentMatchRepositoryFactory(connection);
      const externalReferenceRepository = this.organizationExternalReferenceRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      // Idempotência: se já existe uma OrganizationExternalReference
      // para exatamente este (systemCode, entityType, legacyId), o
      // registro já foi processado antes — classificado MATCHED sem
      // nenhuma escrita nova, mesmo fora de dry-run.
      const referenceAlreadyProcessed = await externalReferenceRepository.existsActiveBySystemCodeEntityTypeAndLegacyId(
        systemCode,
        entityType,
        legacyId
      );
      if (referenceAlreadyProcessed) {
        return {
          systemCode: record.systemCode,
          entityType: record.entityType,
          legacyId: legacyId.toString(),
          classification: "MATCHED" as const,
          reason: "OrganizationExternalReference ACTIVE já existe para este registro legado (idempotência)."
        };
      }

      const documentNumber = DocumentNumber.createOptional(record.documentNumber);
      const type = OrganizationType.create(record.type);

      if (documentNumber === undefined) {
        // Sem CNPJ, não há evidência de correlação possível — tratado
        // como UNMATCHED (nunca inventa correlação sem evidência).
        return this.handleUnmatched(
          record,
          request,
          organizationRepository,
          externalReferenceRepository,
          auditEventRepository,
          systemCode,
          entityType,
          legacyId,
          "Registro sem documentNumber — nenhuma evidência de correlação disponível."
        );
      }

      const candidates = await organizationDocumentMatchRepository.findAllByDocumentNumberAndType(
        documentNumber,
        type
      );

      if (candidates.length === 0) {
        return this.handleUnmatched(
          record,
          request,
          organizationRepository,
          externalReferenceRepository,
          auditEventRepository,
          systemCode,
          entityType,
          legacyId,
          "Nenhuma Organization encontrada com este documentNumber+type."
        );
      }

      if (candidates.length > 1) {
        // Violação de invariante, nunca um cenário de negócio normal —
        // ver nota de classe acima. uk_organizations_document_type
        // (0010) garante isso no próprio banco; chegar aqui significa
        // que algo está seriamente errado fora do controle desta
        // aplicação. Erro rígido, propagado — nunca reportado como uma
        // linha "AMBIGUOUS" no relatório do bootstrap.
        throw new OrganizationDocumentUniquenessInvariantViolatedError(candidates.length);
      }

      const matchedOrganization = candidates[0]!;

      // CONFLICT: a Organization encontrada tem razão social muito
      // divergente do registro legado — heurística simples e
      // conservadora (comparação normalizada exata; qualquer
      // divergência é reportada, nunca silenciosamente aceita como
      // "provavelmente a mesma empresa").
      const normalizedMatchedName = matchedOrganization.getLegalName().toString().trim().toLowerCase();
      const normalizedRecordName = record.legalName.trim().toLowerCase();
      if (normalizedMatchedName !== normalizedRecordName) {
        return {
          systemCode: record.systemCode,
          entityType: record.entityType,
          legacyId: legacyId.toString(),
          classification: "CONFLICT" as const,
          matchedOrganizationPublicId: matchedOrganization.getPublicId().toString(),
          reason: `documentNumber bate, mas legalName diverge ("${record.legalName}" vs Organization existente) — decisão manual necessária.`
        };
      }

      // MATCHED de verdade: cria só a ExternalReference (a Organization
      // já existe), exceto em dry-run.
      if (!request.dryRun) {
        const reference = OrganizationExternalReference.create({
          organizationPublicId: matchedOrganization.getPublicId().toString(),
          systemCode: record.systemCode,
          entityType: record.entityType,
          legacyId: record.legacyId,
          actorPublicId: request.actorPublicId,
          correlationId: request.correlationId ?? randomUUID()
        });
        await externalReferenceRepository.insert(reference);
        const events = reference.pullDomainEvents();
        await auditEventRepository.insertMany(events.map((event) => AuditEvent.fromDomainEvent(event)));
      }

      return {
        systemCode: record.systemCode,
        entityType: record.entityType,
        legacyId: legacyId.toString(),
        classification: "MATCHED" as const,
        matchedOrganizationPublicId: matchedOrganization.getPublicId().toString(),
        reason: "documentNumber+type+legalName batem com uma Organization existente."
      };
    });
  }

  private async handleUnmatched(
    record: LegacyOrganizationRecord,
    request: BootstrapOrganizationsRequest,
    organizationRepository: OrganizationRepository,
    externalReferenceRepository: OrganizationExternalReferenceRepository,
    auditEventRepository: AuditEventRepository,
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId,
    reason: string
  ): Promise<OrganizationBootstrapReportEntry> {
    if (!request.dryRun && request.createOrganizationForUnmatched) {
      const organization = Organization.create({
        type: record.type,
        legalName: record.legalName,
        tradeName: record.tradeName,
        documentNumber: record.documentNumber,
        actorPublicId: request.actorPublicId,
        correlationId: request.correlationId ?? randomUUID()
      });
      await organizationRepository.insert(organization);
      const organizationEvents = organization.pullDomainEvents();
      await auditEventRepository.insertMany(organizationEvents.map((event) => AuditEvent.fromDomainEvent(event)));

      const reference = OrganizationExternalReference.create({
        organizationPublicId: organization.getPublicId().toString(),
        systemCode: systemCode.toString(),
        entityType: entityType.toString(),
        legacyId: legacyId.toString(),
        actorPublicId: request.actorPublicId,
        correlationId: request.correlationId ?? randomUUID()
      });
      await externalReferenceRepository.insert(reference);
      const referenceEvents = reference.pullDomainEvents();
      await auditEventRepository.insertMany(referenceEvents.map((event) => AuditEvent.fromDomainEvent(event)));

      return {
        systemCode: record.systemCode,
        entityType: record.entityType,
        legacyId: legacyId.toString(),
        classification: "UNMATCHED",
        createdOrganizationPublicId: organization.getPublicId().toString(),
        reason: `${reason} Organization NOVA criada (bootstrap primário).`
      };
    }

    return {
      systemCode: record.systemCode,
      entityType: record.entityType,
      legacyId: legacyId.toString(),
      classification: "UNMATCHED",
      reason
    };
  }
}
