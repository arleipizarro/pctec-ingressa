/**
 * Integração do dry-run do piloto — Ingressa real, schema ISOLADO.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e `DB_NAME` de teste com as
 * migrations 0017–0021 aplicadas. Nunca aponta para DEV por padrão.
 *
 * A origem aqui é um duplo em memória: o objetivo é provar o que
 * acontece do lado do INGRESSA — que o dry-run grava lote e itens, que
 * a associação afirmada fica registrada, e que nenhuma entidade de
 * domínio nasce. A leitura real do Helpdesk é provada em
 * `HelpdeskPilotSource.integration.test.ts`.
 *
 * Todas as linhas criadas usam o prefixo sintético `999996` e são
 * removidas antes e depois — nenhuma limpeza geral de tabela.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbImportBatchRepository } from "../infrastructure/persistence/MariaDbImportBatchRepository.js";
import { MariaDbImportBatchItemRepository } from "../infrastructure/persistence/MariaDbImportBatchItemRepository.js";
import { MariaDbIngressaTargetStateReader } from "../infrastructure/persistence/MariaDbIngressaTargetStateReader.js";
import { StartImportBatchService } from "../application/StartImportBatchService.js";
import { RecordImportBatchItemService } from "../application/RecordImportBatchItemService.js";
import { FinishImportBatchService } from "../application/FinishImportBatchService.js";
import { RunHelpdeskPilotImportService } from "../application/RunHelpdeskPilotImportService.js";
import type { HelpdeskClientRecord, HelpdeskSourceReader, HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";
import { PILOT_MAPPING_RULES_VERSION, PILOT_USER_IDS } from "../domain/pilot/HelpdeskPilotScope.js";

const DB_CONFIG = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "root",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? "pctec_ingressa_test"
};

const CLIENTE_SINTETICO = 999996;
const RAZAO_SOCIAL = "EMPRESA SINTETICA DO PILOTO 999996";
const USUARIOS: readonly HelpdeskUserRecord[] = [
  { id: 35, name: "Piloto Um", email: "piloto.um.999996@example.invalid", role: "cliente", active: true, clientId: CLIENTE_SINTETICO },
  { id: 44, name: "Piloto Dois", email: "piloto.dois.999996@example.invalid", role: "cliente", active: true, clientId: CLIENTE_SINTETICO }
];

class FonteEmMemoria implements HelpdeskSourceReader {
  public async readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    return USUARIOS.filter((u) => ids.includes(u.id));
  }

  public async readClientById(clientId: number): Promise<HelpdeskClientRecord | undefined> {
    return clientId === CLIENTE_SINTETICO
      ? { id: CLIENTE_SINTETICO, name: RAZAO_SOCIAL, active: true, documentNumber: null }
      : undefined;
  }
}

const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("dry-run do piloto — integração Ingressa", () => {
  let pool: Pool;
  let organizationPublicId: string;

  async function limpar(): Promise<void> {
    await pool.execute(
      `DELETE FROM import_batch_items WHERE batch_public_id IN
         (SELECT public_id FROM import_batches WHERE mapping_rules_version = ?)`,
      [PILOT_MAPPING_RULES_VERSION]
    );
    await pool.execute(`DELETE FROM import_batches WHERE mapping_rules_version = ?`, [
      PILOT_MAPPING_RULES_VERSION
    ]);
    await pool.execute(`DELETE FROM organizations WHERE legal_name = ?`, [RAZAO_SOCIAL]);
    await pool.execute(`DELETE FROM identities WHERE email_normalized LIKE ?`, ["%999996@example.invalid"]);
  }

  beforeEach(async () => {
    pool = createPool(DB_CONFIG);
    await limpar();
    organizationPublicId = randomUUID();
    await pool.execute(
      `INSERT INTO organizations (public_id, type, legal_name, trade_name, status, version, created_at, updated_at)
       VALUES (?, 'COMPANY', ?, ?, 'ACTIVE', 1, NOW(3), NOW(3))`,
      [organizationPublicId, RAZAO_SOCIAL, "PILOTO 999996"]
    );
  });

  afterEach(async () => {
    await limpar();
    await pool.end();
  });

  function montarRunner(): RunHelpdeskPilotImportService {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    return new RunHelpdeskPilotImportService({
      source: new FonteEmMemoria(),
      targetStateReader: new MariaDbIngressaTargetStateReader(pool),
      startImportBatchService: new StartImportBatchService(
        unitOfWork,
        (c) => new MariaDbImportBatchRepository(c)
      ),
      recordImportBatchItemService: new RecordImportBatchItemService(
        unitOfWork,
        (c) => new MariaDbImportBatchRepository(c),
        (c) => new MariaDbImportBatchItemRepository(c)
      ),
      finishImportBatchService: new FinishImportBatchService(
        unitOfWork,
        (c) => new MariaDbImportBatchRepository(c)
      )
    });
  }

  async function contar(tabela: string): Promise<number> {
    const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM ${tabela}`);
    return Number((rows as { total: number | string }[])[0]?.total ?? 0);
  }

  it("grava lote e itens, e não cria nenhuma entidade de domínio", async () => {
    const antes = {
      identities: await contar("identities"),
      refs: await contar("identity_external_references"),
      memberships: await contar("memberships"),
      accesses: await contar("application_accesses")
    };

    const resultado = await montarRunner().execute({
      mode: "DRY_RUN",
      mapping: { expectedSourceClientId: CLIENTE_SINTETICO, targetOrganizationPublicId: organizationPublicId }
    });

    expect(resultado.status).toBe("COMPLETED");
    expect(resultado.mappingRulesVersion).toBe("helpdesk-v2");
    expect(resultado.countsByAction).toMatchObject({ CREATE: 8, SKIP: 0, CONFLICT: 0, QUARANTINE: 0 });

    expect(await contar("identities")).toBe(antes.identities);
    expect(await contar("identity_external_references")).toBe(antes.refs);
    expect(await contar("memberships")).toBe(antes.memberships);
    expect(await contar("application_accesses")).toBe(antes.accesses);

    const [itens] = await pool.execute(
      `SELECT source_legacy_id, entity_kind, action, reason_code, target_public_id, after_snapshot
         FROM import_batch_items WHERE batch_public_id = ? ORDER BY source_legacy_id, id`,
      [resultado.batchPublicId]
    );
    const linhas = itens as {
      source_legacy_id: number | string;
      entity_kind: string;
      action: string;
      target_public_id: string | null;
      after_snapshot: string | Record<string, unknown> | null;
    }[];

    expect(linhas).toHaveLength(8);
    expect(linhas.every((l) => l.action === "CREATE")).toBe(true);
    expect(linhas.every((l) => l.target_public_id === null)).toBe(true);
    expect([...new Set(linhas.map((l) => Number(l.source_legacy_id)))].sort()).toEqual([...PILOT_USER_IDS].sort());
    expect(linhas.some((l) => Number(l.source_legacy_id) === 45)).toBe(false);
  });

  it("persiste a associação origem→destino no snapshot, legível depois", async () => {
    const resultado = await montarRunner().execute({
      mode: "DRY_RUN",
      mapping: { expectedSourceClientId: CLIENTE_SINTETICO, targetOrganizationPublicId: organizationPublicId }
    });

    const [itens] = await pool.execute(
      `SELECT after_snapshot FROM import_batch_items
        WHERE batch_public_id = ? AND entity_kind = 'MEMBERSHIP'`,
      [resultado.batchPublicId]
    );
    const snapshots = (itens as { after_snapshot: string | Record<string, unknown> }[]).map((linha) =>
      typeof linha.after_snapshot === "string"
        ? (JSON.parse(linha.after_snapshot) as Record<string, unknown>)
        : linha.after_snapshot
    );

    expect(snapshots).toHaveLength(2);
    for (const snapshot of snapshots) {
      expect(snapshot["source_client_id"]).toBe(CLIENTE_SINTETICO);
      expect(snapshot["organization_public_id"]).toBe(organizationPublicId);
      expect(snapshot["scope"]).toBe("ORGANIZATION_ONLY");
      expect(JSON.stringify(snapshot).toLowerCase()).not.toMatch(/password|senha|token|hash|salt/);
    }
  });

  it("recusa antes de abrir lote quando o destino informado não existe", async () => {
    const inexistente = randomUUID();
    const antes = await contar("import_batches");

    await expect(
      montarRunner().execute({
        mode: "DRY_RUN",
        mapping: { expectedSourceClientId: CLIENTE_SINTETICO, targetOrganizationPublicId: inexistente }
      })
    ).rejects.toThrow(/não resolvida/);

    expect(await contar("import_batches")).toBe(antes);
  });

  it("recusa antes de abrir lote quando o destino não é COMPANY ACTIVE", async () => {
    await pool.execute(`UPDATE organizations SET status = 'INACTIVE' WHERE public_id = ?`, [
      organizationPublicId
    ]);
    const antes = await contar("import_batches");

    await expect(
      montarRunner().execute({
        mode: "DRY_RUN",
        mapping: { expectedSourceClientId: CLIENTE_SINTETICO, targetOrganizationPublicId: organizationPublicId }
      })
    ).rejects.toThrow(/não é elegível/);

    expect(await contar("import_batches")).toBe(antes);
  });

  it("recusa vínculo cadastral divergente do informado", async () => {
    const antes = await contar("import_batches");

    await expect(
      montarRunner().execute({
        mode: "DRY_RUN",
        mapping: { expectedSourceClientId: 999995, targetOrganizationPublicId: organizationPublicId }
      })
    ).rejects.toThrow(/vínculo cadastral divergente/);

    expect(await contar("import_batches")).toBe(antes);
  });

  it("retomada: reexecutar sobre o mesmo lote não duplica a trilha", async () => {
    const resultado = await montarRunner().execute({
      mode: "DRY_RUN",
      mapping: { expectedSourceClientId: CLIENTE_SINTETICO, targetOrganizationPublicId: organizationPublicId }
    });

    const service = new RecordImportBatchItemService(
      new MariaDbUnitOfWork(pool),
      (c) => new MariaDbImportBatchRepository(c),
      (c) => new MariaDbImportBatchItemRepository(c)
    );
    const chaves = await new MariaDbImportBatchItemRepository(pool).findProcessedSourceKeys(
      resultado.batchPublicId
    );
    expect(chaves.size).toBe(8);
    void service;

    const [linhas] = await pool.execute(
      `SELECT COUNT(*) AS total FROM import_batch_items WHERE batch_public_id = ?`,
      [resultado.batchPublicId]
    );
    expect(Number((linhas as { total: number | string }[])[0]?.total)).toBe(8);
  });
});
