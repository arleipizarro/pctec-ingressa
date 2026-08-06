import { describe, it, expect } from "vitest";
import type { Pool } from "mysql2/promise";
import { MariaDbUnitOfWork } from "../UnitOfWork.js";
import { FakeTransactionalDatabase, FakeTransactionalPool } from "./FakeTransactionalPool.js";

/**
 * Testa MariaDbUnitOfWork isoladamente, sem passar por
 * CreateIdentityService — foco exclusivo na mecânica de
 * begin/commit/rollback/release. Nenhuma conexão de rede real é aberta;
 * FakeTransactionalPool é estruturalmente compatível com `Pool` de
 * mysql2/promise apenas o suficiente para exercitar `runInTransaction`.
 */
describe("MariaDbUnitOfWork — desenho da transação", () => {
  it("caminho de sucesso: begin → work → commit → release, sem rollback", async () => {
    const db = new FakeTransactionalDatabase();
    const pool = new FakeTransactionalPool(db);
    const unitOfWork = new MariaDbUnitOfWork(pool as unknown as Pool);

    const result = await unitOfWork.runInTransaction(async (connection) => {
      await connection.execute("INSERT INTO identities (x) VALUES (?)", ["a"]);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(pool.connectionsCreated).toHaveLength(1);
    const connection = pool.connectionsCreated[0]!;
    expect(connection.beginTransactionCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(1);
    expect(connection.rollbackCallCount).toBe(0);
    expect(connection.releaseCallCount).toBe(1);
  });

  it("caminho de falha: begin → work (lança) → rollback → release, sem commit", async () => {
    const db = new FakeTransactionalDatabase();
    const pool = new FakeTransactionalPool(db);
    const unitOfWork = new MariaDbUnitOfWork(pool as unknown as Pool);

    await expect(
      unitOfWork.runInTransaction(async () => {
        throw new Error("falha proposital dentro da transação");
      })
    ).rejects.toThrow("falha proposital dentro da transação");

    const connection = pool.connectionsCreated[0]!;
    expect(connection.beginTransactionCallCount).toBe(1);
    expect(connection.commitCallCount).toBe(0);
    expect(connection.rollbackCallCount).toBe(1);
    expect(connection.releaseCallCount).toBe(1);
  });

  it("libera a conexão (release) mesmo quando o rollback é necessário", async () => {
    const db = new FakeTransactionalDatabase();
    const pool = new FakeTransactionalPool(db);
    const unitOfWork = new MariaDbUnitOfWork(pool as unknown as Pool);

    await expect(
      unitOfWork.runInTransaction(async () => {
        throw new Error("qualquer falha");
      })
    ).rejects.toThrow();

    expect(pool.connectionsCreated[0]!.releaseCallCount).toBe(1);
  });

  it("a mesma conexão é passada para todo o callback `work` (uma única transação)", async () => {
    const db = new FakeTransactionalDatabase();
    const pool = new FakeTransactionalPool(db);
    const unitOfWork = new MariaDbUnitOfWork(pool as unknown as Pool);

    const seenConnections: unknown[] = [];
    await unitOfWork.runInTransaction(async (connection) => {
      seenConnections.push(connection);
      seenConnections.push(connection); // segunda "leitura" dentro do mesmo callback
      return undefined;
    });

    expect(seenConnections[0]).toBe(seenConnections[1]);
    expect(pool.connectionsCreated).toHaveLength(1);
  });
});
