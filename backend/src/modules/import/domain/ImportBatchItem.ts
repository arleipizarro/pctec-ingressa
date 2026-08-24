import { randomUUID } from "node:crypto";
import { ImportAction } from "./value-objects/ImportAction.js";
import { ImportEntityKind } from "./value-objects/ImportEntityKind.js";
import { ImportItemSnapshot } from "./ImportItemSnapshot.js";
import { DryRunCannotWriteError } from "./errors/ImportErrors.js";

/** Limite de `error_message` na migration 0021. */
const ERROR_MESSAGE_MAX = 500;

export interface RecordImportBatchItemProps {
  readonly batchPublicId: string;
  readonly batchIsDryRun: boolean;
  readonly entityKind: string;
  readonly sourceEntityType: string;
  readonly sourceLegacyId: string | number;
  readonly action: string;
  readonly targetPublicId?: string | null | undefined;
  readonly beforeSnapshot?: ImportItemSnapshot | undefined;
  readonly afterSnapshot?: ImportItemSnapshot | undefined;
  readonly reasonCode?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly now?: Date | undefined;
}

export interface ImportBatchItemPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly batchPublicId: string;
  readonly entityKind: string;
  readonly sourceEntityType: string;
  readonly sourceLegacyId: string | number;
  readonly action: string;
  readonly targetPublicId: string | null;
  readonly beforeSnapshot: Record<string, unknown> | null;
  readonly afterSnapshot: Record<string, unknown> | null;
  readonly reasonCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
}

/**
 * Uma decisão do importador sobre um registro de origem.
 *
 * Em DRY_RUN descreve o que SERIA feito; em APPLY, o que foi feito. Uma
 * invariante separa os dois: um item de DRY_RUN nunca carrega
 * `targetPublicId`, porque não houve escrita — se carregasse, o
 * relatório de simulação passaria a afirmar que algo existe.
 */
export class ImportBatchItem {
  private internalId: number | undefined;

  private constructor(
    private readonly publicId: string,
    private readonly batchPublicId: string,
    private readonly entityKind: ImportEntityKind,
    private readonly sourceEntityType: string,
    private readonly sourceLegacyId: string,
    private readonly action: ImportAction,
    private readonly targetPublicId: string | null,
    private readonly beforeSnapshot: ImportItemSnapshot | null,
    private readonly afterSnapshot: ImportItemSnapshot | null,
    private readonly reasonCode: string | null,
    private readonly errorMessage: string | null,
    private readonly createdAt: Date
  ) {}

  public static record(props: RecordImportBatchItemProps): ImportBatchItem {
    const action = ImportAction.create(props.action);
    const entityKind = ImportEntityKind.create(props.entityKind);
    const target = props.targetPublicId ?? null;

    if (props.batchIsDryRun && target !== null) {
      throw new DryRunCannotWriteError(action.toString());
    }

    return new ImportBatchItem(
      randomUUID(),
      props.batchPublicId,
      entityKind,
      props.sourceEntityType,
      String(props.sourceLegacyId),
      action,
      target,
      props.beforeSnapshot ?? null,
      props.afterSnapshot ?? null,
      props.reasonCode ?? null,
      ImportBatchItem.sanitizeError(props.errorMessage ?? null),
      props.now ?? new Date()
    );
  }

  public static reconstitute(state: ImportBatchItemPersistedState): ImportBatchItem {
    const item = new ImportBatchItem(
      state.publicId,
      state.batchPublicId,
      ImportEntityKind.create(state.entityKind),
      state.sourceEntityType,
      String(state.sourceLegacyId),
      ImportAction.create(state.action),
      state.targetPublicId,
      state.beforeSnapshot === null ? null : ImportItemSnapshot.fromWhitelist(Object.keys(state.beforeSnapshot), state.beforeSnapshot),
      state.afterSnapshot === null ? null : ImportItemSnapshot.fromWhitelist(Object.keys(state.afterSnapshot), state.afterSnapshot),
      state.reasonCode,
      state.errorMessage,
      state.createdAt
    );
    item.internalId = state.internalId;
    return item;
  }

  /**
   * Colapsa quebras de linha e trunca. Uma stack trace não cabe — o que
   * é a intenção: `error_message` é mensagem, não dump.
   */
  private static sanitizeError(message: string | null): string | null {
    if (message === null) {
      return null;
    }
    const linha = message.replace(/\s+/g, " ").trim();
    if (linha.length === 0) {
      return null;
    }
    return linha.length > ERROR_MESSAGE_MAX ? `${linha.slice(0, ERROR_MESSAGE_MAX - 3)}...` : linha;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }

  public getInternalId(): number | undefined {
    return this.internalId;
  }

  public getPublicId(): string {
    return this.publicId;
  }

  public getBatchPublicId(): string {
    return this.batchPublicId;
  }

  public getEntityKind(): ImportEntityKind {
    return this.entityKind;
  }

  public getSourceEntityType(): string {
    return this.sourceEntityType;
  }

  public getSourceLegacyId(): string {
    return this.sourceLegacyId;
  }

  public getAction(): ImportAction {
    return this.action;
  }

  public getTargetPublicId(): string | null {
    return this.targetPublicId;
  }

  public getBeforeSnapshot(): ImportItemSnapshot | null {
    return this.beforeSnapshot;
  }

  public getAfterSnapshot(): ImportItemSnapshot | null {
    return this.afterSnapshot;
  }

  public getReasonCode(): string | null {
    return this.reasonCode;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }
}
