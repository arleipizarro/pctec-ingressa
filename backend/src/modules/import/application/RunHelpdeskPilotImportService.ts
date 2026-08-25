import type { Queryable } from "../../../shared/database/Queryable.js";
import { DomainError } from "../../../shared/errors/DomainError.js";
import { Email } from "../../identity/domain/value-objects/Email.js";
import { Fingerprint, type FingerprintRecord } from "../domain/value-objects/Fingerprint.js";
import { MappingRulesVersion } from "../domain/value-objects/MappingRulesVersion.js";
import type {
  HelpdeskClientRecord,
  HelpdeskSourceReader,
  HelpdeskUserRecord
} from "../domain/pilot/HelpdeskSourcePort.js";
import type { IngressaTargetState, TargetIdentitySummary } from "../domain/pilot/IngressaTargetState.js";
import {
  NEGATIVE_CONTROL_USER_ID,
  NegativeControlLeakError,
  PILOT_APPLICATION_CODE,
  PILOT_MAPPING_RULES_VERSION,
  PILOT_SOURCE_ENTITY,
  PILOT_SOURCE_SYSTEM,
  PILOT_USER_IDS,
  type PilotTargetMapping
} from "../domain/pilot/HelpdeskPilotScope.js";
import {
  APPLICATION_ACCESS_SNAPSHOT_FIELDS,
  EXTERNAL_REFERENCE_SNAPSHOT_FIELDS,
  IDENTITY_SNAPSHOT_FIELDS,
  MEMBERSHIP_SNAPSHOT_FIELDS,
  planPilotImport,
  type PilotPlan,
  type PlannedItem,
  type UserPlan
} from "../domain/pilot/HelpdeskPilotPlanner.js";
import type { StartImportBatchService } from "./StartImportBatchService.js";
import type { RecordImportBatchItemService, RecordImportItemInput } from "./RecordImportBatchItemService.js";
import type { FinishImportBatchService } from "./FinishImportBatchService.js";

export class PilotSourceUserMissingError extends DomainError {
  public readonly code = "IMPORT_PILOT_SOURCE_USER_MISSING";
  public readonly classification = "VALIDATION" as const;

  constructor(faltando: readonly number[]) {
    super(
      `usuário(s) do escopo ausente(s) na origem: ${faltando.join(", ")}. ` +
        "O lote não é aberto com escopo incompleto."
    );
  }
}

/**
 * O vínculo afirmado pelo operador não confere com o cadastro real.
 *
 * Isto NÃO é QUARANTINE de um usuário: é recusa da execução inteira,
 * antes de abrir o lote. Quarentena é para o registro que destoa dentro
 * de um escopo correto; aqui o próprio escopo está errado, e continuar
 * produziria um lote inteiro apontando para a empresa errada.
 */
export class PilotSourceClientMismatchError extends DomainError {
  public readonly code = "IMPORT_PILOT_SOURCE_CLIENT_MISMATCH";
  public readonly classification = "VALIDATION" as const;

  constructor(divergentes: readonly { readonly id: number; readonly clientId: number | null }[], esperado: number) {
    const detalhe = divergentes.map((u) => `users:${u.id} -> client_id=${u.clientId ?? "NULL"}`).join(", ");
    super(
      `vínculo cadastral divergente do informado (--expected-source-client-id=${esperado}): ${detalhe}. ` +
        "Nenhum lote foi aberto."
    );
  }
}

export class PilotSourceClientNotFoundError extends DomainError {
  public readonly code = "IMPORT_PILOT_SOURCE_CLIENT_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(clientId: number) {
    super(`cliente ${clientId} não existe na origem Helpdesk. Nenhum lote foi aberto.`);
  }
}

export class PilotApproverNotEligibleError extends DomainError {
  public readonly code = "IMPORT_PILOT_APPROVER_NOT_ELIGIBLE";
  public readonly classification = "AUTHORIZATION" as const;

  constructor(publicId: string, status: string | undefined) {
    super(
      `aprovador ${publicId} ${status === undefined ? "não existe" : `está ${status}`} — ` +
        "o apply exige uma Identity ACTIVE como autor da aprovação."
    );
  }
}

