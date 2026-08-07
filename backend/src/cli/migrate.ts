import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { loadMigrationDefinitions } from "../shared/database/loadMigrationDefinitions.js";
import { MigrationRunner, type MigrationDefinition, type MigrationStatusEntry } from "../shared/database/MigrationRunner.js";

/**
 * CLI operacional de migrations — v0.4.2 (MariaDB Integration).
 *
 * NUNCA conecta a nenhum banco por conta própria: usa exatamente as
 * mesmas variáveis `DB_*` já validadas por `loadEnv()` (mesma fonte que
 * os testes de integração), lidas de `process.env` — nunca de um valor
 * embutido, nunca aponta implicitamente para DEV. Quem decide o alvo é
 * quem chama o comando, preenchendo `.env` (nunca versionado) ou
 * exportando as variáveis na sessão do shell.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/migrate.js status
 *   node dist/cli/migrate.js up [--dry-run]
 *   node dist/cli/migrate.js down [--dry-run] [--yes]
 *   node dist/cli/migrate.js down-all [--dry-run] [--yes]
 *
 * `down`/`down-all` são ações destrutivas. Executar de verdade exige
 * DUAS condições simultâneas: o argumento `--yes` E a variável de
 * ambiente `MIGRATIONS_ALLOW_DESTRUCTIVE=true`. Sem qualquer uma delas,
 * o comando mostra o preview do que seria revertido e sai com código 1,
 * sem alterar nada. `NODE_ENV=production` recusa SEMPRE (código 2),
 * mesmo com as duas condições acima satisfeitas — ver
 * `evaluateDestructiveGate`.
 */

interface CliArgs {
  readonly command: "status" | "up" | "down" | "down-all";
  readonly dryRun: boolean;
  readonly yes: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command !== "status" && command !== "up" && command !== "down" && command !== "down-all") {
    throw new Error(`Comando desconhecido: "${command ?? ""}". Use: status | up | down | down-all`);
  }
  return {
    command,
    dryRun: rest.includes("--dry-run"),
    yes: rest.includes("--yes")
  };
}

export function formatStatusTable(entries: readonly MigrationStatusEntry[]): string {
  const lines = entries.map((entry) => {
    const appliedAt = entry.appliedAt !== null ? entry.appliedAt.toISOString() : "-";
    return `  ${entry.id.padEnd(52)} ${entry.state.padEnd(18)} ${appliedAt}`;
  });
  return [`  ${"ID".padEnd(52)} ${"ESTADO".padEnd(18)} APLICADA_EM`, ...lines].join("\n");
}

interface MigrateRunnerLike {
  status: MigrationRunner["status"];
  applyPending: MigrationRunner["applyPending"];
  rollbackLast: MigrationRunner["rollbackLast"];
  rollbackAll: MigrationRunner["rollbackAll"];
}

/**
 * Gate de execução destrutiva (`down`/`down-all`).
 *
 * DUAS condições são exigidas simultaneamente para executar de verdade:
 * `--yes` (argumento explícito) E `MIGRATIONS_ALLOW_DESTRUCTIVE=true`
 * (variável de ambiente). Nenhuma das duas sozinha basta — isso evita
 * tanto "esqueci a flag" quanto "a variável ficou true por engano num
 * ambiente compartilhado" derrubando uma migration sem querer.
 *
 * `NODE_ENV=production` recusa SEMPRE, mesmo com as duas condições
 * acima satisfeitas — rollback automatizado nunca é permitido em
 * produção por este CLI, sem exceção nesta fatia.
 */
export interface DestructiveGateEnv {
  readonly nodeEnv: string;
  readonly allowDestructiveEnvVar: boolean;
}

export type DestructiveGateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "production" | "missing_yes_flag" | "missing_env_var" };

export function evaluateDestructiveGate(args: CliArgs, gateEnv: DestructiveGateEnv): DestructiveGateDecision {
  if (gateEnv.nodeEnv === "production") {
    return { allowed: false, reason: "production" };
  }
  if (!args.yes) {
    return { allowed: false, reason: "missing_yes_flag" };
  }
  if (!gateEnv.allowDestructiveEnvVar) {
    return { allowed: false, reason: "missing_env_var" };
  }
  return { allowed: true };
}

