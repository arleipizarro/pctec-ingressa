import { describe, expect, it } from "vitest";
import { loadMigrationDefinitions } from "../loadMigrationDefinitions.js";
import { assertSingleStatement } from "../MigrationRunner.js";

const NOVAS = [
  "0017_add_application_access_active_grant_unique",
  "0018_seed_pctec_helpdesk_application",
  "0019_add_match_method_created_from_source",
  "0020_create_import_batches",
  "0021_create_import_batch_items"
];

const definicoes = loadMigrationDefinitions();
const porId = new Map(definicoes.map((d) => [d.id, d]));

describe("migrations da fundação do importador", () => {
  it.each(NOVAS)("%s tem par up/down carregado", (id) => {
    expect(porId.has(id)).toBe(true);
  });

  it.each(NOVAS)("%s tem exatamente uma instrução executável em cada direção", (id) => {
    const definicao = porId.get(id);
    expect(definicao).toBeDefined();
    expect(() => assertSingleStatement(id, "up", definicao?.up ?? "")).not.toThrow();
    expect(() => assertSingleStatement(id, "down", definicao?.down ?? "")).not.toThrow();
  });

  it("a ordenação coloca as novas depois de 0016", () => {
    const ids = definicoes.map((d) => d.id);
    const indice0016 = ids.indexOf("0016_create_identity_external_references");
    for (const id of NOVAS) {
      expect(ids.indexOf(id)).toBeGreaterThan(indice0016);
    }
    expect(ids).toEqual([...ids].sort());
  });
});

describe("0017 — unicidade de concessão ativa", () => {
  const m = porId.get("0017_add_application_access_active_grant_unique");

  it("cria coluna gerada VIRTUAL e índice único", () => {
    expect(m?.up).toContain("active_grant_flag");
    expect(m?.up).toContain("VIRTUAL");
    expect(m?.up).toContain("UNIQUE KEY uk_app_access_active_grant");
  });

  it("a chave é (identity, application) e NÃO inclui o perfil", () => {
    const chave = m?.up.match(/UNIQUE KEY uk_app_access_active_grant \(([^)]*)\)/)?.[1] ?? "";
    const colunas = chave.split(",").map((c) => c.trim());
    expect(colunas).toEqual(["identity_public_id", "application_public_id", "active_grant_flag"]);
    expect(chave).not.toContain("access_profile");
  });

  it("só GRANTED marca a flag — REVOKED fica NULL e permite histórico", () => {
    const geracao = m?.up.match(/GENERATED ALWAYS AS \(([\s\S]*?)\) VIRTUAL/)?.[1] ?? "";
    expect(geracao).toContain("status = 'GRANTED'");
    expect(geracao).toContain("ELSE NULL");
    expect(geracao).not.toContain("access_profile");
  });

  // Regressão da correção que trocou a chave-texto concatenada pela flag
  // numérica: o MariaDB 10.11 recusa (ERROR 1901) indexar coluna gerada
  // cuja expressão passe uma coluna CHAR por função de string — e
  // identity_public_id/application_public_id são CHAR(36). Verificado no
  // servidor real pelo driver da aplicação. Se alguém reintroduzir
  // CONCAT aqui, a migration volta a falhar no banco, não no teste — por
  // isso a proibição fica explícita.
  it("a expressão gerada não usa função de string sobre as colunas CHAR (ERROR 1901 do MariaDB)", () => {
    const geracao = m?.up.match(/GENERATED ALWAYS AS \(([\s\S]*?)\) VIRTUAL/)?.[1] ?? "";
    expect(geracao.toUpperCase()).not.toContain("CONCAT");
    expect(geracao).not.toContain("identity_public_id");
    expect(geracao).not.toContain("application_public_id");
  });

  it("o down remove índice e coluna, sem tocar em linhas", () => {
    expect(m?.down).toContain("DROP INDEX uk_app_access_active_grant");
    expect(m?.down).toContain("DROP COLUMN active_grant_flag");
    expect(m?.down).not.toMatch(/\bDELETE\b|\bUPDATE\b/i);
  });
});