/**
 * Um lote de dry-run que contém UPDATE não autoriza apply nenhum.
 *
 * Lotes assim existem: foram planejados sob `helpdesk-v1`, quando o
 * planner ainda propunha UPDATE. A versão de regras já os barraria, mas
 * esta checagem é independente — ela responde "o que este lote pede é
 * executável?" em vez de "sob que regra ele foi feito?".
 */
export class PilotBatchContainsUnsupportedActionError extends DomainError {
  public readonly code = "IMPORT_PILOT_BATCH_CONTAINS_UNSUPPORTED_ACTION";
  public readonly classification = "CONFLICT" as const;

  constructor(batchPublicId: string, quantidade: number) {
    super(
      `lote ${batchPublicId} contém ${quantidade} item(ns) com ação UPDATE, que este apply não sabe executar. ` +
        "Gere um novo dry-run sob as regras atuais."
    );
  }
}

export class PilotApplyWriterMissingError extends DomainError {
  public readonly code = "IMPORT_PILOT_APPLY_WRITER_MISSING";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("modo APPLY exige um escritor configurado. O dry-run nunca escreve, e este runner não improvisa.");
  }
}

export interface PilotApplyWriteResult {
  readonly identityPublicId: string;
  readonly targetPublicIdByEntityKind: Readonly<Record<string, string>>;
}

/** Porta de escrita do APPLY — implementada sobre uma transação por usuário. */
export interface PilotApplyWriter {
  writeUser(input: {
    readonly user: HelpdeskUserRecord;
    readonly plan: UserPlan;
    readonly organizationPublicId: string;
    readonly applicationCode: string;
    readonly actorPublicId: string;
    readonly recordItems: (connection: Queryable, targets: Readonly<Record<string, string>>) => Promise<void>;
  }): Promise<PilotApplyWriteResult>;
}

export interface RunPilotImportRequest {
  readonly mode: "DRY_RUN" | "APPLY";
  readonly mapping: PilotTargetMapping;
  readonly dryRunBatchPublicId?: string | undefined;
  readonly approvedByIdentityPublicId?: string | undefined;
}

export interface PilotUserOutcome {
  readonly sourceLegacyId: number;
  readonly actionsByEntityKind: Readonly<Record<string, string>>;
  readonly reasonCodes: readonly string[];
  readonly writtenTargets: Readonly<Record<string, string>>;
}

export interface RunPilotImportResult {
  readonly batchPublicId: string;
  readonly mode: string;
  readonly status: string;
  readonly organizationPublicId: string;
  readonly organizationLegalName: string;
  readonly applicationPublicId: string;
  readonly expectedSourceClientId: number;
  readonly sourceClientName: string;
  readonly snapshotFingerprint: string;
  readonly scopeFingerprint: string;
  readonly mappingRulesVersion: string;
  readonly countsBefore: Readonly<Record<string, number>>;
  readonly countsAfter: Readonly<Record<string, number>>;
  readonly countsByAction: Readonly<Record<string, number>>;
  readonly users: readonly PilotUserOutcome[];
  readonly recordedItems: number;
  readonly resumedUsers: readonly number[];
}

export interface TargetStateReaderPort {
  read(params: {
    readonly targetOrganizationPublicId: string;
    readonly applicationCode: string;
    readonly sourceLegacyIds: readonly number[];
    readonly emailsNormalized: readonly string[];
  }): Promise<IngressaTargetState>;

  findIdentityByPublicId(publicId: string): Promise<TargetIdentitySummary | undefined>;
}

export interface RunHelpdeskPilotImportDeps {
  readonly source: HelpdeskSourceReader;
  readonly targetStateReader: TargetStateReaderPort;
  readonly startImportBatchService: StartImportBatchService;
  readonly recordImportBatchItemService: RecordImportBatchItemService;
  readonly finishImportBatchService: FinishImportBatchService;
  /** Só é usado em APPLY; ausente, o modo APPLY é recusado. */
  readonly applyWriter?: PilotApplyWriter | undefined;
  /** Releitura de contagens após o APPLY. */
  readonly countsReader?: (() => Promise<Readonly<Record<string, number>>>) | undefined;
  /** Ações já registradas num lote — usado para recusar UPDATE herdado. */
  readonly batchActionCounter?: ((batchPublicId: string) => Promise<Readonly<Record<string, number>>>) | undefined;
  /** Chaves já decididas no lote — base da retomada. */
  readonly processedSourceKeysReader?: ((batchPublicId: string) => Promise<ReadonlySet<string>>) | undefined;
}

