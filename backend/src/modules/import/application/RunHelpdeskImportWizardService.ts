import type { Queryable } from "../../../shared/database/Queryable.js";
import { DomainError } from "../../../shared/errors/DomainError.js";
import { Fingerprint, type FingerprintRecord } from "../domain/value-objects/Fingerprint.js";
import { MappingRulesVersion } from "../domain/value-objects/MappingRulesVersion.js";
import type {
  HelpdeskClientRecord,
  HelpdeskSourceReader,
  HelpdeskUserRecord
} from "../domain/pilot/HelpdeskSourcePort.js";
import type { TargetIdentitySummary, WizardTargetState } from "../domain/wizard/WizardTargetState.js";
import { HelpdeskImportSelection } from "../domain/wizard/HelpdeskImportSelection.js";
import {
  WIZARD_APPLICATION_CODE,
  WIZARD_MAPPING_RULES_VERSION,
  WIZARD_SOURCE_CLIENT_ENTITY,
  WIZARD_SOURCE_SYSTEM,
  WIZARD_SOURCE_USER_ENTITY
} from "../domain/wizard/HelpdeskImportScope.js";
import {
  allowedSnapshotFieldsFor,
  planImport,
  type ImportPlan,
  type OrganizationPlan,
  type PlannedItem,
  type SourceOrganizationLinkKind,
  type UserPlan
} from "../domain/wizard/HelpdeskImportPlanner.js";
import type { StartImportBatchService } from "./StartImportBatchService.js";
import type { RecordImportBatchItemService, RecordImportItemInput } from "./RecordImportBatchItemService.js";
import type { FinishImportBatchService } from "./FinishImportBatchService.js";

export class WizardSourceClientNotFoundError extends DomainError {
  public readonly code = "IMPORT_WIZARD_SOURCE_CLIENT_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(clientId: number) {
    super(`empresa ${clientId} não existe na origem Helpdesk. Nenhum lote foi aberto.`);
  }
}

export class WizardApproverNotEligibleError extends DomainError {
  public readonly code = "IMPORT_WIZARD_APPROVER_NOT_ELIGIBLE";
  public readonly classification = "AUTHORIZATION" as const;

  constructor(publicId: string, status: string | undefined) {
    super(
      `aprovador ${publicId} ${status === undefined ? "não existe" : `está ${status}`} — ` +
        "o apply exige uma Identity ACTIVE como autora da aprovação."
    );
  }
}

/**
 * A confirmação forte do APPLY.
 *
 * A palavra é verificada NO BACKEND, e é isso que a torna uma trava em
 * vez de uma decoração. Um `disabled` removido pelo inspetor do
 * navegador, um `curl` direto na rota ou um clique duplo em outra aba
 * chegam todos aqui e param no mesmo lugar.
 */
export const WIZARD_APPLY_CONFIRMATION = "APLICAR" as const;

export class WizardApplyConfirmationMismatchError extends DomainError {
  public readonly code = "IMPORT_WIZARD_APPLY_CONFIRMATION_MISMATCH";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      `o apply exige a confirmação literal "${WIZARD_APPLY_CONFIRMATION}". ` +
        "Nenhum lote foi aberto e nada foi escrito."
    );
  }
}

export class WizardBatchContainsUnsupportedActionError extends DomainError {
  public readonly code = "IMPORT_WIZARD_BATCH_CONTAINS_UNSUPPORTED_ACTION";
  public readonly classification = "CONFLICT" as const;

  constructor(batchPublicId: string, quantidade: number) {
    super(
      `lote ${batchPublicId} contém ${quantidade} item(ns) com ação UPDATE, que este apply não sabe executar. ` +
        "Gere um novo dry-run sob as regras atuais."
    );
  }
}

/**
 * O destino da membership não pôde ser resolvido na hora de escrever.
 *
 * Acontece quando o lote é retomado e a organização, criada na execução
 * anterior, não é reencontrada pela leitura do destino — por exemplo se
 * a referência externa que a amarra tiver sido removida entre as duas
 * execuções. Erro próprio, e não o de escritor ausente, porque as duas
 * causas exigem ações opostas: uma é configuração, esta é estado.
 */
export class WizardMembershipTargetNotResolvedError extends DomainError {
  public readonly code = "IMPORT_WIZARD_MEMBERSHIP_TARGET_NOT_RESOLVED";
  public readonly classification = "CONFLICT" as const;