/**
 * Lógica de decisão do CLI, separada da abertura de Pool/conexão real —
 * testável diretamente com um `MigrationRunner` construído sobre
 * `FakeQueryable`, sem tocar em nenhum banco de verdade. `runMigrateCli`
 * (abaixo) é só o "encaixe" que conecta isto a um Pool mysql2 real.
 */
export async function executeMigrateCommand(
  runner: MigrateRunnerLike,
  migrations: readonly MigrationDefinition[],
  args: CliArgs,
  log: (line: string) => void = () => {},
  gateEnv: DestructiveGateEnv = { nodeEnv: "development", allowDestructiveEnvVar: false }
): Promise<number> {
  if (args.command === "status") {
    const status = await runner.status(migrations);
    log(formatStatusTable(status));
    const mismatches = status.filter((entry) => entry.state === "checksum_mismatch");
    return mismatches.length > 0 ? 1 : 0;
  }

  if (args.command === "up") {
    const status = await runner.status(migrations);
    const pending = status.filter((entry) => entry.state === "pending");
    if (args.dryRun) {
      log(`[dry-run] aplicaria ${pending.length} migration(ns): ${pending.map((e) => e.id).join(", ") || "(nenhuma)"}`);
      return 0;
    }
    const report = await runner.applyPending(migrations);
    log(`Aplicadas: ${report.appliedIds.join(", ") || "(nenhuma)"}`);
    log(`Já aplicadas: ${report.alreadyAppliedIds.join(", ") || "(nenhuma)"}`);
    return 0;
  }

  // down / down-all — sempre destrutivo, sempre com preview antes de
  // qualquer execução real, independentemente do resultado do gate.
  const status = await runner.status(migrations);
  const applied = status.filter((entry) => entry.state === "applied" || entry.state === "checksum_unknown");
  const toRevert = args.command === "down" ? applied.slice(-1) : [...applied].reverse();

  log(
    `${args.command === "down" ? "Reverteria a última migration aplicada" : "Reverteria TODAS as migrations aplicadas, em ordem reversa"}: ` +
      `${toRevert.map((e) => e.id).join(", ") || "(nenhuma aplicada)"}`
  );

  if (args.dryRun) {
    log("[dry-run] Nenhuma alteração foi feita.");
    return 0;
  }

  const gate = evaluateDestructiveGate(args, gateEnv);
  if (!gate.allowed) {
    if (gate.reason === "production") {
      log("RECUSADO: NODE_ENV=production. Rollback automatizado nunca é permitido em produção por este CLI, mesmo com --yes e MIGRATIONS_ALLOW_DESTRUCTIVE=true.");
      return 2;
    }
    if (gate.reason === "missing_yes_flag") {
      log("Nenhuma alteração foi feita. Faltou o argumento --yes.");
    } else {
      log("Nenhuma alteração foi feita. Faltou a variável de ambiente MIGRATIONS_ALLOW_DESTRUCTIVE=true.");
    }
    log("Ambas as condições (--yes E MIGRATIONS_ALLOW_DESTRUCTIVE=true) são exigidas para executar de verdade.");
    return 1;
  }

  const report = args.command === "down" ? await runner.rollbackLast(migrations) : await runner.rollbackAll(migrations);
  log(`Revertidas: ${report.revertedIds.join(", ") || "(nenhuma)"}`);
  return 0;
}

/**
 * Nunca loga a senha (`env.DB_PASSWORD`) nem qualquer outra credencial —
 * só host/porta/usuário/banco, exatamente como exigido pelo runbook desta
 * entrega (seção "Segurança do usuário de banco").
 */
function logConnectionTarget(env: { DB_HOST: string; DB_PORT: number; DB_NAME: string; DB_USER: string }): void {
  // eslint-disable-next-line no-console
  console.log(`Alvo: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
}

export async function runMigrateCli(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const env = loadEnv();
  const migrations = loadMigrationDefinitions();

  logConnectionTarget(env);

  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });
  const runner = new MigrationRunner(pool);

  try {
    // eslint-disable-next-line no-console
    return await executeMigrateCommand(runner, migrations, args, (line) => console.log(line), {
      nodeEnv: env.NODE_ENV,
      allowDestructiveEnvVar: env.MIGRATIONS_ALLOW_DESTRUCTIVE
    });
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  runMigrateCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
