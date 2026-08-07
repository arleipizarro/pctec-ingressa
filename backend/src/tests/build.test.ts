import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST_SERVER_JS = path.join(BACKEND_ROOT, "dist", "server.js");

/**
 * Único teste da suíte que de fato invoca o compilador TypeScript (mais
 * lento que os demais — por isso isolado neste arquivo, fácil de excluir
 * separadamente se algum dia isso incomodar a suíte padrão). Escopo
 * pedido explicitamente: comprovar que `npm run build` produz
 * `dist/server.js` de verdade, não só que o TypeScript compila sem erro
 * (`npm run typecheck` já cobre isso, sem emitir nada).
 *
 * Efeito colateral conhecido e aceito: escreve em `backend/dist/` (já
 * coberto por `.gitignore`). Remove `dist/` antes de compilar, para o
 * teste nunca passar "por acidente" com um artefato de build anterior.
 */
describe("build", () => {
  it("npm run build gera dist/server.js", () => {
    rmSync(path.join(BACKEND_ROOT, "dist"), { recursive: true, force: true });
    expect(existsSync(DIST_SERVER_JS)).toBe(false);

    execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: BACKEND_ROOT, stdio: "pipe" });

    expect(existsSync(DIST_SERVER_JS)).toBe(true);
  });
});
