import { describe, it, expect } from "vitest";
import type { Pool } from "mysql2/promise";
import { CreateIdentityService } from "../application/CreateIdentityService.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import {
  FakeTransactionalDatabase,
  FakeTransactionalPool,
  type FakeFailureConfig
} from "../../../shared/database/tests/FakeTransactionalPool.js";

/**
 * Prova, fim a fim (Application Service → UnitOfWork →
 * IdentityRepository + AuditEventRepository), que CreateIdentity é
 * atômico: a criação da Identity e a gravação dos AuditEvents ocorrem na
 * mesma conexão, na mesma transação, com um único commit; qualquer falha
 * no meio do caminho causa rollback integral (nada fica persistido).
 *
 * Usa FakeTransactionalPool/FakeTransactionalConnection — nenhuma
 * conexão de rede real é aberta, nenhum MariaDB é necessário. O fake
 * simula visibilidade transacional de verdade (escritas só aparecem em
 * `FakeTransactionalDatabase` após `commit()`), não apenas a ordem das
 * chamadas — por isso o cenário 3 (falha no audit insert) consegue
 * provar que a Identity "não permanece persistida", e não apenas que o
 * código não chamou o passo seguinte.
 */
function buildService(failureConfig: FakeFailureConfig = {}) {
  const db = new FakeTransactionalDatabase();
  const pool = new FakeTransactionalPool(db, failureConfig);
  const unitOfWork = new MariaDbUnitOfWork(pool as unknown as Pool);

  // Capturamos, por chamada, a connection recebida por cada factory —
  // usado no teste do cenário 5, para provar que ambos os repositories
  // recebem exatamente o mesmo objeto de conexão.
  const seenConnectionsByFactory: { identity?: unknown; audit?: unknown } = {};

  const service = new CreateIdentityService(
    unitOfWork,
    (connection) => {
      seenConnectionsByFactory.identity = connection;
      return new MariaDbIdentityRepository(connection);
    },
    (connection) => {
      seenConnectionsByFactory.audit = connection;
      return new MariaDbAuditEventRepository(connection);
    }
  );

  return { service, db, pool, seenConnectionsByFactory };
}

describe("CreateIdentityService — atomicidade (Identity + AuditEvent)", () => {
  it("1. sucesso: begin, identity insert, audit insert, commit — tudo fica visível após commit", async () => {
    const { service, db, pool } = buildService();

    await service.execute({
      type: "HUMAN",
      fullName: "Pessoa Atômica",
      email: "atomica@example.com",
      actorPublicId: "SYSTEM"
    });

    expect(pool.connectionsCreated).toHaveLength(1);
    const connection = pool.connectionsCreated[0]!;
    expect(connection.beginTransactionCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(1);
    expect(connection.rollbackCallCount).toBe(0);

    // Só aparecem em "committedX" porque commit() foi chamado.
    expect(db.committedIdentityInserts).toHaveLength(1);
    expect(db.committedAuditEventInserts).toHaveLength(1);
  });

  it("2. falha no identity insert: nenhum audit insert, rollback, nenhum commit", async () => {
    const { service, db, pool } = buildService({ failOnSqlPrefix: "INSERT INTO IDENTITIES" });

    await expect(
      service.execute({
        type: "HUMAN",
        fullName: "Pessoa Falha Identity",
        email: "falha-identity@example.com",
        actorPublicId: "SYSTEM"
      })
    ).rejects.toThrow();

    const connection = pool.connectionsCreated[0]!;
    expect(connection.commitCallCount).toBe(0);
    expect(connection.rollbackCallCount).toBe(1);

    // A gravação de auditoria nunca foi tentada — o código nem chega lá,
    // pois o insert da Identity lança antes.
    const auditInsertAttempted = connection.executeCalls.some((call) =>
      call.sql.toUpperCase().includes("INSERT INTO AUDIT_EVENTS")
    );
    expect(auditInsertAttempted).toBe(false);

    expect(db.committedIdentityInserts).toHaveLength(0);
    expect(db.committedAuditEventInserts).toHaveLength(0);
  });

  it("3. falha no audit insert: a Identity NÃO permanece persistida (rollback integral), nenhum commit", async () => {
    const { service, db, pool } = buildService({ failOnSqlPrefix: "INSERT INTO AUDIT_EVENTS" });

    await expect(
      service.execute({
        type: "HUMAN",
        fullName: "Pessoa Falha Audit",
        email: "falha-audit@example.com",
        actorPublicId: "SYSTEM"
      })
    ).rejects.toThrow();

    const connection = pool.connectionsCreated[0]!;
    // O INSERT da Identity foi de fato tentado e "aceito" pela conexão
    // (fica pendente na transação)...
    const identityInsertAttempted = connection.executeCalls.some((call) =>
      call.sql.toUpperCase().includes("INSERT INTO IDENTITIES")
    );
    expect(identityInsertAttempted).toBe(true);

    // ...mas como o audit insert falhou depois, a transação inteira foi
    // revertida — a Identity pendente nunca foi promovida a
    // "committed". Isto prova atomicidade real, não apenas ordem de
    // chamadas: se não fosse atômico, o insert da Identity (que ocorreu
    // ANTES da falha) poderia ter ficado persistido isoladamente.
    expect(db.committedIdentityInserts).toHaveLength(0);
    expect(db.committedAuditEventInserts).toHaveLength(0);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.rollbackCallCount).toBe(1);
  });

  it("4. qualquer erro antes do commit resulta em exatamente um rollback (nunca zero, nunca mais de um)", async () => {
    const scenarios: FakeFailureConfig[] = [
      { failOnSqlPrefix: "SELECT 1 FROM IDENTITIES" }, // falha na checagem de unicidade
      { failOnSqlPrefix: "INSERT INTO IDENTITIES" },
      { failOnSqlPrefix: "INSERT INTO AUDIT_EVENTS" }
    ];

    for (const [index, failureConfig] of scenarios.entries()) {
      const { service, pool } = buildService(failureConfig);
      await expect(
        service.execute({
          type: "HUMAN",
          fullName: "Pessoa Cenario",
          email: `cenario-${index}@example.com`,
          actorPublicId: "SYSTEM"
        })
      ).rejects.toThrow();

      const connection = pool.connectionsCreated[0]!;
      expect(connection.rollbackCallCount).toBe(1);
      expect(connection.commitCallCount).toBe(0);
    }
  });

  it("5. IdentityRepository e AuditEventRepository recebem exatamente o mesmo contexto transacional (mesma connection)", async () => {
    const { service, seenConnectionsByFactory } = buildService();

    await service.execute({
      type: "HUMAN",
      fullName: "Pessoa Mesma Conexao",
      email: "mesma-conexao@example.com",
      actorPublicId: "SYSTEM"
    });

    expect(seenConnectionsByFactory.identity).toBeDefined();
    expect(seenConnectionsByFactory.audit).toBeDefined();
    expect(seenConnectionsByFactory.identity).toBe(seenConnectionsByFactory.audit);
  });

  it("nenhum repository abre sua própria conexão — apenas uma conexão é obtida do pool por execução", async () => {
    const { service, pool } = buildService();

    await service.execute({
      type: "HUMAN",
      fullName: "Pessoa Conexao Unica",
      email: "conexao-unica@example.com",
      actorPublicId: "SYSTEM"
    });

    expect(pool.connectionsCreated).toHaveLength(1);
  });
});
