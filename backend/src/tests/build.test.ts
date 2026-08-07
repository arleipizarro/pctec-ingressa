import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST_DIR = path.join(BACKEND_ROOT, "dist");
const DIST_SERVER_JS = path.join(DIST_DIR, "server.js");
const DIST_MAIN_JS = path.join(DIST_DIR, "main.js");
const DIST_CLI_MIGRATE_JS = path.join(DIST_DIR, "cli", "migrate.js");
const SRC_MIGRATIONS_DIR = path.join(BACKEND_ROOT, "src", "shared", "database", "migrations");
const DIST_MIGRATIONS_DIR = path.join(DIST_DIR, "shared", "database", "migrations");

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Único ponto da suíte que de fato invoca `npm run build` de verdade
 * (TypeScript + `scripts/copy-migration-assets.mjs`) — mais lento que os
 * demais testes, por isso isolado neste arquivo. `beforeAll` roda o build
 * UMA VEZ (não a cada `it`, para não pagar o custo do `tsc` repetidas
 * vezes) e os testes abaixo só fazem asserções sobre o artefato já
 * gerado — evita duplicar a mesma invocação de build em vários arquivos
 * de teste.
 *
 * Escopo: comprovar que o artefato COMPILADO é autocontido — inclui não
 * só `dist/server.js`, mas também `dist/cli/migrate.js` e
 * `dist/shared/database/migrations/*.sql` (a causa raiz do defeito real
 * observado em DEV era exatamente a ausência destes últimos: `tsc` nunca
 * copia arquivos não-`.ts` para `dist/`).
 *
 * Nenhum teste aqui executa SQL nem abre conexão de banco — só leitura
 * de arquivos e, no teste de `loadMigrationDefinitions`, a mesma função
 * pura já usada pelo CLI real para enumerar migrations a partir do
 * disco (sem `MigrationRunner`, sem `Pool`, sem rede).
 */
describe("build", () => {
  beforeAll(() => {
    rmSync(DIST_DIR, { recursive: true, force: true });
    expect(existsSync(DIST_SERVER_JS)).toBe(false);
    execFileSync("npm", ["run", "build"], { cwd: BACKEND_ROOT, stdio: "pipe" });
  }, 30_000);

  it("gera dist/server.js (módulo import-safe — não é mais o entrypoint executável)", () => {
    expect(existsSync(DIST_SERVER_JS)).toBe(true);
  });

  it("gera dist/main.js (entrypoint executável real — é isto que PM2/npm start executam)", () => {
    expect(existsSync(DIST_MAIN_JS)).toBe(true);
  });

  it("gera dist/cli/migrate.js", () => {
    expect(existsSync(DIST_CLI_MIGRATE_JS)).toBe(true);
  });

  it("gera dist/shared/database/migrations/ com exatamente as 8 migrations atuais (0001-0004, up/down)", () => {
    expect(existsSync(DIST_MIGRATIONS_DIR)).toBe(true);
    const distFiles = readdirSync(DIST_MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    expect(distFiles).toEqual([
      "0001_create_schema_migrations.down.sql",
      "0001_create_schema_migrations.up.sql",
      "0002_create_identities.down.sql",
      "0002_create_identities.up.sql",
      "0003_create_audit_events.down.sql",
      "0003_create_audit_events.up.sql",
      "0004_add_checksum_and_timing_to_schema_migrations.down.sql",
      "0004_add_checksum_and_timing_to_schema_migrations.up.sql"
    ]);
  });

  it("cada arquivo copiado para dist/ tem SHA-256 idêntico ao arquivo fonte em src/ (cópia byte-a-byte)", () => {
    const srcFiles = readdirSync(SRC_MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));
    expect(srcFiles.length).toBe(8);
    for (const name of srcFiles) {
      const srcHash = sha256(path.join(SRC_MIGRATIONS_DIR, name));
      const distHash = sha256(path.join(DIST_MIGRATIONS_DIR, name));
      expect(distHash, `hash divergente para ${name}`).toBe(srcHash);
    }
  });

  it("loadMigrationDefinitions, executado a partir do artefato COMPILADO, enumera as 4 migrations (0001-0004) sem depender de src/ nem de banco", async () => {
    const compiledModuleUrl = pathToFileURL(path.join(DIST_DIR, "shared", "database", "loadMigrationDefinitions.js")).href;
    const { loadMigrationDefinitions } = (await import(compiledModuleUrl)) as {
      loadMigrationDefinitions: () => Array<{ id: string; up: string; down: string }>;
    };

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
});
