import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app/http/createApp.js";
import { loadEnv } from "../app/config/env.js";
import { createShutdownHandler, registerGracefulShutdown, startServer } from "../server.js";

async function listenEphemeral(): Promise<Server> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return server;
}

describe("server.ts é import-safe (sem isMainModule)", () => {
  it("importar o módulo não abre nenhum socket — não existe mais nenhuma detecção de 'sou o entrypoint?' que chame startServer() automaticamente", () => {
    // Prova estrutural direta da causa raiz do bug real observado em DEV
    // sob PM2: server.ts não pode mais conter nenhuma chamada de
    // startServer() fora da própria definição da função, nem qualquer
    // heurística de process.argv[1]/import.meta.url.
    const source = readFileSync(new URL("../server.ts", import.meta.url), "utf-8");
    expect(source).not.toContain("isMainModule");
    expect(source).not.toContain("fileURLToPath");
    // Nenhuma linha é uma CHAMADA de startServer() como statement solto
    // (ex.: "startServer();") fora da própria definição da função —
    // ignora menções em comentários/prosa (que contêm "startServer()"
    // como referência de código, não como invocação).
    const bareInvocationLines = source.split("\n").filter((line) => /^\s*startServer\(\)\s*;?\s*$/.test(line));
    expect(bareInvocationLines).toEqual([]);
  });
});

describe("startServer", () => {
  it("abre um servidor HTTP real quando chamada explicitamente (env injetado, porta efêmera — não depende da porta fixa 3011)", async () => {
    const env = { ...loadEnv({}), PORT: 0 };
    const server = startServer(env);
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("o servidor aberto por startServer() responde em /health de verdade", async () => {
    const env = { ...loadEnv({}), PORT: 0 };
    const server = startServer(env);
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("endereço inesperado do servidor de teste");
      }
      const res = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("createShutdownHandler", () => {
  it("fecha o servidor HTTP (para de aceitar novas conexões)", async () => {
    const server = await listenEphemeral();
    expect(server.listening).toBe(true);

    const shutdown = createShutdownHandler(server);
    await shutdown();

    expect(server.listening).toBe(false);
  });

  it("é idempotente — chamar duas vezes não lança erro", async () => {
    const server = await listenEphemeral();
    const shutdown = createShutdownHandler(server);

    await shutdown();
    await expect(shutdown()).resolves.toBeUndefined();
  });
});

describe("registerGracefulShutdown", () => {
  // Nunca dispara um sinal real de processo nem chama process.exit de
  // verdade aqui — isso mataria o processo do test runner. `exit` é
  // injetado como fake, e o sinal é emitido via process.emit (apenas
  // aciona os listeners já registrados, sem efeito no processo).
  const originalListeners: Partial<Record<NodeJS.Signals, NodeJS.SignalsListener[]>> = {};

  function snapshotAndClearListeners(signal: NodeJS.Signals): void {
    originalListeners[signal] = process.listeners(signal) as NodeJS.SignalsListener[];
    process.removeAllListeners(signal);
  }

  function restoreListeners(signal: NodeJS.Signals): void {
    process.removeAllListeners(signal);
    for (const listener of originalListeners[signal] ?? []) {
      process.on(signal, listener);
    }
  }

  afterEach(() => {
    restoreListeners("SIGTERM");
    restoreListeners("SIGINT");
  });

  it("ao receber SIGTERM, fecha o servidor e chama exit(0)", async () => {
    snapshotAndClearListeners("SIGTERM");
    const server = await listenEphemeral();
    const exit = vi.fn();

    registerGracefulShutdown(server, { signals: ["SIGTERM"], exit });
    process.emit("SIGTERM");

    // O handler é assíncrono (server.close aguarda conexões existentes) —
    // dá um tick para a promise resolver antes de checar as asserções.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(server.listening).toBe(false);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("ao receber SIGINT, também dispara o encerramento gracioso", async () => {
    snapshotAndClearListeners("SIGINT");
    const server = await listenEphemeral();
    const exit = vi.fn();

    registerGracefulShutdown(server, { signals: ["SIGINT"], exit });
    process.emit("SIGINT");

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(server.listening).toBe(false);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
