/**
 * Testes de integração da INVARIANTE DE BINDING e do lifecycle
 * SUPERSEDE contra MariaDB real — fundação PCTEC Meu RH (migration
 * 0024).
 *
 * ATENÇÃO: exigem `RUN_INTEGRATION_TESTS=true` e um banco cujo nome
 * termine em `_test` (ver `integration-database-guard.ts`) — a guarda
 * RECUSA apontar para `pctec_ingressa_dev` ou `pctec_ingressa`, por
 * decisão tomada depois de um incidente real. Não rodam em `npm test`.
 *
 * A recusa da constraint também foi verificada MANUALMENTE contra o
 * banco de DEV, em transação revertida (nenhuma linha alterada):
 *
 *   ERROR 1062 (23000): Duplicate entry
 *   '66231e51-...-PCTEC_PORTAL-portal_aces...'
 *   for key 'uk_id_ext_ref_active_binding'
 *
 * e o caso simétrico — linha SUPERSEDED libera a chave para a
 * substituta — foi verificado do mesmo modo.
 *
 * Fixtures sintéticas: legacyIds na faixa 9998xx, e-mails
 * `@example.invalid` com sufixo por rodada. Nenhum dado real.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPool } from "mysql2/promise";
import { fixtureRunId } from "../../../shared/types/integration-database-guard.js";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { MariaDbIdentityRepository } from "../infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityExternalReferenceRepository } from "../infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { ExistingConnectionUnitOfWork } from "../../../shared/database/ExistingConnectionUnitOfWork.js";
import { Identity } from "../domain/Identity.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { SupersedeIdentityExternalReferenceService } from "../application/SupersedeIdentityExternalReferenceService.js";
import { GetActiveIdentityExternalReferenceByIdentityService } from "../application/GetActiveIdentityExternalReferenceByIdentityService.js";
import { IdentityExternalReferenceBindingAlreadyExistsError } from "../domain/errors/IdentityExternalReferenceErrors.js";

const DB_CONFIG = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "root",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? "pctec_ingressa_test"
};

const SYSTEM_ACTOR = ActorPublicId.system();
const ATOR = "8f14e45f-ceea-467e-a1a3-000000000001";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000003";
const SISTEMA = "PCTEC_HUB";
const ENTIDADE = "rh_colaboradores";
const LEGACY_A = 999810;
const LEGACY_B = 999811;

const RUN = fixtureRunId();
const emailDaRodada = (prefixo: string): string => `${prefixo}.${RUN}@example.invalid`;

/**
 * Segunda camada de proteção: mesmo invocado diretamente pelo vitest,
 * sem passar pela config de integração, este arquivo se PULA quando
 * `RUN_INTEGRATION_TESTS` não está ligado — e FALHA alto, antes da
 * primeira escrita, se estiver ligado apontando para um banco que não
 * seja `*_test`.
 */
const deveRodar = shouldRunIntegrationTests();

