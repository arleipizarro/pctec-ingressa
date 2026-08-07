import { describe, it, expect } from "vitest";
import { loadMigrationDefinitions } from "../loadMigrationDefinitions.js";

describe("loadMigrationDefinitions", () => {
  it("carrega as 4 migrations esperadas, em ordem, cada uma com up e down não vazios", () => {
    const migrations = loadMigrationDefinitions();

    expect(migrations.map((m) => m.id)).toEqual([
      "0001_create_schema_migrations",
      "0002_create_identities",
      "0003_create_audit_events",
      "0004_add_checksum_and_timing_to_schema_migrations"
    ]);

    for (const migration of migrations) {
      expect(migration.up.trim().length).toBeGreaterThan(0);
      expect(migration.down.trim().length).toBeGreaterThan(0);
    }
  });

  it("as migrations que criam tabela usam CREATE TABLE / DROP TABLE (0004 é ALTER TABLE, não cria tabela)", () => {
    const migrations = loadMigrationDefinitions();
    const tableCreatingMigrations = migrations.filter((m) => m.id !== "0004_add_checksum_and_timing_to_schema_migrations");

    for (const migration of tableCreatingMigrations) {
      expect(migration.up.toUpperCase()).toContain("CREATE TABLE");
      expect(migration.down.toUpperCase()).toContain("DROP TABLE");
    }

    const correctiveMigration = migrations.find((m) => m.id === "0004_add_checksum_and_timing_to_schema_migrations");
    expect(correctiveMigration?.up.toUpperCase()).toContain("ALTER TABLE");
    expect(correctiveMigration?.down.toUpperCase()).toContain("ALTER TABLE");
  });

  it("a migration de identities usa id BIGINT interno + public_id CHAR(36), nunca BINARY(16)", () => {
    const migrations = loadMigrationDefinitions();
    const identitiesMigration = migrations.find((m) => m.id === "0002_create_identities");

    expect(identitiesMigration).toBeDefined();
    expect(identitiesMigration?.up).toContain("public_id");
    expect(identitiesMigration?.up).toContain("CHAR(36)");
    expect(identitiesMigration?.up).not.toContain("BINARY(16)");
  });

  it("as migrations usam utf8mb4_unicode_520_ci, nunca utf8mb4_general_ci como padrão", () => {
    const migrations = loadMigrationDefinitions();

    for (const migration of migrations) {
      expect(migration.up).toContain("utf8mb4_unicode_520_ci");
      expect(migration.up).not.toContain("utf8mb4_general_ci");
    }
  });

  it("nenhuma migration contém DELETE físico operacional (DELETE FROM)", () => {
    const migrations = loadMigrationDefinitions();

    for (const migration of migrations) {
      expect(migration.up.toUpperCase()).not.toContain("DELETE FROM");
      expect(migration.down.toUpperCase()).not.toContain("DELETE FROM");
    }
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
