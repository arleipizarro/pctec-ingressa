import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST_MAIN_JS = path.join(BACKEND_ROOT, "dist", "main.js");
// Porta alta e específica deste teste — nunca a 3011 real, para não
// colidir com nada que porventura esteja rodando localmente.
const TEST_PORT = 30119;

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}

/**
 * Único teste da suíte que de fato SPAWNA `node dist/main.js` como um
 * processo real e separado — reproduzindo fielmente o cenário do defeito
 * real observado em DEV sob PM2: "o processo existe e reporta `online`,
 * mas nunca abre socket e `/health` nunca responde". Um teste que só
 * importasse `main.ts` dentro do próprio processo de teste não provaria
 * nada aqui — precisa ser um processo `node` de verdade, exatamente como
 * o PM2 executa.
 *
 * Constrói `dist/` primeiro se ainda não existir (reaproveita o mesmo
 * build que `build.test.ts` já valida em detalhe — não duplica aquelas
 * asserções aqui, só usa o artefato).
 */
describe("main.ts — entrypoint executável real", () => {
  let child: ChildProcessWithoutNullStreams | null = null;

  beforeAll(() => {
    if (!existsSync(DIST_MAIN_JS)) {
      execFileSync("npm", ["run", "build"], { cwd: BACKEND_ROOT, stdio: "pipe" });
    }
  }, 30_000);

  afterEach(async () => {
    if (child !== null && child.exitCode === null && !child.killed) {
      child.kill("SIGKILL"); // rede de segurança — o teste já deveria ter encerrado graciosamente
      await waitForExit(child).catch(() => undefined);
    }
    child = null;
  });

  it("node dist/main.js abre um socket real em HOST:PORT e /health responde — a causa raiz do bug (isMainModule sob PM2) não pode mais ocorrer", async () => {
    child = spawn("node", [DIST_MAIN_JS], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(TEST_PORT), NODE_ENV: "development" }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout esperando o processo logar o bootstrap")), 5000);
      child!.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes(String(TEST_PORT))) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child!.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`processo saiu prematuramente com código ${code}`));
      });
    });

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", service: "pctec-ingressa", version: "0.5.0" });

    // Encerramento gracioso continua funcionando através do entrypoint real.
    child!.kill("SIGTERM");
    const exitCode = await waitForExit(child!);
    expect(exitCode).toBe(0);

    // Porta liberada após o encerramento.
    await expect(fetch(`http://127.0.0.1:${TEST_PORT}/health`)).rejects.toThrow();
  }, 15_000);

  it("erro de bootstrap (configuração de PORT inválida) resulta em exitCode != 0, sem deixar processo pendurado", async () => {
    child = spawn("node", [DIST_MAIN_JS], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, HOST: "127.0.0.1", PORT: "-1", NODE_ENV: "development" }
    });

    const exitCode = await waitForExit(child);
    expect(exitCode).not.toBe(0);
  }, 10_000);
});
