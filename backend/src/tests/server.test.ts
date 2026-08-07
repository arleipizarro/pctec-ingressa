import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app/http/createApp.js";
import { createShutdownHandler, registerGracefulShutdown } from "../server.js";

async function listenEphemeral(): Promise<Server> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return server;
}

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