/**
 * Runner do piloto Helpdesk → Ingressa.
 *
 * A sequência é sempre a mesma, em DRY_RUN e em APPLY: verificar o
 * mapeamento afirmado pelo operador, ler a origem dentro do escopo, ler
 * o destino, planejar, fingerprintar, abrir o lote, registrar as
 * decisões e encerrar. O que muda é só se as decisões viram escrita.
 *
 * Toda recusa de mapeamento acontece ANTES de `startImportBatchService`:
 * um lote aberto é evidência permanente, e não se cria evidência de uma
 * execução que já se sabe inválida.
 */
export class RunHelpdeskPilotImportService {
  public constructor(private readonly deps: RunHelpdeskPilotImportDeps) {}

  public async execute(request: RunPilotImportRequest): Promise<RunPilotImportResult> {
    const usuarios = await this.readScope();
    this.assertVinculoCadastral(usuarios, request.mapping.expectedSourceClientId);

    const cliente = await this.deps.source.readClientById(request.mapping.expectedSourceClientId);
    if (cliente === undefined) {
      throw new PilotSourceClientNotFoundError(request.mapping.expectedSourceClientId);
    }

    const emailsNormalizados = usuarios.map((u) => Email.create(u.email).normalized());
    // Resolve e VALIDA o destino (existe, COMPANY, ACTIVE, sem
    // ambiguidade) — o leitor lança antes de qualquer lote existir.
    const target = await this.deps.targetStateReader.read({
      targetOrganizationPublicId: request.mapping.targetOrganizationPublicId,
      applicationCode: PILOT_APPLICATION_CODE,
      sourceLegacyIds: usuarios.map((u) => u.id),
      emailsNormalized: emailsNormalizados
    });

    if (request.mode === "APPLY") {
      await this.assertAprovadorElegivel(request.approvedByIdentityPublicId);
      await this.assertLoteDeOrigemExecutavel(request.dryRunBatchPublicId);
    }

    const plano = planPilotImport({
      users: usuarios,
      client: cliente,
      expectedSourceClientId: request.mapping.expectedSourceClientId,
      target
    });

    const versao = MappingRulesVersion.create(PILOT_MAPPING_RULES_VERSION);
    const snapshotFingerprint = Fingerprint.compute({
      mappingRulesVersion: versao,
      records: snapshotRecords(usuarios, cliente)
    }).toString();
    const scopeFingerprint = Fingerprint.compute({
      mappingRulesVersion: versao,
      records: scopeRecords(usuarios, cliente, target, request.mapping)
    }).toString();

    const aberto = await this.deps.startImportBatchService.execute({
      sourceSystem: PILOT_SOURCE_SYSTEM,
      mode: request.mode,
      mappingRulesVersion: PILOT_MAPPING_RULES_VERSION,
      snapshotFingerprint,
      scopeFingerprint,
      countsBefore: target.counts,
      dryRunBatchPublicId: request.dryRunBatchPublicId,
      approvedByIdentityPublicId: request.approvedByIdentityPublicId
    });

    const escritos = new Map<number, Readonly<Record<string, string>>>();
    let registrados = 0;
    let retomados: readonly number[] = [];

    try {
      if (request.mode === "APPLY") {
        const execucao = await this.applyPlan(aberto.batchPublicId, usuarios, plano, target, request, escritos);
        registrados = execucao.registrados;
        retomados = execucao.retomados;
      } else {
        registrados = await this.recordDryRun(aberto.batchPublicId, plano);
      }
    } catch (error) {
      // O lote NÃO some quando a execução falha: ele fica FAILED, com o
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
      request.mode === "APPLY" && this.deps.countsReader !== undefined
        ? await this.deps.countsReader()
        : proposedCountsAfter(target.counts, plano);

    const encerrado = await this.deps.finishImportBatchService.complete({
      batchPublicId: aberto.batchPublicId,
      countsAfter
    });

    return {
      batchPublicId: aberto.batchPublicId,
      mode: aberto.mode,
      status: encerrado.status,
      organizationPublicId: target.organization.publicId,
      organizationLegalName: target.organization.legalName,
      applicationPublicId: target.application.publicId,
      expectedSourceClientId: request.mapping.expectedSourceClientId,
      sourceClientName: cliente.name,
      snapshotFingerprint,
      scopeFingerprint,
      mappingRulesVersion: PILOT_MAPPING_RULES_VERSION,
      countsBefore: target.counts,
      countsAfter,
      countsByAction: plano.countsByAction,
      users: plano.users.map((plano) => toOutcome(plano, escritos.get(plano.sourceLegacyId) ?? {})),
      recordedItems: registrados,
      resumedUsers: retomados
    };
  }

  /**
   * Leitura da origem — e a primeira das travas do controle negativo.
   *
   * A consulta já pede só os ids do escopo; esta checagem existe para o
   * caso de a consulta mudar. Um 45 devolvido aqui derruba a execução
   * antes de virar item, snapshot ou fingerprint.
   */
  private async readScope(): Promise<readonly HelpdeskUserRecord[]> {
    const usuarios = await this.deps.source.readUsersByIds(PILOT_USER_IDS);

    if (usuarios.some((u) => u.id === NEGATIVE_CONTROL_USER_ID)) {
      throw new NegativeControlLeakError();
    }

    const encontrados = new Set(usuarios.map((u) => u.id));
    const faltando = PILOT_USER_IDS.filter((id) => !encontrados.has(id));
    if (faltando.length > 0) {
      throw new PilotSourceUserMissingError(faltando);
    }
    return usuarios;
  }

  private assertVinculoCadastral(usuarios: readonly HelpdeskUserRecord[], esperado: number): void {
    const divergentes = usuarios.filter((u) => u.clientId !== esperado);
    if (divergentes.length > 0) {
      throw new PilotSourceClientMismatchError(
        divergentes.map((u) => ({ id: u.id, clientId: u.clientId })),
        esperado
      );
    }
  }

  private async assertAprovadorElegivel(publicId: string | undefined): Promise<void> {
    const alvo = (publicId ?? "").trim();
    if (alvo.length === 0) {
      throw new PilotApproverNotEligibleError("(não informado)", undefined);
    }
    const identidade = await this.deps.targetStateReader.findIdentityByPublicId(alvo);
    if (identidade === undefined || identidade.status !== "ACTIVE") {
      throw new PilotApproverNotEligibleError(alvo, identidade?.status);
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
      throw new PilotBatchContainsUnsupportedActionError(lote, updates);
    }
  }

  private async recordDryRun(batchPublicId: string, plano: PilotPlan): Promise<number> {
    const resultado = await this.deps.recordImportBatchItemService.execute({
      batchPublicId,
      items: plano.items.map((item) => toRecordInput(item, false))
    });
    return resultado.recorded;
  }

  /**
   * APPLY — uma transação por usuário, escrita e trilha juntas.
   *
   * Registrar o item na MESMA transação da escrita é o que sustenta a
   * retomada: um processo morto no meio nunca deixa entidade escrita sem
   * item que a explique, nem item afirmando escrita que não aconteceu.
   *
   * Se o segundo usuário falhar, o primeiro permanece escrito e
   * registrado — de propósito. Desfazer o primeiro exigiria compensar
   * uma escrita já comitada, o que é uma operação auditável própria
   * (`docs/import/ROLLBACK-COMPENSACOES.md`), não um efeito colateral
   * silencioso de um erro.
   */
  private async applyPlan(
    batchPublicId: string,
    usuarios: readonly HelpdeskUserRecord[],
    plano: PilotPlan,
    target: IngressaTargetState,
    request: RunPilotImportRequest,
    escritos: Map<number, Readonly<Record<string, string>>>
  ): Promise<{ readonly registrados: number; readonly retomados: readonly number[] }> {
    const writer = this.deps.applyWriter;
    if (writer === undefined) {
      throw new PilotApplyWriterMissingError();
    }
    const ator = (request.approvedByIdentityPublicId ?? "").trim();
    const jaDecididas = (await this.deps.processedSourceKeysReader?.(batchPublicId)) ?? new Set<string>();

    let registrados = 0;
    const retomados: number[] = [];

    for (const planoUsuario of plano.users) {
      const usuario = usuarios.find((u) => u.id === planoUsuario.sourceLegacyId);
      if (usuario === undefined) {
        continue;
      }

      // Retomada: um usuário cujas quatro decisões já estão na trilha
      // deste lote foi concluído numa execução anterior. Reprocessá-lo
      // tentaria criar de novo o que já existe.
      const concluido = planoUsuario.items.every((item) =>
        jaDecididas.has(`${item.entityKind}:${item.sourceEntityType}:${String(item.sourceLegacyId)}`)
      );
      if (concluido) {
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

      const escrita = await writer.writeUser({
        user: usuario,
        plan: planoUsuario,
        organizationPublicId: target.organization.publicId,
        applicationCode: target.application.code,
        actorPublicId: ator,
        recordItems: async (connection, targets) => {
          await this.recordWithinTransaction(connection, batchPublicId, planoUsuario, targets);
        }
      });
      escritos.set(planoUsuario.sourceLegacyId, escrita.targetPublicIdByEntityKind);
      registrados += planoUsuario.items.length;
    }
    return { registrados, retomados };
  }

  private async recordWithinTransaction(
    connection: Queryable,
    batchPublicId: string,
    planoUsuario: UserPlan,
    targets: Readonly<Record<string, string>>
  ): Promise<void> {
    const service = this.deps.recordImportBatchItemService.withConnection(connection);
    await service.execute({
      batchPublicId,
      items: planoUsuario.items.map((item) => toRecordInput(item, true, targets[item.entityKind]))
    });
  }
}

function snapshotRecords(
  usuarios: readonly HelpdeskUserRecord[],
  cliente: HelpdeskClientRecord
): readonly FingerprintRecord[] {
  const registros: FingerprintRecord[] = usuarios.map((u) => ({
    entityType: PILOT_SOURCE_ENTITY,
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
    entityType: "clients",
    legacyId: cliente.id,
    fields: { name: cliente.name, active: cliente.active }
  });
  return registros;
}

/**
 * Escopo = os registros do lote MAIS o mapeamento afirmado MAIS o
 * destino resolvido.
 *
 * O mapeamento entra de propósito. Aprovar um dry-run que associou o
 * cliente 75 à Bosque não pode autorizar um apply que associa o mesmo
 * cliente a outra organização — nem um apply do mesmo destino a partir
 * de outro cliente de origem. Trocar qualquer uma das duas pontas muda
 * o `scopeFingerprint` e faz `ImportBatch.startApply` recusar.
 */
function scopeRecords(
  usuarios: readonly HelpdeskUserRecord[],
  cliente: HelpdeskClientRecord,
  target: IngressaTargetState,
  mapping: PilotTargetMapping
): readonly FingerprintRecord[] {
  return [
    ...snapshotRecords(usuarios, cliente),
    {
      entityType: "target",
      legacyId: "organization",
      fields: {
        expected_source_client_id: mapping.expectedSourceClientId,
        target_organization_public_id: mapping.targetOrganizationPublicId,
        organization_public_id: target.organization.publicId,
        organization_legal_name: target.organization.legalName,
        organization_type: target.organization.type,
        organization_status: target.organization.status,
        application_code: target.application.code,
        application_public_id: target.application.publicId
      }
    }
  ];
}

function allowedFieldsFor(entityKind: string): readonly string[] {
  switch (entityKind) {
    case "IDENTITY":
      return IDENTITY_SNAPSHOT_FIELDS;
    case "IDENTITY_EXTERNAL_REFERENCE":
      return EXTERNAL_REFERENCE_SNAPSHOT_FIELDS;
    case "MEMBERSHIP":
      return MEMBERSHIP_SNAPSHOT_FIELDS;
    default:
      return APPLICATION_ACCESS_SNAPSHOT_FIELDS;
  }
}

function toRecordInput(
  item: PlannedItem,
  isApply: boolean,
  writtenTargetPublicId?: string | undefined
): RecordImportItemInput {
  const allowedFields = allowedFieldsFor(item.entityKind);
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
  plano: PilotPlan
): Readonly<Record<string, number>> {
  const mapa: Record<string, string> = {
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

function toOutcome(plano: UserPlan, writtenTargets: Readonly<Record<string, string>>): PilotUserOutcome {
  const actionsByEntityKind: Record<string, string> = {};
  const reasons = new Set<string>();
  for (const item of plano.items) {
    actionsByEntityKind[item.entityKind] = item.action;
    reasons.add(item.reasonCode);
  }
  return {
    sourceLegacyId: plano.sourceLegacyId,
    actionsByEntityKind,
    reasonCodes: [...reasons],
    writtenTargets
  };
}
