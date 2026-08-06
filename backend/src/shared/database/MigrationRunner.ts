import type { Queryable } from "./Queryable.js";

export interface MigrationDefinition {
  readonly id: string;
  readonly description: string;
  readonly up: string;
  readonly down: string;
}

export interface MigrationApplyReport {
  readonly appliedIds: readonly string[];
  readonly alreadyAppliedIds: readonly string[];
}

/**
 * Runner mínimo de migrations.
 *
 * Escopo desta fatia (v0.4.0 Slice 1): apenas `applyPending`, que aplica,
 * em ordem, as migrations cujo `id` ainda não está em `schema_migrations`.
 * Não há comando de rollback automatizado aqui — o SQL `down` de cada
 * migration existe (ver `src/shared/database/migrations/*.down.sql`) para
 * reversão manual, documentada, mas a orquestração de rollback automático
 * fica para uma fatia futura (decisão registrada no relatório desta
 * entrega, para não ampliar o escopo).
 *
 * Testável sem conexão real: depende apenas de `Queryable`, que pode ser
 * uma implementação fake em memória nos testes (ver
 * `MigrationRunner.test.ts`).
 *
 * Este runner NUNCA é invocado automaticamente pelo bootstrap da
 * aplicação nesta fatia — só roda se explicitamente instanciado e
 * chamado por código de operação, o que não ocorre em nenhum ponto de
 * entrada padrão (não há `main.ts` que o invoque).
 */
export class MigrationRunner {
  public constructor(private readonly connection: Queryable) {}

  public async applyPending(migrations: readonly MigrationDefinition[]): Promise<MigrationApplyReport> {
    await this.ensureSchemaMigrationsTableExists();
    const applied = await this.fetchAppliedIds();

    const appliedIds: string[] = [];
    const alreadyAppliedIds: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.id)) {
        alreadyAppliedIds.push(migration.id);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- migrations devem ser
      // aplicadas estritamente em ordem, uma após a outra.
      await this.connection.execute(migration.up);
      // eslint-disable-next-line no-await-in-loop
      await this.connection.execute(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`, [
        migration.id,
        new Date()
      ]);
      appliedIds.push(migration.id);
    }

    return { appliedIds, alreadyAppliedIds };
  }

  private async ensureSchemaMigrationsTableExists(): Promise<void> {
    await this.connection.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id VARCHAR(64) NOT NULL,
         applied_at DATETIME(3) NOT NULL,
         PRIMARY KEY (id)
       ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_520_ci`
    );
  }

  private async fetchAppliedIds(): Promise<Set<string>> {
    const [rows] = await this.connection.execute(`SELECT id FROM schema_migrations`);
    const rowList = rows as Array<Record<string, unknown>>;
    return new Set(rowList.map((row) => String(row["id"])));
  }
}
