#!/usr/bin/env node
// backend/scripts/copy-migration-assets.mjs
//
// Responsabilidade única: copiar os assets *.up.sql/*.down.sql de
// src/shared/database/migrations/ para dist/shared/database/migrations/
// depois da compilação TypeScript — o `tsc` só compila `.ts`, nunca copia
// arquivos não-TS para `dist/`, então sem este passo o runtime compilado
// (`dist/cli/migrate.js`, via `loadMigrationDefinitions.js`) nunca
// encontra as migrations (causa raiz do defeito real observado em DEV:
// `ENOENT ... dist/shared/database/migrations`).
//
// NUNCA executa SQL — só operações de sistema de arquivos (existsSync,
// mkdirSync, readdirSync, copyFileSync). Multiplataforma (Node puro, sem
// `cp`/`xcopy` de shell).
//
// Uso como CLI (parte de `npm run build`):
//   node scripts/copy-migration-assets.mjs
//
// Uso programático (testável sem processo filho):
//   import { copyMigrationAssets } from "./copy-migration-assets.mjs";

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {{ srcDir: string, distDir: string }} options
 * @returns {{ copiedFiles: string[] }}
 */
export function copyMigrationAssets({ srcDir, distDir }) {
  if (!existsSync(srcDir)) {
    throw new Error(`diretório fonte de migrations não existe: ${srcDir}`);
  }

  const allFiles = readdirSync(srcDir);
  // Copia SOMENTE *.up.sql e *.down.sql — nenhum outro arquivo, mesmo que
  // esteja na mesma pasta (ex.: um README.md acidental, um .sql.bak,
  // etc.). A ordem de checagem importa: ".down.sql" precisa ser testado
  // antes de qualquer sufixo mais genérico para não haver ambiguidade.
  const sqlFiles = allFiles.filter((name) => name.endsWith(".up.sql") || name.endsWith(".down.sql"));

  if (sqlFiles.length === 0) {
    throw new Error(`nenhum arquivo de migration (*.up.sql / *.down.sql) encontrado em ${srcDir}`);
  }

  const upIds = sqlFiles.filter((name) => name.endsWith(".up.sql")).map((name) => name.replace(/\.up\.sql$/, ""));
  const downIds = sqlFiles.filter((name) => name.endsWith(".down.sql")).map((name) => name.replace(/\.down\.sql$/, ""));

  const missingDown = upIds.filter((id) => !downIds.includes(id));
  const missingUp = downIds.filter((id) => !upIds.includes(id));

  if (missingDown.length > 0 || missingUp.length > 0) {
    const parts = [];
    if (missingDown.length > 0) parts.push(`sem .down.sql correspondente: ${missingDown.join(", ")}`);
    if (missingUp.length > 0) parts.push(`sem .up.sql correspondente: ${missingUp.join(", ")}`);
    throw new Error(`par up/down de migration incompleto — ${parts.join("; ")}`);
  }

  mkdirSync(distDir, { recursive: true });

  // Nome do arquivo preservado byte-a-byte (mesmo `name` usado como
  // destino) — nenhuma renomeação, nenhuma transformação de conteúdo.
  for (const name of sqlFiles) {
    copyFileSync(join(srcDir, name), join(distDir, name));
  }

  return { copiedFiles: [...sqlFiles].sort() };
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const backendRoot = resolve(scriptDir, "..");
  const srcDir = join(backendRoot, "src", "shared", "database", "migrations");
  const distDir = join(backendRoot, "dist", "shared", "database", "migrations");

  try {
    const result = copyMigrationAssets({ srcDir, distDir });
    // eslint-disable-next-line no-console
    console.log(`[copy-migration-assets] ${result.copiedFiles.length} arquivo(s) copiado(s) para ${distDir}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[copy-migration-assets] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
