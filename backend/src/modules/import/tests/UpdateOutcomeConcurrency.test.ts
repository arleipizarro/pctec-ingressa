import { describe, expect, it } from "vitest";
import { MariaDbImportBatchRepository } from "../infrastructure/persistence/MariaDbImportBatchRepository.js";
import { FinishImportBatchService } from "../application/FinishImportBatchService.js";
import { ImportBatch } from "../domain/ImportBatch.js";
import { Fingerprint } from "../domain/value-objects/Fingerprint.js";
import { ImportBatchNotRunningError } from "../domain/errors/ImportErrors.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";

const REGRAS = "helpdesk-v1";
const FP = Fingerprint.compute({
  mappingRulesVersion: REGRAS,
  records: [{ entityType: "users", legacyId: 35, fields: { active: 1 } }]
}).toString();

function loteRunning(): ImportBatch {
  return ImportBatch.startDryRun({
    sourceSystem: "PCTEC_HELPDESK",
    mappingRulesVersion: REGRAS,
    snapshotFingerprint: FP,
    scopeFingerprint: FP,
    countsBefore: {}
  });
}

/**
 * Conexão de mentira que devolve um `affectedRows` combinado para o
 * UPDATE e um status combinado para o SELECT de diagnóstico. Registra o
 * SQL executado para as asserções.
 */
class FakeConnection implements Queryable {
  public readonly sqls: string[] = [];

  public constructor(
    private readonly affectedRows: number,
    private readonly statusNoBanco: string | null = null
  ) {}

  public async execute(sql: string): Promise<[unknown, unknown]> {
    this.sqls.push(sql);
    if (/^\s*SELECT/i.test(sql)) {
      return [this.statusNoBanco === null ? [] : [{ status: this.statusNoBanco }], []];
    }
    return [{ affectedRows: this.affectedRows }, []];
  }
}

describe("updateOutcome — corrida entre dois processos que encerram o mesmo lote", () => {
  it("sucesso: uma linha afetada não lança e não faz SELECT de diagnóstico", async () => {
    const connection = new FakeConnection(1);
    const batch = loteRunning();
    batch.complete({ identities: 2 });

    await expect(new MariaDbImportBatchRepository(connection).updateOutcome(batch)).resolves.toBeUndefined();
    expect(connection.sqls.filter((s) => /^\s*SELECT/i.test(s))).toHaveLength(0);
  });

  it("o UPDATE continua condicionado a status = 'RUNNING'", async () => {
    const connection = new FakeConnection(1);
    const batch = loteRunning();
    batch.complete({});

    await new MariaDbImportBatchRepository(connection).updateOutcome(batch);

    const update = connection.sqls.find((s) => /^\s*UPDATE/i.test(s)) ?? "";
    expect(update).toContain("AND status = 'RUNNING'");
  });

  it("corrida: zero linhas afetadas lança ImportBatchNotRunningError", async () => {
    const connection = new FakeConnection(0, "FAILED");
    const batch = loteRunning();
    batch.complete({ identities: 2 });

    await expect(new MariaDbImportBatchRepository(connection).updateOutcome(batch)).rejects.toBeInstanceOf(
      ImportBatchNotRunningError
    );
  });

  it("o erro informa o status REAL do banco, não o da cópia em memória", async () => {
    const connection = new FakeConnection(0, "FAILED");
    const batch = loteRunning();
    batch.complete({ identities: 2 });

    await expect(new MariaDbImportBatchRepository(connection).updateOutcome(batch)).rejects.toThrow(/FAILED/);
  });

  it("linha sumida entre o UPDATE e o diagnóstico não vira exceção diferente", async () => {
    const connection = new FakeConnection(0, null);
    const batch = loteRunning();
    batch.complete({});

    await expect(new MariaDbImportBatchRepository(connection).updateOutcome(batch)).rejects.toBeInstanceOf(
      ImportBatchNotRunningError
    );
  });
});

describe("FinishImportBatchService — não reporta transição que não ocorreu no banco", () => {
  const unitOfWork = {
    runInTransaction: async <T>(fn: (connection: Queryable) => Promise<T>): Promise<T> => fn({} as Queryable)
  } as unknown as UnitOfWork;

  function servicoCom(connection: Queryable, batch: ImportBatch): FinishImportBatchService {
    const repository = new MariaDbImportBatchRepository(connection);
    return new FinishImportBatchService(unitOfWork, () => ({
      insert: repository.insert.bind(repository),
      updateOutcome: repository.updateOutcome.bind(repository),
      findByPublicId: async () => batch,
      findRunningBySourceSystem: async () => undefined
    }));
  }

  it("perdedor da corrida recebe erro — nunca um COMPLETED de mentira", async () => {
    const batch = loteRunning();
    const servico = servicoCom(new FakeConnection(0, "FAILED"), batch);

    await expect(servico.complete({ batchPublicId: batch.getPublicId(), countsAfter: {} })).rejects.toBeInstanceOf(
      ImportBatchNotRunningError
    );
  });

  it("vencedor da corrida recebe o status que de fato foi gravado", async () => {
    const batch = loteRunning();
    const servico = servicoCom(new FakeConnection(1), batch);

    const resultado = await servico.complete({ batchPublicId: batch.getPublicId(), countsAfter: { identities: 2 } });
    expect(resultado.status).toBe("COMPLETED");
    expect(resultado.batchPublicId).toBe(batch.getPublicId());
  });
});