describe.skipIf(!deveRodar)("IdentityExternalReference — invariante de binding e supersede (migration 0024)", () => {
  let pool: Awaited<ReturnType<typeof createPool>>;

  beforeEach(async () => {
    pool = createPool(DB_CONFIG);
    await limparFixtures();
  });

  afterEach(async () => {
    try {
      await limparFixtures();
    } finally {
      await pool.end();
    }
  });

  async function limparFixtures(): Promise<void> {
    await pool.execute(`DELETE FROM identity_external_references WHERE legacy_id IN (?, ?)`, [
      LEGACY_A,
      LEGACY_B
    ]);
    await pool.execute(`DELETE FROM audit_events WHERE correlation_id = ?`, [CORRELATION_ID]);
    await pool.execute(`DELETE FROM identities WHERE email_normalized LIKE ?`, [`%.${RUN}@example.invalid`]);
  }

  async function criarIdentidade(prefixo: string): Promise<string> {
    const connection = await pool.getConnection();
    try {
      const identity = Identity.create({
        type: "HUMAN",
        email: emailDaRodada(prefixo),
        fullName: "Synthetic Binding Identity",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
      await new MariaDbIdentityRepository(connection).insert(identity);
      return identity.getPublicId().toString();
    } finally {
      connection.release();
    }
  }

  it("o BANCO recusa uma segunda referência ACTIVE para (identity, system, entity)", async () => {
    const identityPublicId = await criarIdentidade("binding.duplo");
    const connection = await pool.getConnection();
    try {
      const repository = new MariaDbIdentityExternalReferenceRepository(connection);
      const primeira = IdentityExternalReference.create({
        identityPublicId,
        systemCode: SISTEMA,
        entityType: ENTIDADE,
        legacyId: LEGACY_A,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: ATOR,
        correlationId: CORRELATION_ID
      });
      await repository.insert(primeira);

      const segunda = IdentityExternalReference.create({
        identityPublicId,
        systemCode: SISTEMA,
        entityType: ENTIDADE,
        // legacyId DIFERENTE: a chave de 0016 não seria violada, só a de 0024.
        legacyId: LEGACY_B,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: ATOR,
        correlationId: CORRELATION_ID
      });

      // A recusa vem da UNIQUE KEY, traduzida pelo repositório para erro
      // de domínio — nunca um erro cru de driver vazando para cima.
      await expect(repository.insert(segunda)).rejects.toBeInstanceOf(
        IdentityExternalReferenceBindingAlreadyExistsError
      );

      const total = await repository.countActiveByIdentityAndSystemCodeAndEntityType(
        identityPublicId,
        SystemCode.create(SISTEMA),
        EntityType.create(ENTIDADE)
      );
      expect(total).toBe(1);
    } finally {
      connection.release();
    }
  });

  it("supersede + substituição: uma transação, sem janela com duas ACTIVE, e a resolução passa a devolver a nova", async () => {
    const identityPublicId = await criarIdentidade("binding.supersede");
    const connection = await pool.getConnection();
    try {
      const repository = new MariaDbIdentityExternalReferenceRepository(connection);
      const original = IdentityExternalReference.create({
        identityPublicId,
        systemCode: SISTEMA,
        entityType: ENTIDADE,
        legacyId: LEGACY_A,
        matchMethod: "MATCHED_BY_EMAIL",
        actorPublicId: ATOR,
        correlationId: CORRELATION_ID
      });
      await repository.insert(original);

      const service = new SupersedeIdentityExternalReferenceService(
        new ExistingConnectionUnitOfWork(connection),
        (c) => new MariaDbIdentityExternalReferenceRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );

      const resultado = await service.execute({
        referencePublicId: original.getPublicId().toString(),
        reason: "MATCH_CORRECTION",
        actorPublicId: ATOR,
        correlationId: CORRELATION_ID,
        replacement: { legacyId: LEGACY_B, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
      });

      // A antiga continua na tabela — supersede nunca é DELETE.
      const antiga = await repository.findByPublicId(original.getPublicId());
      expect(antiga?.getStatus()).toBe("SUPERSEDED");
      expect(antiga?.getLegacyId().toNumber()).toBe(LEGACY_A);

      const resolver = new GetActiveIdentityExternalReferenceByIdentityService(repository);
      const resolvida = await resolver.execute(identityPublicId, SISTEMA, ENTIDADE);
      expect(resolvida.getLegacyId().toNumber()).toBe(LEGACY_B);
      expect(resolvida.getPublicId().toString()).toBe(resultado.replacementPublicId);

      // Exatamente uma ACTIVE em todo o processo.
      const ativas = await repository.countActiveByIdentityAndSystemCodeAndEntityType(
        identityPublicId,
        SystemCode.create(SISTEMA),
        EntityType.create(ENTIDADE)
      );
      expect(ativas).toBe(1);
    } finally {
      connection.release();
    }
  });

  it("a auditoria registra o supersede e liga a substituta por causationId", async () => {
    const identityPublicId = await criarIdentidade("binding.auditoria");
    const connection = await pool.getConnection();
    try {
      const repository = new MariaDbIdentityExternalReferenceRepository(connection);
      const original = IdentityExternalReference.create({
        identityPublicId,
        systemCode: SISTEMA,
        entityType: ENTIDADE,
        legacyId: LEGACY_A,
        matchMethod: "MATCHED_BY_EMAIL",
        actorPublicId: ATOR,
        correlationId: CORRELATION_ID
      });
      await repository.insert(original);

      await new SupersedeIdentityExternalReferenceService(
        new ExistingConnectionUnitOfWork(connection),
        (c) => new MariaDbIdentityExternalReferenceRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      ).execute({
        referencePublicId: original.getPublicId().toString(),
        reason: "MATCH_CORRECTION",
        actorPublicId: ATOR,
        correlationId: CORRELATION_ID,
        replacement: { legacyId: LEGACY_B, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
      });

      const [rows] = await pool.execute(
        `SELECT event_type, actor_public_id, causation_id, event_version
           FROM audit_events
          WHERE correlation_id = ?
            AND event_type LIKE 'identity-external-reference.%'
          ORDER BY persisted_at`,
        [CORRELATION_ID]
      );
      const eventos = rows as Array<{
        event_type: string;
        actor_public_id: string;
        causation_id: string | null;
        event_version: number;
      }>;

      const superseded = eventos.find((e) => e.event_type === "identity-external-reference.superseded");
      const created = eventos.find((e) => e.event_type === "identity-external-reference.created");

      expect(superseded).toBeDefined();
      expect(superseded?.actor_public_id).toBe(ATOR);
      expect(superseded?.event_version).toBe(1);
      expect(created?.causation_id).not.toBeNull();
    } finally {
      connection.release();
    }
  });
});
