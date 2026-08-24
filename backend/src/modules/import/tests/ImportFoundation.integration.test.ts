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
import { MappingRulesVersion } from "../domain/value-objects/MappingRulesVersion.js";
import { ImportBatchNotRunningError } from "../domain/errors/ImportErrors.js";

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
  mappingRulesVersion: MappingRulesVersion.create(REGRAS),
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

    // O perdedor da corrida agora SABE que perdeu: zero linhas afetadas
    // vira ImportBatchNotRunningError, em vez de no-op silencioso que
    // faria o service reportar uma transição que não aconteceu.
    await expect(repository.updateOutcome(concorrente)).rejects.toBeInstanceOf(ImportBatchNotRunningError);

    const final = await repository.findByPublicId(batch.getPublicId());
    expect(final?.getStatus().toString()).toBe("COMPLETED");
    expect(final?.getFailureReason()).toBeNull();

    await pool.end();
  });

  /**
   * A corrida do teste acima roda o UPDATE perdedor direto no pool, sem
   * transação em volta — então não existe snapshot anterior e o
   * diagnóstico lê dado atual por acidente. A produção NÃO é assim:
   * `FinishImportBatchService.transition` abre transação e faz
   * `findByPublicId` ANTES de transicionar, o que fixa o snapshot da
   * transação com o lote ainda RUNNING. Este teste reproduz esse
   * desenho com duas conexões reais e prova que o diagnóstico nomeia o
   * estado ATUAL — o que só vale por causa do `FOR UPDATE`.
   *
   * Timeout explícito no `it` e `innodb_lock_wait_timeout` curto nas
   * duas sessões: se algum lock travar, o teste falha em segundos com
   * erro do banco, em vez de pendurar a suíte.
   *
   * O interleaving é DETERMINÍSTICO e não usa `sleep` nenhum: cada passo
   * é uma promise aguardada, e o `await` é a barreira — a transação
   * seguinte só começa depois que a anterior terminou. As duas
   * transações nunca correm ao mesmo tempo; elas são INTERCALADAS numa
   * ordem fixa, que é o que reproduz a corrida sem flakiness. Os dois
   * limites que importam não são só ordenados, são AFIRMADOS: o snapshot
   * do perdedor abriu antes do commit do vencedor (provado pela leitura
   * simples que ainda devolve RUNNING) e o commit do vencedor aconteceu
   * antes do UPDATE do perdedor (provado pelas zero linhas afetadas). Se
   * alguém trocar essa disciplina por espera cronometrada, as duas
   * asserções caem junto.
   */
  it(
    "corrida entre duas transações: o perdedor recebe o estado ATUAL, não o RUNNING do seu snapshot",
    async () => {
      const batch = ImportBatch.startDryRun({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: REGRAS,
        snapshotFingerprint: FP,
        scopeFingerprint: FP,
        countsBefore: {}
      });
      await new MariaDbImportBatchRepository(pool).insert(batch);

      // Duas conexões físicas distintas do pool — não dois handles do
      // mesmo socket. Sem isso não há duas transações: `beginTransaction`
      // é estado de SESSÃO, e a segunda apenas sobrescreveria a primeira.
      // O `threadId` é o id da sessão no servidor; afirmá-lo diferente
      // torna a premissa verificável em vez de suposta.
      const perdedor = await pool.getConnection();
      const vencedor = await pool.getConnection();
      try {
        expect(perdedor.threadId).toEqual(expect.any(Number));
        expect(perdedor.threadId).not.toBe(vencedor.threadId);

        await perdedor.query("SET SESSION innodb_lock_wait_timeout = 5");
        await vencedor.query("SET SESSION innodb_lock_wait_timeout = 5");
        // REPEATABLE READ já é o padrão do InnoDB; fixar aqui torna o
        // teste independente da configuração do servidor de quem roda.
        await perdedor.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");

        // Perdedor abre a transação e lê o lote — é este SELECT que fixa
        // o snapshot, exatamente como o service faz antes de transicionar.
        await perdedor.beginTransaction();
        const repoPerdedor = new MariaDbImportBatchRepository(perdedor);
        const loteDoPerdedor = await repoPerdedor.findByPublicId(batch.getPublicId());
        expect(loteDoPerdedor?.getStatus().toString()).toBe("RUNNING");

        // Vencedor: transação separada, encerra o lote e commita.
        await vencedor.beginTransaction();
        const repoVencedor = new MariaDbImportBatchRepository(vencedor);
        const loteDoVencedor = await repoVencedor.findByPublicId(batch.getPublicId());
        expect(loteDoVencedor).toBeDefined();
        (loteDoVencedor as ImportBatch).fail("vencedor da corrida");
        await repoVencedor.updateOutcome(loteDoVencedor as ImportBatch);
        await vencedor.commit();

        // Prova de que o snapshot do perdedor ficou para trás: leitura
        // SIMPLES, na transação ainda aberta, continua devolvendo RUNNING.
        // É este valor que o diagnóstico reportava antes do FOR UPDATE.
        const [linhasDoSnapshot] = await perdedor.execute(
          `SELECT status FROM import_batches WHERE public_id = ? LIMIT 1`,
          [batch.getPublicId()]
        );
        expect((linhasDoSnapshot as Array<{ status: string }>)[0]?.status).toBe("RUNNING");

        // O perdedor tenta concluir. O UPDATE condicionado não encontra
        // linha RUNNING e o diagnóstico — leitura travada — informa FAILED.
        (loteDoPerdedor as ImportBatch).complete({ identities: 1 });
        const erro = await repoPerdedor
          .updateOutcome(loteDoPerdedor as ImportBatch)
          .then(() => null, (e: unknown) => e as Error);

        expect(erro).toBeInstanceOf(ImportBatchNotRunningError);
        expect(erro?.message).toContain("O lote está em FAILED");
        expect(erro?.message).not.toContain("O lote está em RUNNING");
      } finally {
        // Rollback no finally, não no fim do try: uma asserção que falha
        // devolveria a conexão ao pool com transação aberta e locks
        // presos, derrubando os testes seguintes por contaminação em vez
        // de por defeito próprio.
        await perdedor.rollback().catch(() => undefined);
        await vencedor.rollback().catch(() => undefined);
        perdedor.release();
        vencedor.release();
      }

      // O lote não foi corrompido: manteve o desfecho do vencedor, sem
      // countsAfter do perdedor por cima.
      const final = await new MariaDbImportBatchRepository(pool).findByPublicId(batch.getPublicId());
      expect(final?.getStatus().toString()).toBe("FAILED");
      expect(final?.getFailureReason()).toBe("vencedor da corrida");
      expect(final?.getCountsAfter()).toBeNull();

      await pool.end();
    },
    20_000
  );

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
