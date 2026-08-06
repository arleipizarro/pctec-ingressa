import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MigrationDefinition } from "./MigrationRunner.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Carrega as definições de migration a partir dos arquivos
 * `NNNN_nome.up.sql` / `NNNN_nome.down.sql` em `shared/database/migrations`.
 *
 * Os arquivos `.sql` são a fonte única de verdade (revisáveis por um DBA
 * sem precisar ler TypeScript); este loader apenas os agrupa em pares
 * up/down, ordenados pelo prefixo numérico do nome do arquivo.
 *
 * Operação puramente de leitura de disco local — não abre nenhuma conexão
 * de rede ou de banco.
 */
export function loadMigrationDefinitions(directory: string = MIGRATIONS_DIR): MigrationDefinition[] {
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql"));
  const upFiles = files.filter((name) => name.endsWith(".up.sql")).sort();

  return upFiles.map((upFileName) => {
    const id = upFileName.replace(/\.up\.sql$/, "");
    const downFileName = `${id}.down.sql`;
    if (!files.includes(downFileName)) {
      throw new Error(`Migration "${id}" não possui arquivo down correspondente (${downFileName}).`);
    }
    const up = readFileSync(join(directory, upFileName), "utf-8");
    const down = readFileSync(join(directory, downFileName), "utf-8");
    return {
      id,
      description: id.replace(/^\d+_/, "").replace(/_/g, " "),
      up,
      down
    };
  });
}
