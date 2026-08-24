import { describe, expect, it } from "vitest";
import { RecordImportBatchItemService } from "../application/RecordImportBatchItemService.js";
import { ImportBatch } from "../domain/ImportBatch.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type {
  ImportBatchItemPage,
  ImportBatchItemRepository,
  ListImportBatchItemsQuery
} from "../domain/ImportBatchItemRepository.js";
import type { ImportBatchItem } from "../domain/ImportBatchItem.js";
import { Fingerprint } from "../domain/value-objects/Fingerprint.js";
import { DryRunCannotWriteError, ImportBatchNotFoundError } from "../domain/errors/ImportErrors.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";

const REGRAS = "helpdesk-v1";
const FP = Fingerprint.compute({
  mappingRulesVersion: REGRAS,
  records: [{ entityType: "users", legacyId: 35, fields: { active: 1 } }]
}).toString();

const fakeUnitOfWork: UnitOfWork = {
  runInTransaction: async <T>(fn: (connection: Queryable) => Promise<T>): Promise<T> =>
    fn({} as Queryable)
} as unknown as UnitOfWork;

class FakeBatchRepository implements ImportBatchRepository {
  public constructor(private readonly batches: Map<string, ImportBatch>) {}
  public async insert(): Promise<void> {}
  public async updateOutcome(): Promise<void> {}
  public async findByPublicId(publicId: string): Promise<ImportBatch | undefined> {
    return this.batches.get(publicId);
  }
  public async findRunningBySourceSystem(): Promise<ImportBatch | undefined> {
    return undefined;
  }
}

class FakeItemRepository implements ImportBatchItemRepository {
  public readonly inserted: ImportBatchItem[] = [];
  public constructor(private readonly processed: Set<string> = new Set()) {}
  public async insert(item: ImportBatchItem): Promise<void> {
    this.inserted.push(item);
  }
  public async insertMany(items: readonly ImportBatchItem[]): Promise<void> {
    this.inserted.push(...items);
  }
  public async list(_query: ListImportBatchItemsQuery): Promise<ImportBatchItemPage> {
    return { items: this.inserted, total: this.inserted.length, limit: 50, offset: 0 };
  }
  public async countByAction(): Promise<Readonly<Record<string, number>>> {
    return {};
  }
  public async findProcessedSourceKeys(): Promise<ReadonlySet<string>> {
    return this.processed;
  }
}

function dryRunEmAndamento(): ImportBatch {
  return ImportBatch.startDryRun({
    sourceSystem: "PCTEC_HELPDESK",
    mappingRulesVersion: REGRAS,
    snapshotFingerprint: FP,
    scopeFingerprint: FP,
    countsBefore: {}
  });
}

const ITEM_BASE = {
  entityKind: "IDENTITY",
  sourceEntityType: "users",
  sourceLegacyId: 35,
  action: "CREATE"
};

describe("RecordImportBatchItemService", () => {
  it("grava as decisões do lote", async () => {
    const batch = dryRunEmAndamento();
    const itens = new FakeItemRepository();
    const service = new RecordImportBatchItemService(
      fakeUnitOfWork,
      () => new FakeBatchRepository(new Map([[batch.getPublicId(), batch]])),
      () => itens
    );

    const resultado = await service.execute({
      batchPublicId: batch.getPublicId(),
      items: [ITEM_BASE, { ...ITEM_BASE, sourceLegacyId: 44 }]
    });

    expect(resultado.recorded).toBe(2);
    expect(resultado.skippedAsAlreadyProcessed).toBe(0);
    expect(itens.inserted).toHaveLength(2);
  });

  it("RETOMADA — reprocessar o mesmo lote não duplica a trilha", async () => {
    const batch = dryRunEmAndamento();
    // O processo morreu depois de decidir o usuário 35.
    const jaProcessado = new Set(["IDENTITY:users:35"]);
    const itens = new FakeItemRepository(jaProcessado);
    const service = new RecordImportBatchItemService(
      fakeUnitOfWork,
      () => new FakeBatchRepository(new Map([[batch.getPublicId(), batch]])),
      () => itens
    );

    const resultado = await service.execute({
      batchPublicId: batch.getPublicId(),
      items: [ITEM_BASE, { ...ITEM_BASE, sourceLegacyId: 44 }]
    });

    expect(resultado.recorded).toBe(1);
    expect(resultado.skippedAsAlreadyProcessed).toBe(1);
    expect(itens.inserted.map((i) => i.getSourceLegacyId())).toEqual(["44"]);
  });

  it("DRY_RUN nunca registra targetPublicId — não houve escrita", async () => {
    const batch = dryRunEmAndamento();
    const service = new RecordImportBatchItemService(
      fakeUnitOfWork,
      () => new FakeBatchRepository(new Map([[batch.getPublicId(), batch]])),
      () => new FakeItemRepository()
    );

    await expect(
      service.execute({
        batchPublicId: batch.getPublicId(),
        items: [{ ...ITEM_BASE, targetPublicId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }]
      })
    ).rejects.toBeInstanceOf(DryRunCannotWriteError);
  });

  it("snapshot é sanitizado antes de virar item", async () => {
    const batch = dryRunEmAndamento();
    const itens = new FakeItemRepository();
    const service = new RecordImportBatchItemService(
      fakeUnitOfWork,
      () => new FakeBatchRepository(new Map([[batch.getPublicId(), batch]])),
      () => itens
    );

    await service.execute({
      batchPublicId: batch.getPublicId(),
      items: [
        {
          ...ITEM_BASE,
          after: {
            allowedFields: ["id", "email", "role"],
            source: { id: 35, email: "f@afip.com.br", role: "cliente", password: "$2b$10$segredo" }
          }
        }
      ]
    });

    const json = JSON.stringify(itens.inserted[0]?.getAfterSnapshot()?.toJSON());
    expect(json).not.toContain("segredo");
    expect(json).toContain("cliente");
  });

  it("lote inexistente é recusado", async () => {
    const service = new RecordImportBatchItemService(
      fakeUnitOfWork,
      () => new FakeBatchRepository(new Map()),
      () => new FakeItemRepository()
    );

    await expect(
      service.execute({ batchPublicId: "11111111-2222-3333-4444-555555555555", items: [ITEM_BASE] })
    ).rejects.toBeInstanceOf(ImportBatchNotFoundError);
  });

  it("lote terminal não aceita novos itens", async () => {
    const batch = dryRunEmAndamento();
    batch.complete({});
    const service = new RecordImportBatchItemService(
      fakeUnitOfWork,
      () => new FakeBatchRepository(new Map([[batch.getPublicId(), batch]])),
      () => new FakeItemRepository()
    );

    await expect(
      service.execute({ batchPublicId: batch.getPublicId(), items: [ITEM_BASE] })
    ).rejects.toThrow();
  });
});
