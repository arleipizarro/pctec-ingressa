/**
 * Testes de integração da fundação do importador — MariaDB real.
 *
 * ATENÇÃO: exigem `RUN_INTEGRATION_TESTS=true` e um banco ISOLADO
 * (`DB_NAME` de teste, nunca DEV). São excluídos de `npm test`.
 *
 * O banco de teste precisa ter as migrations 0017–0021 aplicadas.
 * Nenhuma linha real é tocada: os fingerprints e legacyIds usados aqui
 * são sintéticos (`999997`), o mesmo prefixo já adotado nas demais
 * suítes de integração do projeto.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPool } from "mysql2/promise";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { MariaDbImportBatchRepository } from "../infrastructure/persistence/MariaDbImportBatchRepository.js";
import { MariaDbImportBatchItemRepository } from "../infrastructure/persistence/MariaDbImportBatchItemRepository.js";
import { ImportBatch } from "../domain/ImportBatch.js";
import { ImportBatchItem } from "../domain/ImportBatchItem.js";
import { ImportItemSnapshot } from "../domain/ImportItemSnapshot.js";
import { Fingerprint } from "../domain/value-objects/Fingerprint.js";

const DB_CONFIG = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "root",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? "pctec_ingressa_test"
};

const REGRAS = "helpdesk-test";
const SYNTHETIC_LEGACY_ID = 999997;
const FP = Fingerprint.compute({
  mappingRulesVersion: REGRAS,
  records: [{ entityType: "users", legacyId: SYNTHETIC_LEGACY_ID, fields: { active: 1 } }]
}).toString();

const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("fundação do importador — integração MariaDB", () => {
  let pool: Awaited<ReturnType<typeof createPool>>;

  beforeEach(async () => {
    pool = createPool(DB_CONFIG);
    // Limpa somente as linhas sintéticas desta suíte — nunca DELETE geral.
    await pool.execute(
      `DELETE FROM import_batch_items WHERE source_legacy_id = ?`,
      [SYNTHETIC_LEGACY_ID]
    );
    await pool.execute(`DELETE FROM import_batches WHERE mapping_rules_version = ?`, [REGRAS]);
  });

  it("persiste e recupera um dry-run com os dois fingerprints", async () => {
    const repository = new MariaDbImportBatchRepository(pool);
    const batch = ImportBatch.startDryRun({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: FP,
      scopeFingerprint: FP,
      countsBefore: { identities: 7 }
    });

    await repository.insert(batch);
    const recuperado = await repository.findByPublicId(batch.getPublicId());

    expect(recuperado).toBeDefined();
    expect(recuperado?.getMode().toString()).toBe("DRY_RUN");
    expect(recuperado?.getStatus().toString()).toBe("RUNNING");
    expect(recuperado?.getScopeFingerprint().toString()).toBe(FP);
    expect(recuperado?.getCountsBefore()).toEqual({ identities: 7 });

    await pool.end();
  });

  it("updateOutcome só transiciona um lote RUNNING — segunda tentativa não sobrescreve", async () => {
    const repository = new MariaDbImportBatchRepository(pool);
    const batch = ImportBatch.startDryRun({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: FP,
      scopeFingerprint: FP,
      countsBefore: {}
    });
    await repository.insert(batch);

    batch.complete({ identities: 2 });
    await repository.updateOutcome(batch);

    // Simula um segundo processo tentando marcar FAILED por cima.
    const concorrente = ImportBatch.reconstitute({
      internalId: 0,
      publicId: batch.getPublicId(),
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: FP,
      scopeFingerprint: FP,
      mode: "DRY_RUN",
      status: "RUNNING",
      dryRunBatchPublicId: null,
      approvedByIdentityPublicId: null,
      approvedAt: null,
      countsBefore: {},
      countsAfter: null,
      failureReason: null,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    concorrente.fail("tentativa concorrente");
    await repository.updateOutcome(concorrente);

    const final = await repository.findByPublicId(batch.getPublicId());
    expect(final?.getStatus().toString()).toBe("COMPLETED");
    expect(final?.getFailureReason()).toBeNull();

    await pool.end();
  });

  it("grava itens em lote e devolve relatório paginado com contagem por ação", async () => {
    const batchRepository = new MariaDbImportBatchRepository(pool);
    const itemRepository = new MariaDbImportBatchItemRepository(pool);

    const batch = ImportBatch.startDryRun({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: FP,
      scopeFingerprint: FP,
      countsBefore: {}
    });
    await batchRepository.insert(batch);

    const itens = [
      ImportBatchItem.record({
        batchPublicId: batch.getPublicId(),
        batchIsDryRun: true,
        entityKind: "IDENTITY",
        sourceEntityType: "users",
        sourceLegacyId: SYNTHETIC_LEGACY_ID,
        action: "CREATE",
        afterSnapshot: ImportItemSnapshot.fromWhitelist(
          ["id", "role"],
          { id: SYNTHETIC_LEGACY_ID, role: "cliente", password: "nao-pode-vazar" }
        )
      }),
      ImportBatchItem.record({
        batchPublicId: batch.getPublicId(),
        batchIsDryRun: true,
        entityKind: "MEMBERSHIP",
        sourceEntityType: "users",
        sourceLegacyId: SYNTHETIC_LEGACY_ID,
        action: "QUARANTINE",
        reasonCode: "EMAIL_MATCHES_EXISTING_IDENTITY"
      })
    ];
    await itemRepository.insertMany(itens);

    const pagina = await itemRepository.list({
      batchPublicId: batch.getPublicId(),
      limit: 10,
      offset: 0
    });
    expect(pagina.total).toBe(2);

    const porAcao = await itemRepository.countByAction(batch.getPublicId());
    expect(porAcao).toEqual({ CREATE: 1, QUARANTINE: 1 });

    // O snapshot persistido não carrega o campo sensível.
    const serializado = JSON.stringify(pagina.items.map((i) => i.getAfterSnapshot()?.toJSON() ?? null));
    expect(serializado).not.toContain("nao-pode-vazar");

    // Retomada: as chaves já decididas são reconhecidas.
    const chaves = await itemRepository.findProcessedSourceKeys(batch.getPublicId());
    expect(chaves.has(`IDENTITY:users:${SYNTHETIC_LEGACY_ID}`)).toBe(true);
    expect(chaves.has(`MEMBERSHIP:users:${SYNTHETIC_LEGACY_ID}`)).toBe(true);

    await pool.end();
  });
});