  constructor(sourceLegacyId: number) {
    super(
      `organização de destino do usuário ${sourceLegacyId} não está resolvida no momento da escrita. ` +
        "Nenhuma membership é criada apontando para destino desconhecido — gere um novo dry-run."
    );
  }
}

export class WizardApplyWriterMissingError extends DomainError {
  public readonly code = "IMPORT_WIZARD_APPLY_WRITER_MISSING";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("modo APPLY exige um escritor configurado. O dry-run nunca escreve, e este runner não improvisa.");
  }
}

// ---------------------------------------------------------------------
// Portas de escrita
// ---------------------------------------------------------------------

export type RecordItemsInTransaction = (
  connection: Queryable,
  targets: Readonly<Record<string, string>>
) => Promise<void>;

export interface WriteOrganizationInput {
  readonly plan: OrganizationPlan;
  readonly client: HelpdeskClientRecord;
  readonly parentBusinessGroupPublicId: string | null;
  readonly actorPublicId: string;
  readonly recordItems: RecordItemsInTransaction;
}

export interface WizardOrganizationWriteResult {
  readonly organizationPublicId: string;
  readonly targetPublicIdByEntityKind: Readonly<Record<string, string>>;
}

export interface WriteUserInput {
  readonly user: HelpdeskUserRecord;
  readonly plan: UserPlan;
  readonly membershipOrganizationPublicId: string;
  readonly applicationCode: string;
  readonly actorPublicId: string;
  readonly recordItems: RecordItemsInTransaction;
}

export interface WizardUserWriteResult {
  readonly identityPublicId: string;
  readonly identityStatus: string;
  readonly activatedNow: boolean;
  readonly targetPublicIdByEntityKind: Readonly<Record<string, string>>;
}

export interface WizardApplyWriter {
  writeOrganization(input: WriteOrganizationInput): Promise<WizardOrganizationWriteResult>;
  writeUser(input: WriteUserInput): Promise<WizardUserWriteResult>;
}

export interface WizardTargetStateReaderPort {
  read(query: {
    readonly sourceClientId: number;
    readonly assertedOrganizationPublicId: string | null;
    readonly assertedBusinessGroupPublicId: string | null;
    readonly applicationCode: string;
    readonly sourceLegacyIds: readonly number[];
    readonly emailsNormalized: readonly string[];
  }): Promise<WizardTargetState>;

  findIdentityByPublicId(publicId: string): Promise<TargetIdentitySummary | undefined>;

  readCounts(): Promise<Readonly<Record<string, number>>>;
}

// ---------------------------------------------------------------------
// Contrato do serviço
// ---------------------------------------------------------------------

export interface RunImportWizardRequest {
  readonly mode: "DRY_RUN" | "APPLY";
  readonly selection: HelpdeskImportSelection;
  /** Ator derivado da SESSÃO pelo controlador — nunca do corpo. */
  readonly actorIdentityPublicId: string;
  readonly dryRunBatchPublicId?: string | undefined;
  /** Só no APPLY. Comparada com `WIZARD_APPLY_CONFIRMATION`. */
  readonly confirmation?: string | undefined;
}

export interface WizardUserOutcome {
  readonly sourceLegacyId: number;
  readonly sourceName: string;
  readonly sourceEmail: string;
  readonly linkKind: SourceOrganizationLinkKind;
  readonly actionsByEntityKind: Readonly<Record<string, string>>;
  readonly reasonCodes: readonly string[];
  readonly writtenTargets: Readonly<Record<string, string>>;
  readonly identityStatus: string | undefined;
  readonly activatedNow: boolean;
}

export interface RunImportWizardResult {
  readonly batchPublicId: string;
  readonly mode: string;
  readonly status: string;
  readonly sourceClientId: number;
  readonly sourceClientName: string;
  readonly organizationResolution: string;
  readonly organizationPublicId: string | null;
  readonly organizationLegalName: string | null;
  readonly parentBusinessGroupPublicId: string | null;
  readonly applicationPublicId: string;
  readonly snapshotFingerprint: string;
  readonly scopeFingerprint: string;
  readonly mappingRulesVersion: string;
  readonly countsBefore: Readonly<Record<string, number>>;
  readonly countsAfter: Readonly<Record<string, number>>;
  readonly countsByAction: Readonly<Record<string, number>>;
  readonly organizationActions: Readonly<Record<string, string>>;
  readonly organizationTargets: Readonly<Record<string, string>>;
  readonly blockingReasonCode: string | null;
  readonly users: readonly WizardUserOutcome[];
  readonly recordedItems: number;
  readonly resumedUsers: readonly number[];
}

