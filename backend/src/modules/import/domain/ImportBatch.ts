import { randomUUID } from "node:crypto";
import { ImportBatchMode } from "./value-objects/ImportBatchMode.js";
import { ImportBatchStatus } from "./value-objects/ImportBatchStatus.js";
import { Fingerprint } from "./value-objects/Fingerprint.js";
import { MappingRulesVersion } from "./value-objects/MappingRulesVersion.js";
import {
  ApplyWithoutDryRunError,
  DryRunBatchNotCompletedError,
  DryRunModeMismatchError,
  ImportBatchNotRunningError,
  MappingRulesVersionMismatchError,
  SourceChangedSinceDryRunError,
  SourceSystemMismatchError,
  UnapprovedApplyError
} from "./errors/ImportErrors.js";

export type ImportSourceSystemValue = "PCTEC_HUB" | "PCTEC_HELPDESK" | "PCTEC_PORTAL";

/** Contagens agregadas por entidade. Somente números — nunca dado pessoal. */
export type ImportCounts = Readonly<Record<string, number>>;

export interface StartDryRunProps {
  readonly sourceSystem: ImportSourceSystemValue;
  readonly mappingRulesVersion: string;
  readonly snapshotFingerprint: string;
  readonly scopeFingerprint: string;
  readonly countsBefore: ImportCounts;
  readonly now?: Date | undefined;
}

export interface StartApplyProps extends StartDryRunProps {
  readonly dryRunBatch: ImportBatch;
  readonly approvedByIdentityPublicId: string;
}

export interface ImportBatchPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly sourceSystem: string;
  readonly mappingRulesVersion: string;
  readonly snapshotFingerprint: string;
  readonly scopeFingerprint: string;
  readonly mode: string;
  readonly status: string;
  readonly dryRunBatchPublicId: string | null;
  readonly approvedByIdentityPublicId: string | null;
  readonly approvedAt: Date | null;
  readonly countsBefore: ImportCounts;
  readonly countsAfter: ImportCounts | null;
  readonly failureReason: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Limite de `failure_reason` na migration 0020. */
const FAILURE_REASON_MAX = 500;

/**
 * Aggregate Root ImportBatch — uma execução do importador.
 *
 * Nada é escrito no Ingressa por importação sem um lote que o explique.
 *
 * As duas invariantes que dão segurança ao apply vivem aqui, e não no
 * CLI que chama:
 *
 *  1. **APPLY exige DRY_RUN COMPLETED.** Não há caminho para aplicar sem
 *     antes ter simulado e revisado.
 *
 *  2. **APPLY exige `scopeFingerprint` idêntico ao do dry-run.** Se a
 *     origem mudou DENTRO DO ESCOPO entre a simulação e a aprovação, o
 *     que foi aprovado não é o que seria escrito — e o apply é recusado.
 *     Mudança FORA do escopo não altera esse fingerprint e, portanto,
 *     não invalida nada: sem isso, num Helpdesk com cadastro entrando
 *     todo dia, nenhum lote jamais seria aplicável.
 */
export class ImportBatch {
  private internalId: number | undefined;

  private constructor(
    private readonly publicId: string,
    private readonly sourceSystem: ImportSourceSystemValue,
    private readonly mappingRulesVersion: MappingRulesVersion,
    private readonly snapshotFingerprint: Fingerprint,
    private readonly scopeFingerprint: Fingerprint,
    private readonly mode: ImportBatchMode,
    private status: ImportBatchStatus,
    private readonly dryRunBatchPublicId: string | null,
    private readonly approvedByIdentityPublicId: string | null,
    private readonly approvedAt: Date | null,
    private readonly countsBefore: ImportCounts,
    private countsAfter: ImportCounts | null,
    private failureReason: string | null,
    private readonly startedAt: Date,
    private finishedAt: Date | null,
    private readonly createdAt: Date,
    private updatedAt: Date
  ) {}

  public static startDryRun(props: StartDryRunProps): ImportBatch {
    const agora = props.now ?? new Date();
    return new ImportBatch(
      randomUUID(),
      props.sourceSystem,
      MappingRulesVersion.create(props.mappingRulesVersion),
      Fingerprint.fromString(props.snapshotFingerprint),
      Fingerprint.fromString(props.scopeFingerprint),
      ImportBatchMode.create("DRY_RUN"),
      ImportBatchStatus.running(),
      null,
      null,
      null,
      props.countsBefore,
      null,
      null,
      agora,
      null,
      agora,
      agora
    );
  }

  /**
   * Abre um APPLY a partir de um DRY_RUN já concluído.
   *
   * Todas as recusas acontecem aqui, antes de qualquer escrita: dry-run
   * ausente, dry-run não concluído, modo errado, sistema de origem
   * diferente, versão de regras diferente e — a principal — escopo
   * alterado desde a simulação.
   */
  public static startApply(props: StartApplyProps): ImportBatch {
    const agora = props.now ?? new Date();
    const dryRun = props.dryRunBatch;

    if (!dryRun.getMode().isDryRun()) {
      throw new DryRunModeMismatchError();
    }
    if (!dryRun.getStatus().isCompleted()) {
      throw new DryRunBatchNotCompletedError(dryRun.getStatus().toString());
    }
    if (dryRun.getSourceSystem() !== props.sourceSystem) {
      throw new SourceSystemMismatchError();
    }

    const versaoApply = MappingRulesVersion.create(props.mappingRulesVersion);
    if (!dryRun.getMappingRulesVersion().equals(versaoApply)) {
      throw new MappingRulesVersionMismatchError(
        dryRun.getMappingRulesVersion().toString(),
        versaoApply.toString()
      );
    }

    const escopoApply = Fingerprint.fromString(props.scopeFingerprint);
    if (!dryRun.getScopeFingerprint().equals(escopoApply)) {
      throw new SourceChangedSinceDryRunError();
    }

    const aprovador = props.approvedByIdentityPublicId.trim();
    if (aprovador.length === 0) {
      throw new UnapprovedApplyError();
    }

    return new ImportBatch(
      randomUUID(),
      props.sourceSystem,
      versaoApply,
      Fingerprint.fromString(props.snapshotFingerprint),
      escopoApply,
      ImportBatchMode.create("APPLY"),
      ImportBatchStatus.running(),
      dryRun.getPublicId(),
      aprovador,
      agora,
      props.countsBefore,
      null,
      null,
      agora,
      null,
      agora,
      agora
    );
  }

