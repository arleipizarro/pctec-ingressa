import { describe, it, expect } from "vitest";
import { loadMigrationDefinitions } from "../loadMigrationDefinitions.js";

describe("loadMigrationDefinitions", () => {
  it("carrega as 7 migrations esperadas, em ordem, cada uma com up e down não vazios", () => {
    const migrations = loadMigrationDefinitions();

    expect(migrations.map((m) => m.id)).toEqual([
      "0001_create_schema_migrations",
      "0002_create_identities",
      "0003_create_audit_events",
      "0004_add_checksum_and_timing_to_schema_migrations",
      "0005_create_applications",
      "0006_create_application_accesses",
      "0007_seed_pctec_ingressa_application"
    ]);

    for (const migration of migrations) {
      expect(migration.up.trim().length).toBeGreaterThan(0);
      expect(migration.down.trim().length).toBeGreaterThan(0);
    }
  });

  it("as migrations que criam tabela usam CREATE TABLE / DROP TABLE (0004 é ALTER TABLE, 0007 é seed INSERT/DELETE)", () => {
    const migrations = loadMigrationDefinitions();
    const nonTableCreatingIds = new Set([
      "0004_add_checksum_and_timing_to_schema_migrations",
      "0007_seed_pctec_ingressa_application"
    ]);
    const tableCreatingMigrations = migrations.filter((m) => !nonTableCreatingIds.has(m.id));

    for (const migration of tableCreatingMigrations) {
      expect(migration.up.toUpperCase()).toContain("CREATE TABLE");
      expect(migration.down.toUpperCase()).toContain("DROP TABLE");
    }

    const correctiveMigration = migrations.find((m) => m.id === "0004_add_checksum_and_timing_to_schema_migrations");
    expect(correctiveMigration?.up.toUpperCase()).toContain("ALTER TABLE");
    expect(correctiveMigration?.down.toUpperCase()).toContain("ALTER TABLE");

    const seedMigration = migrations.find((m) => m.id === "0007_seed_pctec_ingressa_application");
    expect(seedMigration?.up.toUpperCase()).toContain("INSERT INTO APPLICATIONS");
    expect(seedMigration?.down.toUpperCase()).toContain("DELETE FROM APPLICATIONS");
  });

  it("a migration de identities usa id BIGINT interno + public_id CHAR(36), nunca BINARY(16)", () => {
    const migrations = loadMigrationDefinitions();
    const identitiesMigration = migrations.find((m) => m.id === "0002_create_identities");

    expect(identitiesMigration).toBeDefined();
    expect(identitiesMigration?.up).toContain("public_id");
    expect(identitiesMigration?.up).toContain("CHAR(36)");
    expect(identitiesMigration?.up).not.toContain("BINARY(16)");
  });

  it("applications e application_accesses seguem a mesma convenção id BIGINT interno + public_id CHAR(36) (ADR-021), nunca BINARY(16)", () => {
    const migrations = loadMigrationDefinitions();
    const applicationsMigration = migrations.find((m) => m.id === "0005_create_applications");
    const accessesMigration = migrations.find((m) => m.id === "0006_create_application_accesses");

    expect(applicationsMigration).toBeDefined();
    expect(applicationsMigration?.up).toContain("public_id");
    expect(applicationsMigration?.up).toContain("CHAR(36)");
    expect(applicationsMigration?.up).not.toContain("BINARY(16)");

    expect(accessesMigration).toBeDefined();
    expect(accessesMigration?.up).toContain("public_id");
    expect(accessesMigration?.up).toContain("CHAR(36)");
    expect(accessesMigration?.up).not.toContain("BINARY(16)");
    expect(accessesMigration?.up).toContain("FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)");
    expect(accessesMigration?.up).toContain("FOREIGN KEY (application_public_id) REFERENCES applications (public_id)");
  });

  it("application_accesses: todas as 4 FKs têm ON DELETE RESTRICT ON UPDATE RESTRICT explícito (nunca CASCADE/SET NULL)", () => {
    const migrations = loadMigrationDefinitions();
    const accessesMigration = migrations.find((m) => m.id === "0006_create_application_accesses");
    const sql = accessesMigration?.up ?? "";

    const restrictCount = (sql.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length;
    expect(restrictCount).toBe(4); // 4 FKs: identity, application, granted_by, revoked_by
    expect(sql.toUpperCase()).not.toContain("CASCADE");
    expect(sql.toUpperCase()).not.toContain("SET NULL");
  });

  it("application_accesses: índices explícitos existem para as 4 colunas de FK (nenhuma depende de índice implícito do InnoDB)", () => {
    const migrations = loadMigrationDefinitions();
    const accessesMigration = migrations.find((m) => m.id === "0006_create_application_accesses");
    const sql = accessesMigration?.up ?? "";

    // identity_public_id e application_public_id: cobertos como prefixo
    // esquerdo pelos índices compostos já existentes.
    expect(sql).toContain("idx_app_access_identity_app_profile_status (identity_public_id");
    expect(sql).toContain("idx_app_access_app_profile_status (application_public_id");
    // granted_by/revoked_by: índices próprios e explícitos (adicionados
    // nesta revisão — antes dependiam do índice implícito que o InnoDB
    // cria automaticamente para colunas de FK sem índice compatível).
    expect(sql).toContain("KEY idx_app_access_granted_by (granted_by_identity_public_id)");
    expect(sql).toContain("KEY idx_app_access_revoked_by (revoked_by_identity_public_id)");
  });

  it("as migrations que criam tabela usam utf8mb4_unicode_520_ci, nunca utf8mb4_general_ci como padrão", () => {
    const migrations = loadMigrationDefinitions();
    const tableCreatingMigrations = migrations.filter((m) => m.id !== "0007_seed_pctec_ingressa_application");

    for (const migration of tableCreatingMigrations) {
      expect(migration.up).toContain("utf8mb4_unicode_520_ci");
      expect(migration.up).not.toContain("utf8mb4_general_ci");
    }
  });

  it("nenhuma migration contém DELETE físico operacional sobre identities (dado pessoal) — exceção documentada: reversão do seed técnico de applications", () => {
    const migrations = loadMigrationDefinitions();
    const seedMigrationId = "0007_seed_pctec_ingressa_application";

    for (const migration of migrations) {
      // DELETE FROM nunca é aceitável sobre `identities` (dado pessoal —
      // ver ADR-020, exclusão lógica) nem sobre `application_accesses`
      // (histórico de auditoria de acesso) em nenhuma migration, up ou
      // down.
      expect(migration.up.toUpperCase()).not.toMatch(/DELETE FROM\s+IDENTITIES/);
      expect(migration.down.toUpperCase()).not.toMatch(/DELETE FROM\s+IDENTITIES/);
      expect(migration.up.toUpperCase()).not.toMatch(/DELETE FROM\s+APPLICATION_ACCESSES/);
      expect(migration.down.toUpperCase()).not.toMatch(/DELETE FROM\s+APPLICATION_ACCESSES/);

      if (migration.id !== seedMigrationId) {
        // Fora da migration de seed, nenhum DELETE FROM em lugar nenhum
        // — nem mesmo em `applications`.
        expect(migration.up.toUpperCase()).not.toContain("DELETE FROM");
        expect(migration.down.toUpperCase()).not.toContain("DELETE FROM");
      }
    }

    // A única exceção explícita e documentada: o down da migration de
    // seed reverte exclusivamente a própria linha semeada, por
    // public_id — nunca um DELETE genérico por code isolado.
    const seedMigration = migrations.find((m) => m.id === seedMigrationId);
    expect(seedMigration?.down.toUpperCase()).toContain("DELETE FROM APPLICATIONS WHERE PUBLIC_ID =");
  });

  it("0007 (seed): o down.sql remove SOMENTE a linha pelo public_id fixo — nunca um DELETE genérico por code", () => {
    const migrations = loadMigrationDefinitions();
    const seedMigration = migrations.find((m) => m.id === "0007_seed_pctec_ingressa_application");

    expect(seedMigration).toBeDefined();
    // O DELETE filtra por public_id (identidade lógica única e imutável
    // — UNIQUE KEY), nunca por code isolado. Isso garante que uma
    // Application "PCTEC_INGRESSA" recriada posteriormente com outro
    // public_id NUNCA seria apagada por este rollback.
    expect(seedMigration?.down).toMatch(/DELETE FROM applications WHERE public_id = '[0-9a-f-]{36}'/);
    expect(seedMigration?.down.toUpperCase()).not.toMatch(/WHERE\s+CODE\s*=/);

    // O UUID usado no DELETE é exatamente o mesmo inserido no up.sql —
    // rollback e seed sempre visam a mesma linha logicamente.
    const upUuidMatch = seedMigration?.up.match(/VALUES \('([0-9a-f-]{36})'/);
    const downUuidMatch = seedMigration?.down.match(/public_id = '([0-9a-f-]{36})'/);
    expect(upUuidMatch?.[1]).toBeDefined();
    expect(downUuidMatch?.[1]).toBe(upUuidMatch?.[1]);
  });

  it("0007 (seed): 1-4. NÃO usa INSERT IGNORE, REPLACE INTO ou ON DUPLICATE KEY UPDATE — usa INSERT normal", () => {
    const migrations = loadMigrationDefinitions();
    const seedMigration = migrations.find((m) => m.id === "0007_seed_pctec_ingressa_application");
    const upUpper = seedMigration?.up.toUpperCase() ?? "";

    // 1, 2, 3: nenhum mecanismo que mascare divergência de estado.
    expect(upUpper).not.toContain("INSERT IGNORE");
    expect(upUpper).not.toContain("REPLACE INTO");
    expect(upUpper).not.toContain("ON DUPLICATE KEY UPDATE");

    // 4: INSERT normal presente — qualquer conflito com UNIQUE KEY
    // (uk_applications_code / uk_applications_public_id) deve FALHAR
    // explicitamente, não ser ignorado. Idempotência é responsabilidade
    // do MigrationRunner/schema_migrations (uma migration já registrada
    // nunca é reexecutada — ver MigrationRunner.applyPending), não deste
    // SQL.
    expect(upUpper).toContain("INSERT INTO APPLICATIONS");
    expect(/INSERT\s+INTO\s+applications/i.test(seedMigration?.up ?? "")).toBe(true);
  });

  it("0007 (seed): 5-6. code = PCTEC_INGRESSA e publicId determinístico esperado", () => {
    const migrations = loadMigrationDefinitions();
    const seedMigration = migrations.find((m) => m.id === "0007_seed_pctec_ingressa_application");

    expect(seedMigration?.up).toContain("'PCTEC_INGRESSA'");
    expect(seedMigration?.up).toContain("'PCTEC Ingressa'");
    expect(seedMigration?.up).toContain("'ACTIVE'");
    expect(seedMigration?.up).toContain("'0b13f6f0-8f3a-4a1e-9c2d-000000000001'");
  });

  it("audit_events não possui FOREIGN KEY nem CASCADE (decisão deliberada, evita acoplamento)", () => {
    const migrations = loadMigrationDefinitions();
    const auditMigration = migrations.find((m) => m.id === "0003_create_audit_events");

    expect(auditMigration).toBeDefined();
    expect(auditMigration?.up.toUpperCase()).not.toContain("FOREIGN KEY");
    expect(auditMigration?.up.toUpperCase()).not.toContain("CASCADE");
  });

  it("o diretório de migrations usa apenas o caminho padrão local — não aceita entrada externa em produção", () => {
    // Chamar sem argumentos (como todo código de produção faz) sempre
    // resolve para o diretório físico ao lado deste módulo — nunca a
    // partir de process.argv, process.env ou qualquer entrada de rede.
    const migrations = loadMigrationDefinitions();
    expect(migrations.length).toBeGreaterThan(0);
    // Todo `id` de migration é derivado apenas do nome de arquivo lido do
    // disco local — nunca construído a partir de uma string fornecida
    // por um chamador externo.
    for (const migration of migrations) {
      expect(migration.id).toMatch(/^\d{4}_[a-z_]+$/);
    }
  });
});