export interface RunHelpdeskImportWizardDeps {
  readonly source: HelpdeskSourceReader;
  readonly targetStateReader: WizardTargetStateReaderPort;
  readonly startImportBatchService: StartImportBatchService;
  readonly recordImportBatchItemService: RecordImportBatchItemService;
  readonly finishImportBatchService: FinishImportBatchService;
  /** Só é usado em APPLY; ausente, o modo APPLY é recusado. */
  readonly applyWriter?: WizardApplyWriter | undefined;
  /** Ações já registradas num lote — usado para recusar UPDATE herdado. */
  readonly batchActionCounter?: ((batchPublicId: string) => Promise<Readonly<Record<string, number>>>) | undefined;
  /** Chaves já decididas no lote — base da retomada. */
  readonly processedSourceKeysReader?: ((batchPublicId: string) => Promise<ReadonlySet<string>>) | undefined;
  /**
   * Vínculo de cada usuário com a organização.
   *
   * Injetável porque a fonte Helpdesk atual só produz `COMPANY` (o
   * `client_group_id` não está no grant read-only, e o cadastro de
   * grupo vive no banco do HUB — ver `HelpdeskCatalogPort`). Quando
   * essa leitura existir, é este ponto que muda, e só ele.
   */
  readonly linkKindResolver?:
    | ((users: readonly HelpdeskUserRecord[]) => ReadonlyMap<number, SourceOrganizationLinkKind>)
    | undefined;
}

/**
 * Runner do assistente Helpdesk → Ingressa.
 *
 * A sequência é a mesma em DRY_RUN e em APPLY: ler a origem dentro da
 * seleção, ler o destino, planejar, fingerprintar, abrir o lote,
 * registrar as decisões e encerrar. O que muda é só se as decisões
 * viram escrita.
 *
 * Toda recusa acontece ANTES de `startImportBatchService`: um lote
 * aberto é evidência permanente, e não se cria evidência de uma
 * execução que já se sabe inválida. A confirmação literal e a
 * elegibilidade do aprovador são verificadas nesse mesmo trecho, antes
 * de qualquer linha.
 *
 * **A UI nunca monta decisão de autorização.** Ela manda a seleção; o
 * plano é recalculado aqui, do zero, na ida e na volta. O que o
 * navegador exibiu não entra em nada — nem no plano, nem no
 * fingerprint, nem na escrita.
 */
export class RunHelpdeskImportWizardService {
  public constructor(private readonly deps: RunHelpdeskImportWizardDeps) {}

