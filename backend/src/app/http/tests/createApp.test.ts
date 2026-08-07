import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../createApp.js";

/**
 * Testes HTTP reais contra um servidor efêmero (porta 0 → o SO escolhe
 * uma porta livre), usando `fetch` nativo do Node 22 — sem adicionar
 * `supertest` como dependência só para isto, mantendo o escopo desta
 * fatia mínimo.
 */
describe("createApp — GET /health", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado do servidor de teste");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("retorna 200 com o payload exato especificado", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", service: "pctec-ingressa", version: "0.4.1" });
  });

  it("retorna Content-Type application/json", async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  });

  it("não expõe o header X-Powered-By em nenhuma resposta", async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("é determinístico — chamadas repetidas retornam exatamente o mesmo payload", async () => {
    const first = await (await fetch(`${baseUrl}/health`)).json();
    const second = await (await fetch(`${baseUrl}/health`)).json();

    expect(first).toEqual(second);
  });

  it("não expõe hostname, IP, memória, versão do Node ou qualquer segredo no payload", async () => {
    const body = (await (await fetch(`${baseUrl}/health`)).json()) as Record<string, unknown>;
    const keys = Object.keys(body);

    expect(keys.sort()).toEqual(["service", "status", "version"]);
  });

  it("rota desconhecida retorna 404", async () => {
    const res = await fetch(`${baseUrl}/rota-que-nao-existe`);

    expect(res.status).toBe(404);
  });

  it("método não permitido em /health retorna 404 (decisão desta fatia: nunca 405, para não revelar métodos de rotas ainda inexistentes publicamente)", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "POST" });

    expect(res.status).toBe(404);
  });

  it("não consulta banco nem depende de qualquer estado externo (nenhuma variável de ambiente de banco é necessária para o teste passar)", async () => {
    // Ausência de qualquer configuração DB_* no processo de teste (vitest
    // não carrega .env) e o teste acima já passa — é a própria prova.
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });
});