describe("0018 — seed da Application PCTEC_HELPDESK", () => {
  const m = porId.get("0018_seed_pctec_helpdesk_application");

  it("insere PCTEC_HELPDESK ACTIVE com publicId determinístico", () => {
    expect(m?.up).toContain("'PCTEC_HELPDESK'");
    expect(m?.up).toContain("'PCTEC Helpdesk'");
    expect(m?.up).toContain("'ACTIVE'");
    expect(m?.up).toContain("5c7a2b91-1e6d-4f38-b7a4-000000000001");
  });

  // A idempotência é do MigrationRunner (uma migration registrada em
  // `schema_migrations` nunca é reexecutada), NUNCA do SQL. 0007 e 0014
  // documentam essa doutrina e 0018 segue as duas: divergência
  // pré-existente precisa falhar com ER_DUP_ENTRY, não virar no-op.
  it("é fail-closed — nenhuma cláusula que mascare divergência de estado", () => {
    const upExecutavel = (m?.up ?? "").replace(/--[^\n]*/g, "").toUpperCase();
    expect(upExecutavel).not.toContain("INSERT IGNORE");
    expect(upExecutavel).not.toContain("REPLACE INTO");
    expect(upExecutavel).not.toContain("ON DUPLICATE KEY UPDATE");
    expect(upExecutavel).toContain("INSERT INTO APPLICATIONS");
  });

  it("o down remove só esta linha, pelo publicId", () => {
    expect(m?.down).toContain("DELETE FROM applications WHERE public_id = '5c7a2b91-1e6d-4f38-b7a4-000000000001'");
  });
});

describe("0019 — CREATED_FROM_SOURCE", () => {
  const m = porId.get("0019_add_match_method_created_from_source");

  it("adiciona o valor mantendo os dois anteriores", () => {
    expect(m?.up).toContain("'MATCHED_BY_EMAIL','MATCHED_MANUAL_CONFIRMED','CREATED_FROM_SOURCE'");
  });

  it("o down volta aos dois valores originais", () => {
    expect(m?.down).toContain("ENUM('MATCHED_BY_EMAIL','MATCHED_MANUAL_CONFIRMED')");
  });
});

describe("0020/0021 — lotes", () => {
  const batches = porId.get("0020_create_import_batches");
  const items = porId.get("0021_create_import_batch_items");

  it("import_batches tem os dois fingerprints separados", () => {
    expect(batches?.up).toContain("snapshot_fingerprint");
    expect(batches?.up).toContain("scope_fingerprint");
  });

  it("import_batches cobre modo, status, vínculo com dry-run, aprovação e contagens", () => {
    for (const coluna of [
      "mode",
      "status",
      "dry_run_batch_public_id",
      "approved_by_identity_public_id",
      "approved_at",
      "counts_before",
      "counts_after",
      "mapping_rules_version",
      "started_at",
      "finished_at"
    ]) {
      expect(batches?.up).toContain(coluna);
    }
  });

  it("import_batch_items cobre as cinco ações e os campos de trilha", () => {
    expect(items?.up).toContain("ENUM('CREATE','UPDATE','SKIP','CONFLICT','QUARANTINE')");
    for (const coluna of [
      "entity_kind",
      "source_entity_type",
      "source_legacy_id",
      "target_public_id",
      "before_snapshot",
      "after_snapshot",
      "reason_code",
      "error_message"
    ]) {
      expect(items?.up).toContain(coluna);
    }
  });

  it("nenhuma coluna de segredo existe nas tabelas de lote", () => {
    const sql = `${batches?.up ?? ""}\n${items?.up ?? ""}`;
    const colunas = [...sql.matchAll(/^ {4}([a-z_]+)\s+(?:BIGINT|CHAR|VARCHAR|ENUM|JSON|DATETIME)/gm)].map(
      (match) => match[1] ?? ""
    );
    expect(colunas.length).toBeGreaterThan(0);
    for (const coluna of colunas) {
      expect(coluna).not.toMatch(/password|senha|token|secret|hash|credential/i);
    }
  });

  it("items referencia batches com RESTRICT", () => {
    expect(items?.up).toContain("REFERENCES import_batches (public_id)");
    expect(items?.up).toContain("ON DELETE RESTRICT");
  });
});
