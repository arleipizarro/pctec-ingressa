import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  HelpdeskClientRecord,
  HelpdeskSourceReader,
  HelpdeskUserRecord
} from "../../domain/pilot/HelpdeskSourcePort.js";
import { assertReadOnlySourceQuery, buildClientByIdQuery, buildUsersByIdsQuery } from "./HelpdeskSourceQueries.js";

interface UserRow {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: number | boolean | null;
  readonly client_id: number | null;
}

interface ClientRow {
  readonly id: number;
  readonly name: string;
  readonly active: number | boolean | null;
}

/**
 * Conector READ-ONLY do Helpdesk.
 *
 * Três camadas independentes impedem escrita, e nenhuma delas confia nas
 * outras:
 *
 *  1. O principal MariaDB tem SELECT de COLUNA em `users` e `clients`.
 *     Não há INSERT/UPDATE/DELETE para conceder, nem `SELECT *` que
 *     funcione.
 *  2. `assertReadOnlySourceQuery` recusa qualquer SQL que não seja um
 *     SELECT único sobre as colunas permitidas.
 *  3. Esta classe não expõe método de escrita. Não existe `execute`
 *     público por onde passar SQL arbitrário.
 *
 * `tinyint(1)` chega do driver como número: a conversão para boolean
 * acontece aqui, na fronteira, para que o domínio nunca receba `1` e
 * precise lembrar o que significa.
 */
export class MariaDbHelpdeskReadOnlySource implements HelpdeskSourceReader {
  public constructor(private readonly connection: Queryable) {}

  public async readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    const { sql, params } = buildUsersByIdsQuery(ids);
    const rows = await this.select<UserRow>(sql, params);
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      email: row.email,
      role: row.role,
      active: toBoolean(row.active),
      clientId: row.client_id === null ? null : Number(row.client_id)
    }));
  }

  public async readClientById(clientId: number): Promise<HelpdeskClientRecord | undefined> {
    const { sql, params } = buildClientByIdQuery(clientId);
    const rows = await this.select<ClientRow>(sql, params);
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    return { id: Number(row.id), name: row.name, active: toBoolean(row.active) };
  }

  /** Único ponto de execução da classe — e ele revalida o SQL. */
  private async select<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    assertReadOnlySourceQuery(sql);
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }
}

function toBoolean(value: number | boolean | null): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value === 1;
}