  public async execute(request: RunImportWizardRequest): Promise<RunImportWizardResult> {
    if (request.mode === "APPLY" && request.confirmation !== WIZARD_APPLY_CONFIRMATION) {
      throw new WizardApplyConfirmationMismatchError();
    }

    const preparado = await this.prepare(request.selection);
    const { cliente, usuarios, target, plano } = preparado;

    if (request.mode === "APPLY") {
      await this.assertAprovadorElegivel(request.actorIdentityPublicId);
      await this.assertLoteDeOrigemExecutavel(request.dryRunBatchPublicId);
    }

    const versao = MappingRulesVersion.create(WIZARD_MAPPING_RULES_VERSION);
    const snapshotFingerprint = Fingerprint.compute({
      mappingRulesVersion: versao,
      records: snapshotRecords(usuarios, cliente)
    }).toString();
    const scopeFingerprint = Fingerprint.compute({
      mappingRulesVersion: versao,
      records: scopeRecords(usuarios, cliente, target, request.selection)
    }).toString();

    const aberto = await this.deps.startImportBatchService.execute({
      sourceSystem: WIZARD_SOURCE_SYSTEM,
      mode: request.mode,
      mappingRulesVersion: WIZARD_MAPPING_RULES_VERSION,
      snapshotFingerprint,
      scopeFingerprint,
      countsBefore: target.counts,
      dryRunBatchPublicId: request.dryRunBatchPublicId,
      approvedByIdentityPublicId: request.mode === "APPLY" ? request.actorIdentityPublicId : undefined
    });

    const escritos = new Map<number, WizardUserWriteResult>();
    let organizationTargets: Readonly<Record<string, string>> = {};
    let organizationPublicId = plano.organization.existingOrganizationPublicId ?? null;
    let registrados = 0;
    let retomados: readonly number[] = [];

    try {
      if (request.mode === "APPLY") {
        const execucao = await this.applyPlan(
          aberto.batchPublicId,
          preparado,
          request.actorIdentityPublicId,
          escritos
        );
        registrados = execucao.registrados;
        retomados = execucao.retomados;
        organizationTargets = execucao.organizationTargets;
        organizationPublicId = execucao.organizationPublicId;
      } else {
        registrados = await this.recordDryRun(aberto.batchPublicId, plano);
      }
    } catch (error) {
      // O lote NÃO some quando a execução falha: fica FAILED, com o
      // motivo, e os itens já gravados permanecem. É o que permite
      // retomar de onde parou — e o que impede uma falha de virar
      // silêncio na trilha.
      await this.deps.finishImportBatchService.fail({
        batchPublicId: aberto.batchPublicId,
        reason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    const countsAfter =
      request.mode === "APPLY"
        ? await this.deps.targetStateReader.readCounts()
        : proposedCountsAfter(target.counts, plano);

    const encerrado = await this.deps.finishImportBatchService.complete({
      batchPublicId: aberto.batchPublicId,
      countsAfter
    });

    return {
      batchPublicId: aberto.batchPublicId,
      mode: aberto.mode,
      status: encerrado.status,
      sourceClientId: cliente.id,
      sourceClientName: cliente.name,
      organizationResolution: target.resolvedOrganization.kind,
      organizationPublicId,
      organizationLegalName: target.resolvedOrganization.organization?.legalName ?? cliente.name,
      parentBusinessGroupPublicId: request.selection.getParentBusinessGroupPublicId(),
      applicationPublicId: target.application.publicId,
      snapshotFingerprint,
      scopeFingerprint,
      mappingRulesVersion: WIZARD_MAPPING_RULES_VERSION,
      countsBefore: target.counts,
      countsAfter,
      countsByAction: plano.countsByAction,
      organizationActions: acoesPorEntidade(plano.organization.items),
      organizationTargets,
      blockingReasonCode: plano.organization.blockingReasonCode ?? null,
      users: plano.users.map((u) => toOutcome(u, escritos.get(u.sourceLegacyId))),
      recordedItems: registrados,
      resumedUsers: retomados
    };
  }

  /**
   * Leitura da origem, do destino e planejamento — a parte comum de
   * dry-run, apply e pré-visualização.
   *
   * Ser a MESMA função nos três é o que sustenta a promessa do
   * fingerprint: se a pré-visualização, o dry-run e o apply usassem
   * caminhos diferentes, "a origem não mudou" passaria a significar
   * três coisas.
   */
  public async prepare(selection: HelpdeskImportSelection): Promise<PreparedImport> {
    const cliente = await this.deps.source.readClientById(selection.getSourceClientId());
    if (cliente === undefined) {
      throw new WizardSourceClientNotFoundError(selection.getSourceClientId());
    }

    // Lê exatamente os ids selecionados — não "os usuários da empresa".
    // Um usuário cujo `client_id` não é o da seleção ainda é lido, para
    // que o planner possa registrar `SOURCE_USER_CLIENT_OUT_OF_SELECTION`
    // com motivo em vez de a pessoa sumir do relatório sem explicação.
    const usuarios = await this.deps.source.readUsersByIds(selection.getSelectedSourceUserIds());

    const emailsNormalizados = [
      ...new Set(usuarios.map((u) => normalizarEmailSeguro(u.email)).filter((e): e is string => e !== undefined))
    ];

    const target = await this.deps.targetStateReader.read({
      sourceClientId: selection.getSourceClientId(),
      assertedOrganizationPublicId: selection.getTargetOrganizationPublicId(),
      assertedBusinessGroupPublicId: selection.getParentBusinessGroupPublicId(),
      applicationCode: WIZARD_APPLICATION_CODE,
      sourceLegacyIds: usuarios.map((u) => u.id),
      emailsNormalized: emailsNormalizados
    });

    const plano = planImport({
      selection,
      users: usuarios,
      client: cliente,
      target,
      linkKindBySourceUserId: this.deps.linkKindResolver?.(usuarios)
    });

    return { selection, cliente, usuarios, target, plano };
  }

  private async assertAprovadorElegivel(publicId: string): Promise<void> {
    const alvo = (publicId ?? "").trim();
    if (alvo.length === 0) {
      throw new WizardApproverNotEligibleError("(não informado)", undefined);
    }
    const identidade = await this.deps.targetStateReader.findIdentityByPublicId(alvo);
    if (identidade === undefined || identidade.status !== "ACTIVE") {
      throw new WizardApproverNotEligibleError(alvo, identidade?.status);
    }
  }

  private async assertLoteDeOrigemExecutavel(dryRunBatchPublicId: string | undefined): Promise<void> {
    const contador = this.deps.batchActionCounter;
    const lote = (dryRunBatchPublicId ?? "").trim();
    if (contador === undefined || lote.length === 0) {
      return;
    }
    const porAcao = await contador(lote);
    const updates = porAcao["UPDATE"] ?? 0;
    if (updates > 0) {
      throw new WizardBatchContainsUnsupportedActionError(lote, updates);
    }
  }

  private async recordDryRun(batchPublicId: string, plano: ImportPlan): Promise<number> {
    const resultado = await this.deps.recordImportBatchItemService.execute({
      batchPublicId,
      items: plano.items.map((item) => toRecordInput(item, false))
    });
    return resultado.recorded;
  }

  /**
   * APPLY — organização primeiro, depois uma transação por usuário.
   *
   * A ordem não é preferência: membership e acesso apontam para a
   * empresa, e a empresa precisa estar comitada antes de a transação do
   * primeiro usuário abrir. Se a organização falhar, nenhum usuário é
   * sequer tentado.
   *
   * Registrar o item na MESMA transação da escrita é o que sustenta a
   * retomada: um processo morto no meio nunca deixa entidade escrita sem
   * item que a explique, nem item afirmando escrita que não aconteceu.
   *
   * Se o segundo usuário falhar, o primeiro permanece escrito e
   * registrado — de propósito. Desfazer o primeiro exigiria compensar
   * uma escrita já comitada, o que é operação auditável própria
   * (`docs/import/ROLLBACK-COMPENSACOES.md`), não efeito colateral
   * silencioso de um erro.
   */
  private async applyPlan(
    batchPublicId: string,
    preparado: PreparedImport,
    actorPublicId: string,
    escritos: Map<number, WizardUserWriteResult>
  ): Promise<{
    readonly registrados: number;
    readonly retomados: readonly number[];
    readonly organizationTargets: Readonly<Record<string, string>>;
    readonly organizationPublicId: string | null;
  }> {
    const writer = this.deps.applyWriter;
    if (writer === undefined) {
      throw new WizardApplyWriterMissingError();
    }
    const { plano, cliente, usuarios, selection, target } = preparado;
    const jaDecididas = (await this.deps.processedSourceKeysReader?.(batchPublicId)) ?? new Set<string>();

    let registrados = 0;
    const retomados: number[] = [];
    let organizationTargets: Readonly<Record<string, string>> = {};
    let organizationPublicId = plano.organization.existingOrganizationPublicId ?? null;

    // --- Organização -------------------------------------------------
    const orgConcluida =
      plano.organization.items.length > 0 &&
      plano.organization.items.every((item) => jaDecididas.has(chaveDoItem(item)));

    if (orgConcluida) {
      retomados.push(cliente.id);
    } else if (!plano.organization.writes) {
      const resultado = await this.deps.recordImportBatchItemService.execute({
        batchPublicId,
        items: plano.organization.items.map((item) => toRecordInput(item, true))
      });
      registrados += resultado.recorded;
    } else {
      const escrita = await writer.writeOrganization({
        plan: plano.organization,
        client: cliente,
        parentBusinessGroupPublicId: selection.getParentBusinessGroupPublicId(),
        actorPublicId,
        recordItems: async (connection, targets) => {
          await this.recordWithinTransaction(connection, batchPublicId, plano.organization.items, targets);
        }
      });
      organizationTargets = escrita.targetPublicIdByEntityKind;
      organizationPublicId = escrita.organizationPublicId;
      registrados += plano.organization.items.length;
    }

    // --- Usuários ----------------------------------------------------
    for (const planoUsuario of plano.users) {
      const usuario = usuarios.find((u) => u.id === planoUsuario.sourceLegacyId);
      if (usuario === undefined) {
        continue;
      }

      // Retomada: um usuário cujas quatro decisões já estão na trilha
      // deste lote foi concluído numa execução anterior. Reprocessá-lo
      // tentaria criar de novo o que já existe.
      if (planoUsuario.items.every((item) => jaDecididas.has(chaveDoItem(item)))) {
        retomados.push(planoUsuario.sourceLegacyId);
        continue;
      }

      if (!planoUsuario.writes) {
        // CONFLICT/QUARANTINE/SKIP: nada é escrito, mas a decisão é
        // registrada — é o que torna a recusa auditável.
        const resultado = await this.deps.recordImportBatchItemService.execute({
          batchPublicId,
          items: planoUsuario.items.map((item) => toRecordInput(item, true))
        });
        registrados += resultado.recorded;
        continue;
      }

      const destino =
        planoUsuario.linkKind === "BUSINESS_GROUP" ? (target.businessGroup?.publicId ?? null) : organizationPublicId;
      if (destino === null) {
        // Sem destino resolvido não se cria membership. O planner já
        // deveria ter bloqueado; esta é a segunda porta, e ela existe
        // porque a consequência de furar as duas é conceder acesso a
        // uma organização que ninguém escolheu.
        throw new WizardMembershipTargetNotResolvedError(planoUsuario.sourceLegacyId);
      }

      const escrita = await writer.writeUser({
        user: usuario,
        plan: planoUsuario,
        membershipOrganizationPublicId: destino,
        applicationCode: target.application.code,
        actorPublicId,
        recordItems: async (connection, targets) => {
          await this.recordWithinTransaction(connection, batchPublicId, planoUsuario.items, targets);
        }
      });
      escritos.set(planoUsuario.sourceLegacyId, escrita);
      registrados += planoUsuario.items.length;
    }

    return { registrados, retomados, organizationTargets, organizationPublicId };
  }

  private async recordWithinTransaction(
    connection: Queryable,
    batchPublicId: string,
    items: readonly PlannedItem[],
    targets: Readonly<Record<string, string>>
  ): Promise<void> {
    const service = this.deps.recordImportBatchItemService.withConnection(connection);
    await service.execute({
      batchPublicId,
      items: items.map((item) => toRecordInput(item, true, targets[item.entityKind]))
    });
  }
}

export interface PreparedImport {
  readonly selection: HelpdeskImportSelection;
  readonly cliente: HelpdeskClientRecord;
  readonly usuarios: readonly HelpdeskUserRecord[];
  readonly target: WizardTargetState;
  readonly plano: ImportPlan;
}

function chaveDoItem(item: PlannedItem): string {
  return `${item.entityKind}:${item.sourceEntityType}:${String(item.sourceLegacyId)}`;
}

function normalizarEmailSeguro(bruto: string): string | undefined {
  const texto = (bruto ?? "").trim().toLowerCase();
  return texto.length === 0 || !texto.includes("@") ? undefined : texto;
}

function snapshotRecords(
  usuarios: readonly HelpdeskUserRecord[],
  cliente: HelpdeskClientRecord
): readonly FingerprintRecord[] {
  const registros: FingerprintRecord[] = usuarios.map((u) => ({
    entityType: WIZARD_SOURCE_USER_ENTITY,
    legacyId: u.id,
    fields: {
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      client_id: u.clientId
    }
  }));
  registros.push({
    entityType: WIZARD_SOURCE_CLIENT_ENTITY,
    legacyId: cliente.id,
    fields: { name: cliente.name, active: cliente.active }
  });
  return registros;
}

/**
 * Escopo = os registros do lote MAIS a seleção do ADMIN MAIS o destino
 * resolvido.
 *
 * A seleção entra de propósito, e é a diferença mais importante em
 * relação ao piloto: lá o escopo era constante do código e não podia
 * variar entre o dry-run e o apply. Aqui pode — é a tela — então
 * aprovar um dry-run de quatro usuários não pode autorizar um apply de
 * quarenta, nem um apply dos mesmos quatro apontando para outra
 * empresa. Trocar qualquer ponta muda o `scopeFingerprint` e faz
 * `ImportBatch.startApply` recusar.
 */
function scopeRecords(
  usuarios: readonly HelpdeskUserRecord[],
  cliente: HelpdeskClientRecord,
  target: WizardTargetState,
  selection: HelpdeskImportSelection
): readonly FingerprintRecord[] {
  return [
    ...snapshotRecords(usuarios, cliente),
    {
      entityType: "selection",
      legacyId: "admin",
      fields: selection.toFingerprintFields()
    },
    {
      entityType: "target",
      legacyId: "organization",
      fields: {
        resolution: target.resolvedOrganization.kind,
        organization_public_id: target.resolvedOrganization.organization?.publicId ?? null,
        organization_legal_name: target.resolvedOrganization.organization?.legalName ?? null,
        organization_type: target.resolvedOrganization.organization?.type ?? null,
        organization_status: target.resolvedOrganization.organization?.status ?? null,
        organization_external_reference_public_id: target.resolvedOrganization.externalReference?.publicId ?? null,
        assertion_conflict: target.resolvedOrganization.assertionConflict ?? null,
        business_group_public_id: target.businessGroup?.publicId ?? null,
        business_group_eligible: target.businessGroup?.eligible ?? null,
        business_group_relationship_public_id: target.businessGroup?.existingRelationship?.publicId ?? null,
        application_code: target.application.code,
        application_public_id: target.application.publicId
      }
    }
  ];
}

function toRecordInput(
  item: PlannedItem,
  isApply: boolean,
  writtenTargetPublicId?: string | undefined
): RecordImportItemInput {
  const allowedFields = allowedSnapshotFieldsFor(item.entityKind);
  const target = isApply ? (writtenTargetPublicId ?? item.existingTargetPublicId ?? null) : null;

  return {
    entityKind: item.entityKind,
    sourceEntityType: item.sourceEntityType,
    sourceLegacyId: item.sourceLegacyId,
    action: item.action,
    targetPublicId: target,
    before: item.before === undefined ? undefined : { allowedFields, source: { ...item.before } },
    after: item.after === undefined ? undefined : { allowedFields, source: { ...item.after } },
    reasonCode: item.reasonCode
  };
}

/**
 * `counts_after` do DRY_RUN é PROPOSTA, não medição: é o que as
 * contagens seriam se este plano fosse aplicado. Só CREATE muda
 * contagem — SKIP, CONFLICT e QUARANTINE não tocam em nada.
 */
function proposedCountsAfter(
  countsBefore: Readonly<Record<string, number>>,
  plano: ImportPlan
): Readonly<Record<string, number>> {
  const mapa: Record<string, string> = {
    ORGANIZATION: "organizations",
    ORGANIZATION_RELATIONSHIP: "organizationRelationships",
    ORGANIZATION_EXTERNAL_REFERENCE: "organizationExternalReferences",
    IDENTITY: "identities",
    IDENTITY_EXTERNAL_REFERENCE: "identityExternalReferences",
    MEMBERSHIP: "memberships",
    APPLICATION_ACCESS: "applicationAccesses"
  };
  const resultado: Record<string, number> = { ...countsBefore };
  for (const item of plano.items) {
    if (item.action !== "CREATE") {
      continue;
    }
    const chave = mapa[item.entityKind];
    if (chave !== undefined) {
      resultado[chave] = (resultado[chave] ?? 0) + 1;
    }
  }
  return resultado;
}

function acoesPorEntidade(items: readonly PlannedItem[]): Readonly<Record<string, string>> {
  const resultado: Record<string, string> = {};
  for (const item of items) {
    resultado[item.entityKind] = item.action;
  }
  return resultado;
}

function toOutcome(plano: UserPlan, escrita: WizardUserWriteResult | undefined): WizardUserOutcome {
  const actionsByEntityKind: Record<string, string> = {};
  const reasons = new Set<string>();
  for (const item of plano.items) {
    actionsByEntityKind[item.entityKind] = item.action;
    reasons.add(item.reasonCode);
  }
  return {
    sourceLegacyId: plano.sourceLegacyId,
    sourceName: plano.sourceName,
    sourceEmail: plano.sourceEmail,
    linkKind: plano.linkKind,
    actionsByEntityKind,
    reasonCodes: [...reasons],
    writtenTargets: escrita?.targetPublicIdByEntityKind ?? {},
    identityStatus: escrita?.identityStatus,
    activatedNow: escrita?.activatedNow ?? false
  };
}