  public static reconstitute(state: ImportBatchPersistedState): ImportBatch {
    const batch = new ImportBatch(
      state.publicId,
      state.sourceSystem as ImportSourceSystemValue,
      MappingRulesVersion.create(state.mappingRulesVersion),
      Fingerprint.fromString(state.snapshotFingerprint),
      Fingerprint.fromString(state.scopeFingerprint),
      ImportBatchMode.create(state.mode),
      ImportBatchStatus.create(state.status),
      state.dryRunBatchPublicId,
      state.approvedByIdentityPublicId,
      state.approvedAt,
      state.countsBefore,
      state.countsAfter,
      state.failureReason,
      state.startedAt,
      state.finishedAt,
      state.createdAt,
      state.updatedAt
    );
    batch.internalId = state.internalId;
    return batch;
  }

  /** Só um lote RUNNING aceita novos itens. */
  public assertAcceptsItems(): void {
    if (this.status.isTerminal()) {
      throw new ImportBatchNotRunningError(this.status.toString());
    }
  }

  public complete(countsAfter: ImportCounts, now?: Date): void {
    const alvo = ImportBatchStatus.create("COMPLETED");
    this.status.assertCanTransitionTo(alvo);
    this.status = alvo;
    this.countsAfter = countsAfter;
    this.finishedAt = now ?? new Date();
    this.updatedAt = this.finishedAt;
  }

  public fail(reason: string, now?: Date): void {
    const alvo = ImportBatchStatus.create("FAILED");
    this.status.assertCanTransitionTo(alvo);
    this.status = alvo;
    this.failureReason = ImportBatch.sanitizeReason(reason);
    this.finishedAt = now ?? new Date();
    this.updatedAt = this.finishedAt;
  }

  public abort(reason: string, now?: Date): void {
    const alvo = ImportBatchStatus.create("ABORTED");
    this.status.assertCanTransitionTo(alvo);
    this.status = alvo;
    this.failureReason = ImportBatch.sanitizeReason(reason);
    this.finishedAt = now ?? new Date();
    this.updatedAt = this.finishedAt;
  }

  /**
   * Colapsa quebras de linha e trunca no limite da coluna. Uma stack
   * trace inteira nunca cabe aqui — o que é exatamente a intenção:
   * `failure_reason` é um motivo legível, não um dump.
   */
  private static sanitizeReason(reason: string): string {
    const linha = reason.replace(/\s+/g, " ").trim();
    return linha.length > FAILURE_REASON_MAX ? `${linha.slice(0, FAILURE_REASON_MAX - 3)}...` : linha;
  }

  public assertApplyIsApproved(): void {
    if (this.mode.isApply() && (this.approvedByIdentityPublicId === null || this.approvedAt === null)) {
      throw new UnapprovedApplyError();
    }
  }

  public static assertDryRunProvided(dryRunPublicId: string | null | undefined): void {
    if (dryRunPublicId === null || dryRunPublicId === undefined || dryRunPublicId.trim().length === 0) {
      throw new ApplyWithoutDryRunError();
    }
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }

  /** Uso exclusivo da camada de infraestrutura — nunca exposto por getter público comum. */
  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public getPublicId(): string {
    return this.publicId;
  }

  public getSourceSystem(): ImportSourceSystemValue {
    return this.sourceSystem;
  }

  public getMappingRulesVersion(): MappingRulesVersion {
    return this.mappingRulesVersion;
  }

  public getSnapshotFingerprint(): Fingerprint {
    return this.snapshotFingerprint;
  }

  public getScopeFingerprint(): Fingerprint {
    return this.scopeFingerprint;
  }

  public getMode(): ImportBatchMode {
    return this.mode;
  }

  public getStatus(): ImportBatchStatus {
    return this.status;
  }

  public getDryRunBatchPublicId(): string | null {
    return this.dryRunBatchPublicId;
  }

  public getApprovedByIdentityPublicId(): string | null {
    return this.approvedByIdentityPublicId;
  }

  public getApprovedAt(): Date | null {
    return this.approvedAt;
  }

  public getCountsBefore(): ImportCounts {
    return this.countsBefore;
  }

  public getCountsAfter(): ImportCounts | null {
    return this.countsAfter;
  }

  public getFailureReason(): string | null {
    return this.failureReason;
  }

  public getStartedAt(): Date {
    return this.startedAt;
  }

  public getFinishedAt(): Date | null {
    return this.finishedAt;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getUpdatedAt(): Date {
    return this.updatedAt;
  }
}
