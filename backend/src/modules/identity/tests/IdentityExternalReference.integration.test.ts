/**
 * Testes de integração: IdentityExternalReference + MariaDB real.
 *
 * ATENÇÃO: estes testes requerem banco MariaDB real (migration 0016
 * aplicada) e variáveis de ambiente de banco configuradas. NÃO são
 * executados na suíte unitária padrão (`npm test`) — são excluídos via
 * `vitest.config.ts` (padrão `.integration.test.ts` separado).
 *
 * Fixtures sintéticas: legacyId=999997 (nunca colide com dado real).
 * Identity criada aqui nunca referencia e-mails, CPFs ou public_ids
 * reais de produção/piloto.
 *
 * Nenhuma escrita nas tabelas `organization_external_references`,
 * `organizations`, `portal_acesso` ou qualquer tabela do Portal
 * (auditoria de isolamento: só `identities` + `identity_external_references`
 * + `audit_events`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createPool } from "mysql2/promise";
import { MariaDbIdentityRepository } from "../infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityExternalReferenceRepository } from "../infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { Identity } from "../domain/Identity.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";

const DB_CONFIG = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "root",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? "pctec_ingressa_test"
};

const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000002";
// legacyId sintético — nunca colide com dado real de produção/piloto.
const SYNTHETIC_LEGACY_ID = 999997;

describe("IdentityExternalReference — integração MariaDB (migration 0016)", () => {
  let pool: Awaited<ReturnType<typeof createPool>>;

  beforeEach(async () => {
    pool = createPool(DB_CONFIG);
    // Limpa apenas as linhas sintéticas desta suíte — nunca DELETE geral.
    await pool.execute(
      `DELETE FROM identity_external_references WHERE legacy_id = ?`,
      [SYNTHETIC_LEGACY_ID]
    );
  });

  it("insere e reconstrói IdentityExternalReference com matchMethod via MariaDB real", async () => {
    const connection = await pool.getConnection();
    try {
      const identityRepository = new MariaDbIdentityRepository(connection);
      const referenceRepository = new MariaDbIdentityExternalReferenceRepository(connection);

      // Cria uma Identity sintética para ser a FK da referência.
      const identity = Identity.create({
        type: "HUMAN",
        email: "synthetic.test.999997@example.invalid",
        fullName: "Synthetic Test Identity",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      await identityRepository.insert(identity);

      const reference = IdentityExternalReference.create({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: SYNTHETIC_LEGACY_ID,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: "8f14e45f-ceea-467e-a1a3-000000000001",
        correlationId: CORRELATION_ID
      });

      await referenceRepository.insert(reference);

      // Reconstrói via findActiveBySystemCodeEntityTypeAndLegacyId
      // (direção reversa — Portal encontra Identity pelo legacyId).
      const found = await referenceRepository.findActiveBySystemCodeEntityTypeAndLegacyId(
        SystemCode.create("PCTEC_PORTAL"),
        EntityType.create("portal_acesso"),
        LegacyId.create(SYNTHETIC_LEGACY_ID)
      );

      expect(found).toBeDefined();
      expect(found?.getIdentityPublicId()).toBe(identity.getPublicId().toString());
      expect(found?.getMatchMethod().toString()).toBe("MATCHED_MANUAL_CONFIRMED");
      expect(found?.isActive()).toBe(true);
    } finally {
      connection.release();
    }
  });

  it("existsActiveBySystemCodeEntityTypeAndLegacyId retorna false antes de inserir e true depois", async () => {
    const connection = await pool.getConnection();
    try {
      const referenceRepository = new MariaDbIdentityExternalReferenceRepository(connection);

      const beforeInsert = await referenceRepository.existsActiveBySystemCodeEntityTypeAndLegacyId(
        SystemCode.create("PCTEC_PORTAL"),
        EntityType.create("portal_acesso"),
        LegacyId.create(SYNTHETIC_LEGACY_ID)
      );
      expect(beforeInsert).toBe(false);

      const identityRepository = new MariaDbIdentityRepository(connection);
      const identity = Identity.create({
        type: "HUMAN",
        email: "synthetic.test2.999997@example.invalid",
        fullName: "Synthetic Test Identity 2",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      await identityRepository.insert(identity);

      const reference = IdentityExternalReference.create({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: SYNTHETIC_LEGACY_ID,
        matchMethod: "MATCHED_BY_EMAIL",
        actorPublicId: "8f14e45f-ceea-467e-a1a3-000000000001",
        correlationId: CORRELATION_ID
      });
      await referenceRepository.insert(reference);

      const afterInsert = await referenceRepository.existsActiveBySystemCodeEntityTypeAndLegacyId(
        SystemCode.create("PCTEC_PORTAL"),
        EntityType.create("portal_acesso"),
        LegacyId.create(SYNTHETIC_LEGACY_ID)
      );
      expect(afterInsert).toBe(true);
    } finally {
      connection.release();
    }
  });

  it("findActiveBySystemCodeEntityTypeAndLegacyId retorna undefined quando só existe SUPERSEDED (nunca há ACTIVE para essa chave)", async () => {
    const connection = await pool.getConnection();
    try {
      const identityRepository = new MariaDbIdentityRepository(connection);
      const referenceRepository = new MariaDbIdentityExternalReferenceRepository(connection);

      const identity = Identity.create({
        type: "HUMAN",
        email: "synthetic.test3.999997@example.invalid",
        fullName: "Synthetic Test Identity 3",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      await identityRepository.insert(identity);

      // Insere diretamente um estado SUPERSEDED (simula referência antiga corrigida).
      await connection.execute(
        `INSERT INTO identity_external_references
           (public_id, identity_public_id, system_code, entity_type, legacy_id,
            match_method, status, created_at, updated_at)
         VALUES (UUID(), ?, 'PCTEC_PORTAL', 'portal_acesso', ?, 'MATCHED_MANUAL_CONFIRMED', 'SUPERSEDED', NOW(3), NOW(3))`,
        [identity.getPublicId().toString(), SYNTHETIC_LEGACY_ID]
      );

      const found = await referenceRepository.findActiveBySystemCodeEntityTypeAndLegacyId(
        SystemCode.create("PCTEC_PORTAL"),
        EntityType.create("portal_acesso"),
        LegacyId.create(SYNTHETIC_LEGACY_ID)
      );

      expect(found).toBeUndefined();
    } finally {
      connection.release();
    }
  });

  it("UNIQUE KEY uk_id_ext_ref_active_match impede duas linhas ACTIVE para a mesma chave (legado→Identity)", async () => {
    const connection = await pool.getConnection();
    try {
      const identityRepository = new MariaDbIdentityRepository(connection);
      const referenceRepository = new MariaDbIdentityExternalReferenceRepository(connection);

      const identity = Identity.create({
        type: "HUMAN",
        email: "synthetic.test4.999997@example.invalid",
        fullName: "Synthetic Test Identity 4",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      await identityRepository.insert(identity);

      const ref1 = IdentityExternalReference.create({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: SYNTHETIC_LEGACY_ID,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: "8f14e45f-ceea-467e-a1a3-000000000001",
        correlationId: CORRELATION_ID
      });
      await referenceRepository.insert(ref1);

      const ref2 = IdentityExternalReference.create({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: SYNTHETIC_LEGACY_ID,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: "8f14e45f-ceea-467e-a1a3-000000000001",
        correlationId: CORRELATION_ID
      });

      // O segundo INSERT deve falhar com IdentityExternalReferenceAlreadyExistsError
      // (traduzido da violação de UNIQUE KEY uk_id_ext_ref_active_match).
      await expect(referenceRepository.insert(ref2)).rejects.toThrow(
        "IdentityExternalReference"
      );
    } finally {
      connection.release();
    }
  });

  it("múltiplas linhas SUPERSEDED para a mesma chave são permitidas (coexistem como histórico)", async () => {
    const connection = await pool.getConnection();
    try {
      const identityRepository = new MariaDbIdentityRepository(connection);
      const identity = Identity.create({
        type: "HUMAN",
        email: "synthetic.test5.999997@example.invalid",
        fullName: "Synthetic Test Identity 5",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      await identityRepository.insert(identity);

      // Duas linhas SUPERSEDED para o mesmo legacyId — nunca conflitam.
      await connection.execute(
        `INSERT INTO identity_external_references
           (public_id, identity_public_id, system_code, entity_type, legacy_id,
            match_method, status, created_at, updated_at)
         VALUES (UUID(), ?, 'PCTEC_PORTAL', 'portal_acesso', ?, 'MATCHED_BY_EMAIL', 'SUPERSEDED', NOW(3), NOW(3))`,
        [identity.getPublicId().toString(), SYNTHETIC_LEGACY_ID]
      );
      await connection.execute(
        `INSERT INTO identity_external_references
           (public_id, identity_public_id, system_code, entity_type, legacy_id,
            match_method, status, created_at, updated_at)
         VALUES (UUID(), ?, 'PCTEC_PORTAL', 'portal_acesso', ?, 'MATCHED_MANUAL_CONFIRMED', 'SUPERSEDED', NOW(3), NOW(3))`,
        [identity.getPublicId().toString(), SYNTHETIC_LEGACY_ID]
      );

      const [rows] = await connection.execute(
        `SELECT COUNT(*) AS cnt FROM identity_external_references WHERE legacy_id = ? AND status = 'SUPERSEDED'`,
        [SYNTHETIC_LEGACY_ID]
      );
      const count = (rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
      expect(count).toBe(2);
    } finally {
      connection.release();
    }
  });

  /**
   * Migration 0019 acrescentou CREATED_FROM_SOURCE ao ENUM
   * `match_method`. Este teste fecha o ciclo no banco real: grava pelo
   * repositório, confere o valor CRU na coluna (o ENUM aceitou) e
   * reconstitui pelo repositório (o VO volta com o mesmo valor). Sem ele,
   * a única prova de CREATED_FROM_SOURCE seria unitária — e um ENUM que
   * não foi estendido no banco só falha em tempo de execução.
   */
  it("persiste e reconstitui matchMethod CREATED_FROM_SOURCE (migration 0019)", async () => {
    const connection = await pool.getConnection();
    try {
      const identityRepository = new MariaDbIdentityRepository(connection);
      const referenceRepository = new MariaDbIdentityExternalReferenceRepository(connection);

      const identity = Identity.create({
        type: "HUMAN",
        email: "synthetic.test6.999997@example.invalid",
        fullName: "Synthetic Test Identity 6",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      await identityRepository.insert(identity);

      const reference = IdentityExternalReference.create({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: SYNTHETIC_LEGACY_ID,
        matchMethod: "CREATED_FROM_SOURCE",
        actorPublicId: "8f14e45f-ceea-467e-a1a3-000000000001",
        correlationId: CORRELATION_ID
      });
      await referenceRepository.insert(reference);

      // 1) valor cru na coluna — prova que o ENUM do banco aceitou.
      const [rows] = await connection.execute(
        `SELECT match_method FROM identity_external_references
          WHERE legacy_id = ? AND status = 'ACTIVE'`,
        [SYNTHETIC_LEGACY_ID]
      );
      const persistido = (rows as Array<{ match_method: string }>)[0]?.match_method;
      expect(persistido).toBe("CREATED_FROM_SOURCE");

      // 2) reconstituição pelo repositório — o VO volta com o mesmo valor.
      const found = await referenceRepository.findActiveBySystemCodeEntityTypeAndLegacyId(
        SystemCode.create("PCTEC_PORTAL"),
        EntityType.create("portal_acesso"),
        LegacyId.create(SYNTHETIC_LEGACY_ID)
      );
      expect(found).toBeDefined();
      expect(found?.getMatchMethod().toString()).toBe("CREATED_FROM_SOURCE");
      expect(found?.isActive()).toBe(true);
    } finally {
      connection.release();
    }
  });
});
