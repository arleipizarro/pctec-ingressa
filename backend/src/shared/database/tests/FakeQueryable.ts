import type { Queryable } from "../Queryable.js";

/**
 * Implementação fake de Queryable, em memória, para uso em testes
 * unitários — nunca abre conexão de rede ou de banco real.
 *
 * Entende um subconjunto muito pequeno e propositalmente simples de SQL
 * (o suficiente para exercitar a orquestração de MigrationRunner), além
 * de permitir registrar respostas programadas (`whenExecute`) para casos
 * mais específicos usados por outros testes (ex.: repositories).
 */
export class FakeQueryable implements Queryable {
  public readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

  private schemaMigrationsRows: Array<{ id: string; applied_at: Date }> = [];
  private readonly programmedResponses: Array<{
    match: (sql: string, params: readonly unknown[] | undefined) => boolean;
    respond: () => [unknown, unknown];
  }> = [];

  /** Registra uma resposta programada para chamadas cujo SQL/params batam com `match`. */
  public whenExecute(
    match: (sql: string, params: readonly unknown[] | undefined) => boolean,
    respond: () => [unknown, unknown]
  ): void {
    this.programmedResponses.push({ match, respond });
  }

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.calls.push({ sql, params });
    const normalized = sql.trim().toUpperCase();

    const programmed = this.programmedResponses.find((entry) => entry.match(sql, params));
    if (programmed !== undefined) {
      return programmed.respond();
    }

    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS SCHEMA_MIGRATIONS")) {
      return [[], []];
    }

    if (normalized.startsWith("SELECT ID FROM SCHEMA_MIGRATIONS")) {
      return [this.schemaMigrationsRows.map((row) => ({ id: row.id })), []];
    }

    if (normalized.startsWith("INSERT INTO SCHEMA_MIGRATIONS")) {
      const [id, appliedAt] = params ?? [];
      this.schemaMigrationsRows.push({ id: String(id), applied_at: appliedAt as Date });
      return [{ insertId: this.schemaMigrationsRows.length, affectedRows: 1 }, []];
    }

    // Qualquer outro SQL (ex.: CREATE TABLE identities/audit_events das
    // migrations) é aceito e simplesmente "executado" sem efeito — este
    // fake não simula um schema completo, apenas a orquestração de
    // aplicação de migrations.
    return [{ affectedRows: 0 }, []];
  }
}
