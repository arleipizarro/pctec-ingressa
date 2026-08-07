import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyMigrationAssets } from "../../scripts/copy-migration-assets.mjs";

/**
 * Testes da lógica pura de `copy-migration-assets.mjs` — usam
 * diretórios temporários reais (`node:fs`, `mkdtempSync`), nunca tocam em
 * `src/shared/database/migrations/` nem em `dist/` de verdade, e nunca
 * executam SQL algum (só operações de arquivo: criar/ler/comparar
 * arquivos `.sql` como texto, nunca uma conexão de banco).
 */
describe("copyMigrationAssets", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "copy-migration-assets-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copia pares up/down completos para o diretório de destino, criando-o se não existir", () => {
    const srcDir = makeTempDir();
    const distDir = join(makeTempDir(), "migrations"); // não existe ainda
    writeFileSync(join(srcDir, "0001_a.up.sql"), "CREATE TABLE a (id INT)");
    writeFileSync(join(srcDir, "0001_a.down.sql"), "DROP TABLE a");

    const result = copyMigrationAssets({ srcDir, distDir });

    expect(result.copiedFiles.sort()).toEqual(["0001_a.down.sql", "0001_a.up.sql"]);
    expect(existsSync(join(distDir, "0001_a.up.sql"))).toBe(true);
    expect(existsSync(join(distDir, "0001_a.down.sql"))).toBe(true);
  });

  it("conteúdo copiado é byte-a-byte idêntico ao arquivo fonte (nome preservado, sem transformação)", () => {
    const srcDir = makeTempDir();
    const distDir = makeTempDir();
    const content = "ALTER TABLE x ADD COLUMN y INT; -- comentário com ; dentro, preservado literalmente\n";
    writeFileSync(join(srcDir, "0002_b.up.sql"), content);
    writeFileSync(join(srcDir, "0002_b.down.sql"), "ALTER TABLE x DROP COLUMN y");

    copyMigrationAssets({ srcDir, distDir });

    expect(readFileSync(join(distDir, "0002_b.up.sql"), "utf-8")).toBe(content);
  });

  it("nenhum arquivo diferente de *.up.sql/*.down.sql é copiado", () => {
    const srcDir = makeTempDir();
    const distDir = makeTempDir();
    writeFileSync(join(srcDir, "0001_a.up.sql"), "CREATE TABLE a (id INT)");
    writeFileSync(join(srcDir, "0001_a.down.sql"), "DROP TABLE a");
    writeFileSync(join(srcDir, "README.md"), "não é migration");
    writeFileSync(join(srcDir, "0001_a.sql.bak"), "backup, não deveria ser copiado");
    writeFileSync(join(srcDir, ".gitkeep"), "");

    const result = copyMigrationAssets({ srcDir, distDir });

    expect(result.copiedFiles).toEqual(["0001_a.down.sql", "0001_a.up.sql"]);
    expect(existsSync(join(distDir, "README.md"))).toBe(false);
    expect(existsSync(join(distDir, "0001_a.sql.bak"))).toBe(false);
    expect(existsSync(join(distDir, ".gitkeep"))).toBe(false);
  });

  it("falha se o diretório fonte não existir", () => {
    const distDir = makeTempDir();
    expect(() => copyMigrationAssets({ srcDir: join(distDir, "nao-existe"), distDir })).toThrow(/não existe/);
  });

  it("falha se o diretório fonte existir mas não tiver nenhuma migration", () => {
    const srcDir = makeTempDir();
    const distDir = makeTempDir();
    writeFileSync(join(srcDir, "README.md"), "sem migrations aqui");

    expect(() => copyMigrationAssets({ srcDir, distDir })).toThrow(/nenhum arquivo de migration/);
  });

  it("falha se houver um .up.sql sem .down.sql correspondente (par incompleto) — e não copia NADA nesse caso", () => {
    const srcDir = makeTempDir();
    const distDir = makeTempDir();
    writeFileSync(join(srcDir, "0001_a.up.sql"), "CREATE TABLE a (id INT)");
    writeFileSync(join(srcDir, "0001_a.down.sql"), "DROP TABLE a");
    writeFileSync(join(srcDir, "0002_b.up.sql"), "CREATE TABLE b (id INT)");
    // 0002_b.down.sql ausente de propósito

    expect(() => copyMigrationAssets({ srcDir, distDir })).toThrow(/0002_b/);
    expect(existsSync(join(distDir, "0001_a.up.sql"))).toBe(false); // tudo ou nada — falha rápido, antes de copiar
  });

  it("falha se houver um .down.sql sem .up.sql correspondente", () => {
    const srcDir = makeTempDir();
    const distDir = makeTempDir();
    writeFileSync(join(srcDir, "0001_a.down.sql"), "DROP TABLE a");
    // 0001_a.up.sql ausente de propósito

    expect(() => copyMigrationAssets({ srcDir, distDir })).toThrow(/0001_a/);
  });

  it("mkdirSync com recursive: cria diretórios intermediários que ainda não existem", () => {
    const srcDir = makeTempDir();
    const distRoot = makeTempDir();
    const distDir = join(distRoot, "a", "b", "c", "migrations");
    writeFileSync(join(srcDir, "0001_a.up.sql"), "CREATE TABLE a (id INT)");
    writeFileSync(join(srcDir, "0001_a.down.sql"), "DROP TABLE a");

    expect(() => copyMigrationAssets({ srcDir, distDir })).not.toThrow();
    expect(existsSync(join(distDir, "0001_a.up.sql"))).toBe(true);
  });

  it("nunca executa SQL — só lê/escreve arquivos como texto (nenhuma dependência de mysql2/Pool é importada por este módulo)", async () => {
    const moduleSource = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../scripts/copy-migration-assets.mjs", import.meta.url), "utf-8")
    );
    expect(moduleSource).not.toContain("mysql2");
    expect(moduleSource.toLowerCase()).not.toContain("createpool");
  });
});
