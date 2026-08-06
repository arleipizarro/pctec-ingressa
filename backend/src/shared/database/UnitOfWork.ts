import type { Pool } from "mysql2/promise";
import type { Queryable } from "./Queryable.js";

/**
 * Abstração transacional mínima. Permite que um Application Service
 * execute múltiplas escritas (ex.: gravar uma Identity e seus eventos de
 * auditoria) atomicamente, sem conhecer detalhes de `mysql2`.
 */
export interface UnitOfWork {
  runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T>;
}

/**
 * Implementação de UnitOfWork sobre um Pool mysql2/promise.
 *
 * BEGIN/COMMIT/ROLLBACK explícitos; a conexão é sempre liberada de volta
 * ao pool (`release()`) no `finally`, mesmo em caso de erro.
 */
export class MariaDbUnitOfWork implements UnitOfWork {
  public constructor(private readonly pool: Pool) {}

  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
