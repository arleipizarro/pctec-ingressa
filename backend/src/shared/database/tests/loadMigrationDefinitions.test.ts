import { describe, it, expect } from "vitest";
import { loadMigrationDefinitions } from "../loadMigrationDefinitions.js";

describe("loadMigrationDefinitions", () => {
  it("carrega as 24 migrations esperadas, em ordem, cada uma com up e down não vazios", () => {
    const migrations = loadMigrationDefinitions();

    expect(migrations.map((m) => m.id)).toEqual([
      "0001_create_schema_migrations",
      "0002_create_identities",
      "0003_create_audit_events",
      "0004_add_checksum_and_timing_to_schema_migrations",
      "0005_create_applications",
      "0006_create_application_accesses",
      "0007_seed_pctec_ingressa_application",
      "0008_create_credentials",
      "0009_create_sessions",
      "0010_create_organizations",
      "0011_create_organization_relationships",
      "0012_create_memberships",
      "0013_create_organization_external_references",
      "0014_seed_pctec_portal_application",
      "0015_add_user_access_profile",
      "0016_create_identity_external_references",
      "0017_add_application_access_active_grant_unique",
      "0018_seed_pctec_helpdesk_application",
      "0019_add_match_method_created_from_source",
      "0020_create_import_batches",
      "0021_create_import_batch_items",
      "0022_create_sso_authorization_codes",
      "0023_create_identity_invitations",
      "0024_add_identity_external_reference_active_binding_unique"
    ]);

    for (const migration of migrations) {
      expect(migration.up.trim().length).toBeGreaterThan(0);
      expect(migration.down.trim().length).toBeGreaterThan(0);
    }
  });

  it("as migrations que criam tabela usam CREATE TABLE / DROP TABLE (0004/0015/0017/0019/0024 são ALTER TABLE, 0007/0014/0018 são seed INSERT/DELETE, 0016/0020/0021/0022/0023 criam tabela)", () => {
    const migrations = loadMigrationDefinitions();
    const nonTableCreatingIds = new Set([
      "0004_add_checksum_and_timing_to_schema_migrations",
      "0007_seed_pctec_ingressa_application",
      "0014_seed_pctec_portal_application",
      "0015_add_user_access_profile",
      "0017_add_application_access_active_grant_unique",
      "0018_seed_pctec_helpdesk_application",
      "0019_add_match_method_created_from_source",
      "0024_add_identity_external_reference_active_binding_unique"
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

    const portalSeedMigration = migrations.find((m) => m.id === "0014_seed_pctec_portal_application");
    expect(portalSeedMigration?.up.toUpperCase()).toContain("INSERT INTO APPLICATIONS");
    expect(portalSeedMigration?.down.toUpperCase()).toContain("DELETE FROM APPLICATIONS");

    const accessProfileMigration = migrations.find((m) => m.id === "0015_add_user_access_profile");
    expect(accessProfileMigration?.up.toUpperCase()).toContain("ALTER TABLE");
    expect(accessProfileMigration?.up).toContain("ENUM('ADMIN','USER')");
    expect(accessProfileMigration?.down.toUpperCase()).toContain("ALTER TABLE");
    expect(accessProfileMigration?.down).toContain("ENUM('ADMIN')");
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

  it("credentials (0008) segue a mesma convenção id BIGINT interno + public_id CHAR(36) (ADR-021), UNIQUE(identity_public_id, type), FK RESTRICT/RESTRICT", () => {
    const migrations = loadMigrationDefinitions();
    const credentialsMigration = migrations.find((m) => m.id === "0008_create_credentials");

    expect(credentialsMigration).toBeDefined();
    expect(credentialsMigration?.up).toContain("public_id");
    expect(credentialsMigration?.up).toContain("CHAR(36)");
    expect(credentialsMigration?.up).not.toContain("BINARY(16)");
    expect(credentialsMigration?.up).toContain("UNIQUE KEY uk_credentials_identity_type (identity_public_id, type)");
    expect(credentialsMigration?.up).toContain("ENUM('LOCAL_PASSWORD')");
    expect(credentialsMigration?.up).toContain("ENUM('ACTIVE','REVOKED')");
    expect(credentialsMigration?.up).toContain("FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)");
    expect(credentialsMigration?.up).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
    // status fechado — nenhum valor além de ACTIVE/REVOKED (ADR-029, "Status de Credential").
    expect(credentialsMigration?.up.toUpperCase()).not.toContain("'PENDING'");
    expect(credentialsMigration?.up.toUpperCase()).not.toContain("'LOCKED'");
    expect(credentialsMigration?.up.toUpperCase()).not.toContain("'DISABLED'");
  });

  it("sessions (0009) segue a mesma convenção id BIGINT interno + public_id CHAR(36) (ADR-021), UNIQUE(token_hash), FK RESTRICT/RESTRICT, status fechado ACTIVE/REVOKED", () => {
    const migrations = loadMigrationDefinitions();
    const sessionsMigration = migrations.find((m) => m.id === "0009_create_sessions");

    expect(sessionsMigration).toBeDefined();
    expect(sessionsMigration?.up).toContain("public_id");
    expect(sessionsMigration?.up).toContain("CHAR(36)");
    expect(sessionsMigration?.up).not.toContain("BINARY(16)");
    expect(sessionsMigration?.up).toContain("UNIQUE KEY uk_sessions_public_id (public_id)");
    expect(sessionsMigration?.up).toContain("UNIQUE KEY uk_sessions_token_hash (token_hash)");
    expect(sessionsMigration?.up).toContain("ENUM('ACTIVE','REVOKED')");
    expect(sessionsMigration?.up).toContain("FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)");
    expect(sessionsMigration?.up).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
    // EXPIRED é estado derivado, nunca persistido (ADR-030).
    expect(sessionsMigration?.up.toUpperCase()).not.toContain("'EXPIRED'");
    // token bruto nunca é uma coluna — só o hash.
    expect(sessionsMigration?.up).not.toContain("raw_token");
    expect(sessionsMigration?.up).not.toContain("token VARCHAR");
  });

  it("credentials (0008) [revisão crítica, item 6]: UNIQUE(public_id), password_hash VARCHAR(255), charset/collation compatíveis, down específico só de DROP TABLE credentials", () => {
    const migrations = loadMigrationDefinitions();
    const credentialsMigration = migrations.find((m) => m.id === "0008_create_credentials");

    expect(credentialsMigration).toBeDefined();

    // UNIQUE(public_id) — distinto de UNIQUE(identity_public_id, type),
    // já coberto no teste acima.
    expect(credentialsMigration?.up).toContain("UNIQUE KEY uk_credentials_public_id (public_id)");

    // password_hash com tamanho suficiente para o PHC completo do
    // Argon2id (medido em Argon2PasswordHasher.test.ts: ~97 caracteres
    // com os parâmetros atuais — VARCHAR(255) dá folga generosa).
    expect(credentialsMigration?.up).toContain("password_hash          VARCHAR(255)  NOT NULL");

    // Charset/collation idênticos aos de `identities` (mesma tabela
    // referenciada pela FK) — evita qualquer problema de comparação de
    // string entre collations diferentes na junção da FK.
    expect(credentialsMigration?.up).toContain("DEFAULT CHARSET = utf8mb4");
    expect(credentialsMigration?.up).toContain("COLLATE = utf8mb4_unicode_520_ci");

    // down específico: SOMENTE um DROP TABLE de `credentials`, nenhuma
    // outra tabela tocada.
    const downTrimmed = credentialsMigration?.down.trim() ?? "";
    expect(downTrimmed).toContain("DROP TABLE IF EXISTS credentials;");
    // Nenhuma outra tabela mencionada no down (ex.: não deveria
    // acidentalmente tocar identities/applications/application_accesses).
    expect(downTrimmed.toUpperCase()).not.toContain("IDENTITIES");
    expect(downTrimmed.toUpperCase()).not.toContain("APPLICATIONS");
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

  it("organizations (0010) [G1]: segue a convenção id BIGINT interno + public_id CHAR(36) (ADR-021), type ENUM fechado, document_number nullable e unique(document_number, type)", () => {
    const migrations = loadMigrationDefinitions();
    const organizationsMigration = migrations.find((m) => m.id === "0010_create_organizations");

    expect(organizationsMigration).toBeDefined();
    expect(organizationsMigration?.up).toContain("public_id");
    expect(organizationsMigration?.up).toContain("CHAR(36)");
    // BINARY(16) só deve aparecer em comentário (explicando a
    // divergência da convenção v0.2.0), nunca como tipo de coluna real
    // no SQL executável — checagem restrita ao SQL sem comentários.
    const organizationsSqlWithoutComments = (organizationsMigration?.up ?? "").replace(/--[^\n]*/g, "");
    expect(organizationsSqlWithoutComments).not.toContain("BINARY(16)");
    expect(organizationsSqlWithoutComments).not.toContain("internal_id");
    expect(organizationsMigration?.up).toContain("ENUM('BUSINESS_GROUP','COMPANY')");
    expect(organizationsMigration?.up).toContain("ENUM('ACTIVE','INACTIVE')");
    // document_number é NULLABLE — nenhum NOT NULL nessa coluna (G1:
    // opcional para AMBOS os tipos, ADR-031 §2).
    expect(organizationsMigration?.up).toMatch(/document_number\s+VARCHAR\(20\)\s+NULL/);
    expect(organizationsMigration?.up).toContain(
      "UNIQUE KEY uk_organizations_document_type (document_number, type)"
    );
    expect(organizationsMigration?.up).toContain("UNIQUE KEY uk_organizations_public_id (public_id)");
    expect(organizationsMigration?.up).toContain("utf8mb4_unicode_520_ci");

    const downTrimmed = organizationsMigration?.down.trim() ?? "";
    expect(downTrimmed).toContain("DROP TABLE IF EXISTS organizations;");
    expect(downTrimmed.toUpperCase()).not.toContain("ORGANIZATION_RELATIONSHIPS");
  });

  it("organization_relationships (0011) [G1]: FKs referenciam organizations.public_id (não internal_id), RESTRICT/RESTRICT, uk_org_rel_child garante no máximo 1 grupo por empresa", () => {
    const migrations = loadMigrationDefinitions();
    const relationshipsMigration = migrations.find((m) => m.id === "0011_create_organization_relationships");

    expect(relationshipsMigration).toBeDefined();
    expect(relationshipsMigration?.up).toContain("public_id");
    expect(relationshipsMigration?.up).toContain("CHAR(36)");
    expect(relationshipsMigration?.up).not.toContain("BINARY(16)");
    expect(relationshipsMigration?.up).toContain(
      "FOREIGN KEY (parent_organization_public_id) REFERENCES organizations (public_id)"
    );
    expect(relationshipsMigration?.up).toContain(
      "FOREIGN KEY (child_organization_public_id) REFERENCES organizations (public_id)"
    );
    const restrictCount = (relationshipsMigration?.up.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length;
    expect(restrictCount).toBe(2);
    expect(relationshipsMigration?.up.toUpperCase()).not.toContain("CASCADE");
    expect(relationshipsMigration?.up.toUpperCase()).not.toContain("SET NULL");
    // uk_org_rel_child: no MVP, uma COMPANY pertence a no máximo um
    // BUSINESS_GROUP.
    expect(relationshipsMigration?.up).toContain("UNIQUE KEY uk_org_rel_child (child_organization_public_id)");
    expect(relationshipsMigration?.up).toContain("UNIQUE KEY uk_org_rel_public_id (public_id)");
    // Sem status/updated_at nesta fatia — G1 só implementa criação (ver
    // comentário da migration e OrganizationRelationship.ts). Checagem
    // restrita ao SQL executável, sem comentários (que mencionam essas
    // palavras ao EXPLICAR a ausência delas).
    const relationshipsSqlWithoutComments = (relationshipsMigration?.up ?? "").replace(/--[^\n]*/g, "");
    expect(relationshipsSqlWithoutComments.toUpperCase()).not.toContain(" STATUS ");
    expect(relationshipsSqlWithoutComments).not.toContain("updated_at");

    const downTrimmed = relationshipsMigration?.down.trim() ?? "";
    expect(downTrimmed).toContain("DROP TABLE IF EXISTS organization_relationships;");
    expect(downTrimmed.toUpperCase()).not.toContain(" ORGANIZATIONS;");
  });

  it("memberships (0012) [G2]: FKs por public_id, profile/scope ENUM fechados com os valores reconfirmados, uk_membership_unique, sem status/started_at/ended_at fora de contexto", () => {
    const migrations = loadMigrationDefinitions();
    const membershipsMigration = migrations.find((m) => m.id === "0012_create_memberships");

    expect(membershipsMigration).toBeDefined();
    expect(membershipsMigration?.up).toContain("public_id");
    expect(membershipsMigration?.up).toContain("CHAR(36)");
    const membershipsSqlWithoutComments = (membershipsMigration?.up ?? "").replace(/--[^\n]*/g, "");
    expect(membershipsSqlWithoutComments).not.toContain("BINARY(16)");
    expect(membershipsSqlWithoutComments).not.toContain("internal_id");
    expect(membershipsMigration?.up).toContain(
      "ENUM('EMPLOYEE','CUSTOMER','PARTNER','SUPPLIER','SERVICE_ACCOUNT')"
    );
    expect(membershipsMigration?.up).toContain("ENUM('ORGANIZATION_ONLY','ORGANIZATION_AND_DESCENDANTS')");
    expect(membershipsMigration?.up).toContain("ENUM('ACTIVE','INACTIVE')");
    expect(membershipsMigration?.up).toContain(
      "FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)"
    );
    expect(membershipsMigration?.up).toContain(
      "FOREIGN KEY (organization_public_id) REFERENCES organizations (public_id)"
    );
    const restrictCount = (membershipsMigration?.up.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length;
    expect(restrictCount).toBe(2);
    expect(membershipsMigration?.up.toUpperCase()).not.toContain("CASCADE");
    expect(membershipsMigration?.up).toContain(
      "UNIQUE KEY uk_membership_unique (identity_public_id, organization_public_id, profile)"
    );
    expect(membershipsMigration?.up).toContain("UNIQUE KEY uk_memberships_public_id (public_id)");
    expect(membershipsMigration?.up).toContain("started_at");
    expect(membershipsMigration?.up).toContain("ended_at");

    const downTrimmed = membershipsMigration?.down.trim() ?? "";
    expect(downTrimmed).toContain("DROP TABLE IF EXISTS memberships;");
  });

  it("organization_external_references (0013) [G2]: system_code ENUM fechado (3 sistemas), entity_type VARCHAR aberto, legacy_id BIGINT, active_match_key + uk_org_ext_ref_active_match (unicidade condicional sob concorrência real), FK RESTRICT/RESTRICT", () => {
    const migrations = loadMigrationDefinitions();
    const referencesMigration = migrations.find((m) => m.id === "0013_create_organization_external_references");

    expect(referencesMigration).toBeDefined();
    expect(referencesMigration?.up).toContain("public_id");
    expect(referencesMigration?.up).toContain("CHAR(36)");
    expect(referencesMigration?.up).toContain("ENUM('PCTEC_HUB','PCTEC_HELPDESK','PCTEC_PORTAL')");
    // Nenhum sistema fictício.
    expect(referencesMigration?.up).not.toContain("PCTEC_INGRESSA'");
    expect(referencesMigration?.up).toContain("entity_type");
    expect(referencesMigration?.up).toContain("VARCHAR(64)");
    expect(referencesMigration?.up).toContain("legacy_id");
    expect(referencesMigration?.up).toContain("BIGINT");
    expect(referencesMigration?.up).toContain("ENUM('ACTIVE','SUPERSEDED')");
    // Coluna gerada (VIRTUAL) que colapsa para NULL quando não-ACTIVE —
    // base da unicidade condicional sob concorrência real (ver migration
    // 0013 para o raciocínio completo comparando as alternativas).
    expect(referencesMigration?.up).toContain("active_match_key");
    expect(referencesMigration?.up).toContain("GENERATED ALWAYS AS");
    expect(referencesMigration?.up).toContain("VIRTUAL");
    expect(referencesMigration?.up).toContain(
      "CASE WHEN status = 'ACTIVE' THEN CONCAT(system_code, ':', entity_type, ':', legacy_id) ELSE NULL END"
    );
    // A UNIQUE real está sobre a coluna gerada, não diretamente sobre as
    // 3 colunas — isso é o que permite múltiplas linhas SUPERSEDED
    // coexistirem (todas com active_match_key=NULL) enquanto garante, no
    // banco, no máximo 1 ACTIVE por chave lógica.
    expect(referencesMigration?.up).toContain("UNIQUE KEY uk_org_ext_ref_active_match (active_match_key)");
    expect(referencesMigration?.up).not.toContain(
      "UNIQUE KEY uk_org_ext_ref_system_entity_legacy (system_code, entity_type, legacy_id)"
    );
    // Índice comum (não único) para consultas por todas as linhas,
    // incluindo histórico SUPERSEDED.
    expect(referencesMigration?.up).toContain(
      "KEY idx_org_ext_ref_system_entity_legacy (system_code, entity_type, legacy_id)"
    );
    expect(referencesMigration?.up).toContain("UNIQUE KEY uk_org_ext_ref_public_id (public_id)");
    expect(referencesMigration?.up).toContain(
      "FOREIGN KEY (organization_public_id) REFERENCES organizations (public_id)"
    );
    const restrictCount = (referencesMigration?.up.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length;
    expect(restrictCount).toBe(1);
    // Sem version nesta fatia (G2 não implementa update/SUPERSEDED
    // ainda) — checagem restrita ao SQL sem comentários.
    const referencesSqlWithoutComments = (referencesMigration?.up ?? "").replace(/--[^\n]*/g, "");
    expect(referencesSqlWithoutComments).not.toContain("version");

    const downTrimmed = referencesMigration?.down.trim() ?? "";
    expect(downTrimmed).toContain("DROP TABLE IF EXISTS organization_external_references;");
  });

  it("0024 [fundação Meu RH]: UNIQUE KEY de binding por (identity, system, entity) com flag gerada, e down que só remove índice e coluna", () => {
    const migrations = loadMigrationDefinitions();
    const bindingMigration = migrations.find(
      (m) => m.id === "0024_add_identity_external_reference_active_binding_unique"
    );

    expect(bindingMigration).toBeDefined();
    const up = bindingMigration?.up ?? "";

    // ALTER na tabela existente — nunca recria nem toca linhas.
    expect(up.toUpperCase()).toContain("ALTER TABLE IDENTITY_EXTERNAL_REFERENCES");

    // Flag NUMÉRICA gerada a partir do status, mesma técnica de 0017 —
    // e NUNCA CONCAT sobre identity_public_id, que é CHAR(36) e faria o
    // MariaDB recusar o índice (ERROR 1901).
    expect(up).toContain("active_binding_flag TINYINT UNSIGNED GENERATED ALWAYS AS (");
    expect(up).toContain("CASE WHEN status = 'ACTIVE' THEN 1 ELSE NULL END");
    const upSemComentarios = up.replace(/--[^\n]*/g, "");
    expect(upSemComentarios).not.toContain("CONCAT");

    // A chave é a invariante conceitual inteira, na ordem que também a
    // torna útil como índice de busca por identidade.
    expect(up).toContain(
      "UNIQUE KEY uk_id_ext_ref_active_binding (identity_public_id, system_code, entity_type, active_binding_flag)"
    );

    // Genérica: nenhum system_code específico participa da chave.
    expect(upSemComentarios).not.toContain("PCTEC_HUB");
    expect(upSemComentarios).not.toContain("rh_colaboradores");

    // Não mexe na invariante simétrica já existente (0016): a chave
    // `uk_id_ext_ref_active_match` só aparece citada no COMMENT, nunca
    // como alvo de DROP/ALTER.
    expect(up).not.toContain("DROP INDEX uk_id_ext_ref_active_match");
    expect(up).not.toContain("DROP COLUMN active_match_key");

    // Down: reversível e sem perda — só índice e coluna derivada.
    const down = bindingMigration?.down ?? "";
    expect(down).toContain("DROP INDEX uk_id_ext_ref_active_binding");
    expect(down).toContain("DROP COLUMN active_binding_flag");
    const downSemComentarios = down.replace(/--[^\n]*/g, "");
    expect(downSemComentarios).not.toContain("DELETE");
    expect(downSemComentarios).not.toContain("DROP TABLE");
  });

  it("0016 continua intacta — a 0024 é aditiva, nunca uma alteração de migration já aplicada", () => {
    const migrations = loadMigrationDefinitions();
    const original = migrations.find((m) => m.id === "0016_create_identity_external_references");

    expect(original?.up).toContain("UNIQUE KEY uk_id_ext_ref_active_match (active_match_key)");
    expect(original?.up).not.toContain("active_binding_flag");
  });

  it("seed_pctec_portal_application (0014) [G3]: INSERT determinístico, public_id distinto de PCTEC_INGRESSA, down remove só por public_id", () => {
    const migrations = loadMigrationDefinitions();
    const portalSeedMigration = migrations.find((m) => m.id === "0014_seed_pctec_portal_application");

    expect(portalSeedMigration).toBeDefined();
    expect(portalSeedMigration?.up).toContain("'3f9c1a2e-7d4b-4e5a-9c3f-000000000001'");
    expect(portalSeedMigration?.up).toContain("'PCTEC_PORTAL'");
    expect(portalSeedMigration?.up).toContain("'ACTIVE'");
    // public_id distinto do de PCTEC_INGRESSA (0007).
    expect(portalSeedMigration?.up).not.toContain("0b13f6f0-8f3a-4a1e-9c2d-000000000001");

    const downTrimmed = portalSeedMigration?.down.trim() ?? "";
    expect(downTrimmed).toContain("DELETE FROM applications WHERE public_id = '3f9c1a2e-7d4b-4e5a-9c3f-000000000001';");
    // Nunca um DELETE genérico por code isolado.
    expect(downTrimmed.toUpperCase()).not.toContain("WHERE CODE");
  });

  it("add_user_access_profile (0015) [G3]: ALTER TABLE application_accesses, ENUM('ADMIN','USER') no up, ENUM('ADMIN') no down, não toca 0006", () => {
    const migrations = loadMigrationDefinitions();
    const accessProfileMigration = migrations.find((m) => m.id === "0015_add_user_access_profile");
    const originalAccessesMigration = migrations.find((m) => m.id === "0006_create_application_accesses");

    expect(accessProfileMigration).toBeDefined();
    expect(accessProfileMigration?.up).toContain("ALTER TABLE application_accesses");
    expect(accessProfileMigration?.up).toContain("MODIFY COLUMN access_profile ENUM('ADMIN','USER') NOT NULL");
    expect(accessProfileMigration?.down).toContain("ALTER TABLE application_accesses");
    expect(accessProfileMigration?.down).toContain("MODIFY COLUMN access_profile ENUM('ADMIN') NOT NULL");
    // 0006 original permanece com ENUM('ADMIN') — nunca editada
    // retroativamente (mesmo princípio já verificado para 0001-0013).
    expect(originalAccessesMigration?.up).toContain("ENUM('ADMIN')  NOT NULL");
  });

  it("as migrations que criam tabela usam utf8mb4_unicode_520_ci, nunca utf8mb4_general_ci como padrão", () => {
    const migrations = loadMigrationDefinitions();
    const tableCreatingMigrations = migrations.filter((m) => m.id !== "0007_seed_pctec_ingressa_application");

    for (const migration of tableCreatingMigrations) {
      expect(migration.up).toContain("utf8mb4_unicode_520_ci");
      expect(migration.up).not.toContain("utf8mb4_general_ci");
    }
  });

  it("nenhuma migration contém DELETE físico operacional sobre identities (dado pessoal) — exceção documentada: reversão dos seeds técnicos de applications", () => {
    const migrations = loadMigrationDefinitions();
    const seedMigrationIds = new Set([
      "0007_seed_pctec_ingressa_application",
      "0014_seed_pctec_portal_application",
      // 0018 segue exatamente o mesmo padrão dos dois acima: seed de uma
      // Application técnica do catálogo, cujo down remove só aquela
      // linha, pelo public_id determinístico. A FK ON DELETE RESTRICT de
      // `application_accesses` impede a remoção se houver histórico.
      "0018_seed_pctec_helpdesk_application"
    ]);

    for (const migration of migrations) {
      // DELETE FROM nunca é aceitável sobre `identities` (dado pessoal —
      // ver ADR-020, exclusão lógica) nem sobre `application_accesses`
      // (histórico de auditoria de acesso) em nenhuma migration, up ou
      // down.
      expect(migration.up.toUpperCase()).not.toMatch(/DELETE FROM\s+IDENTITIES/);
      expect(migration.down.toUpperCase()).not.toMatch(/DELETE FROM\s+IDENTITIES/);
      expect(migration.up.toUpperCase()).not.toMatch(/DELETE FROM\s+APPLICATION_ACCESSES/);
      expect(migration.down.toUpperCase()).not.toMatch(/DELETE FROM\s+APPLICATION_ACCESSES/);

      if (!seedMigrationIds.has(migration.id)) {
        // Fora das migrations de seed, nenhum DELETE FROM em lugar
        // nenhum — nem mesmo em `applications`.
        expect(migration.up.toUpperCase()).not.toContain("DELETE FROM");
        expect(migration.down.toUpperCase()).not.toContain("DELETE FROM");
      }
    }

    // A única exceção explícita e documentada: o down de cada migration
    // de seed reverte exclusivamente a própria linha semeada, por
    // public_id — nunca um DELETE genérico por code isolado.
    for (const seedMigrationId of seedMigrationIds) {
      const seedMigration = migrations.find((m) => m.id === seedMigrationId);
      expect(seedMigration?.down.toUpperCase()).toContain("DELETE FROM APPLICATIONS WHERE PUBLIC_ID =");
    }
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

  // Lista EXATA das migrations de seed do catálogo de applications. Toda
  // seed nova entra aqui — o teste falha por ausência se alguém
  // acrescentar uma quarta e esquecer, porque a contagem é conferida
  // contra as migrations realmente carregadas logo abaixo.
  const SEEDS_DE_APPLICATION = [
    "0007_seed_pctec_ingressa_application",
    "0014_seed_pctec_portal_application",
    "0018_seed_pctec_helpdesk_application"
  ] as const;

  it("a lista de seeds de application acima é exata — nenhuma seed fora dela", () => {
    const migrations = loadMigrationDefinitions();
    const seedsReais = migrations
      .filter((m) => /INSERT\s+(IGNORE\s+)?INTO\s+applications/i.test(m.up))
      .map((m) => m.id)
      .sort();
    expect(seedsReais).toEqual([...SEEDS_DE_APPLICATION].sort());
  });

  it.each(SEEDS_DE_APPLICATION)(
    "%s (seed): 1-4. NÃO usa INSERT IGNORE, REPLACE INTO ou ON DUPLICATE KEY UPDATE — usa INSERT normal",
    (seedId) => {
      const migrations = loadMigrationDefinitions();
      const seedMigration = migrations.find((m) => m.id === seedId);
      expect(seedMigration).toBeDefined();

      // 1, 2, 3: nenhum mecanismo que mascare divergência de estado.
      // A checagem é sobre o SQL executável, não sobre a prosa: o
      // docblock de 0018 cita "INSERT IGNORE" justamente para explicar
      // por que NÃO o usa.
      const upExecutavel = (seedMigration?.up ?? "").replace(/--[^\n]*/g, "").toUpperCase();
      expect(upExecutavel).not.toContain("INSERT IGNORE");
      expect(upExecutavel).not.toContain("REPLACE INTO");
      expect(upExecutavel).not.toContain("ON DUPLICATE KEY UPDATE");

      // 4: INSERT normal presente — qualquer conflito com UNIQUE KEY
      // (uk_applications_code / uk_applications_public_id) deve FALHAR
      // explicitamente, não ser ignorado. Idempotência é responsabilidade
      // do MigrationRunner/schema_migrations (uma migration já registrada
      // nunca é reexecutada — ver MigrationRunner.applyPending), não deste
      // SQL.
      expect(upExecutavel).toContain("INSERT INTO APPLICATIONS");
      expect(/INSERT\s+INTO\s+applications/i.test(seedMigration?.up ?? "")).toBe(true);
    }
  );

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
