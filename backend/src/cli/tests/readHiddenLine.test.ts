import { describe, it, expect } from "vitest";
import {
  readHiddenLineFrom,
  type HiddenLineInputStream,
  type HiddenLineOutputStream,
  type HiddenLineProcessSignals
} from "../bootstrap-first-credential.js";

/**
 * Fake de stream de entrada compatível com `HiddenLineInputStream` —
 * simula um TTY real o suficiente para exercitar `readHiddenLineFrom`
 * sem depender de um terminal interativo de verdade (que não existe
 * neste ambiente de build/CI). Permite empurrar "teclas" (`pushKeystrokes`),
 * simular EOF (`emitEnd`) e erro de stream (`emitError`).
 */
class FakeTtyInputStream implements HiddenLineInputStream {
  public isTTY: boolean | undefined = true;
  public rawModeCalls: boolean[] = [];
  public resumeCallCount = 0;
  public pauseCallCount = 0;

  private dataListener: ((chunk: Buffer) => void) | undefined;
  private endListener: (() => void) | undefined;
  private errorListener: ((error: Error) => void) | undefined;

  public setRawMode(mode: boolean): void {
    this.rawModeCalls.push(mode);
  }

  public resume(): void {
    this.resumeCallCount += 1;
  }

  public pause(): void {
    this.pauseCallCount += 1;
  }

  public on(event: "data", listener: (chunk: Buffer) => void): void {
    if (event === "data") {
      this.dataListener = listener;
    }
  }

  public once(event: "end" | "error", listener: (...args: never[]) => void): void {
    if (event === "end") {
      this.endListener = listener as () => void;
    } else if (event === "error") {
      this.errorListener = listener as (error: Error) => void;
    }
  }

  public removeListener(event: string): void {
    if (event === "data") {
      this.dataListener = undefined;
    } else if (event === "end") {
      this.endListener = undefined;
    } else if (event === "error") {
      this.errorListener = undefined;
    }
  }

  /** Simula o operador digitando — cada string vira um chunk separado, como teclas reais. */
  public pushKeystrokes(...keys: string[]): void {
    for (const key of keys) {
      this.dataListener?.(Buffer.from(key, "utf8"));
    }
  }

  public pushRawChunk(chunk: Buffer): void {
    this.dataListener?.(chunk);
  }

  public emitEnd(): void {
    this.endListener?.();
  }

  public emitError(error: Error): void {
    this.errorListener?.(error);
  }

  public hasActiveDataListener(): boolean {
    return this.dataListener !== undefined;
  }
}

class FakeOutputStream implements HiddenLineOutputStream {
  public writes: string[] = [];

  public write(text: string): void {
    this.writes.push(text);
  }

  public all(): string {
    return this.writes.join("");
  }
}

class FakeProcessSignals implements HiddenLineProcessSignals {
  private sigintListener: (() => void) | undefined;

  public once(event: "SIGINT", listener: () => void): void {
    if (event === "SIGINT") {
      this.sigintListener = listener;
    }
  }

  public removeListener(): void {
    this.sigintListener = undefined;
  }

  public emitSigint(): void {
    this.sigintListener?.();
  }

  public hasActiveSigintListener(): boolean {
    return this.sigintListener !== undefined;
  }
}

describe("readHiddenLineFrom — comportamento básico", () => {
  it("lança se a entrada não for um TTY — nunca ativa modo raw", async () => {
    const input = new FakeTtyInputStream();
    input.isTTY = false;
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    await expect(readHiddenLineFrom("Senha: ", input, output, signals)).rejects.toThrow(
      "Entrada oculta exige um terminal interativo (TTY)."
    );
    expect(input.rawModeCalls).toHaveLength(0);
  });

  it("ativa o modo raw antes de ler e desativa depois — sucesso", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("s", "e", "n", "h", "a", "1", "2", "3", "\n");
    const result = await promise;

    expect(result).toBe("senha123");
    expect(input.rawModeCalls).toEqual([true, false]); // ligado, depois desligado — nunca fica preso
  });

  it("a senha digitada NUNCA aparece na saída (output) — só o prompt e a quebra de linha final", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("s", "e", "g", "r", "e", "d", "o", "9", "9", "\n");
    await promise;

    expect(output.all()).toBe("Senha: \n");
    expect(output.all()).not.toContain("segredo99");
  });

  it("backspace remove o último caractere digitado", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("s", "e", "n", "h", "x", "\u007f", "a", "\n");
    const result = await promise;

    expect(result).toBe("senha");
  });

  it("Ctrl+D (EOF via tecla) finaliza a leitura com sucesso, com o valor acumulado até então", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("a", "b", "c", "\u0004");
    const result = await promise;

    expect(result).toBe("abc");
    expect(input.rawModeCalls).toEqual([true, false]);
  });
});

describe("readHiddenLineFrom — hardening: raw mode SEMPRE restaurado", () => {
  it("cancelamento (Ctrl+C como byte): raw mode restaurado, listeners removidos, promise rejeitada", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("a", "b", "\u0003");

    await expect(promise).rejects.toThrow("Ctrl+C");
    expect(input.rawModeCalls).toEqual([true, false]);
    expect(input.hasActiveDataListener()).toBe(false);
    expect(input.pauseCallCount).toBe(1);
  });

  it("Ctrl+C: a senha parcialmente digitada nunca aparece na mensagem de erro nem na saída", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("s", "e", "n", "h", "a", "-", "p", "a", "r", "c", "i", "a", "l", "\u0003");

    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).not.toContain("senha-parcial");
    expect(output.all()).not.toContain("senha-parcial");
  });

  it("EOF real do stream (evento 'end', não Ctrl+D): raw mode restaurado, promise rejeitada", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("a", "b");
    input.emitEnd();

    await expect(promise).rejects.toThrow("EOF");
    expect(input.rawModeCalls).toEqual([true, false]);
  });

  it("erro no stream (evento 'error'): raw mode restaurado, promise rejeitada com o erro original", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();
    const streamError = new Error("falha simulada de stream");

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.emitError(streamError);

    await expect(promise).rejects.toThrow("falha simulada de stream");
    expect(input.rawModeCalls).toEqual([true, false]);
  });

  it("erro inesperado durante processamento de um chunk: raw mode restaurado, nunca pendura o listener", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    const brokenChunk = {
      toString: () => {
        throw new Error("falha simulada ao decodificar chunk");
      }
    } as unknown as Buffer;
    input.pushRawChunk(brokenChunk);

    await expect(promise).rejects.toThrow("falha simulada ao decodificar chunk");
    expect(input.rawModeCalls).toEqual([true, false]);
  });

  it("SIGINT genuíno de processo (não tecla): raw mode restaurado, promise rejeitada, sem processo pendurado", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    expect(signals.hasActiveSigintListener()).toBe(true);

    input.pushKeystrokes("a", "b");
    signals.emitSigint();

    await expect(promise).rejects.toThrow("SIGINT");
    expect(input.rawModeCalls).toEqual([true, false]);
    expect(signals.hasActiveSigintListener()).toBe(false);
  });

  it("o listener de SIGINT é removido também no caminho de sucesso — nunca vaza para fora da janela de leitura", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    expect(signals.hasActiveSigintListener()).toBe(true);
    input.pushKeystrokes("o", "k", "\n");
    await promise;

    expect(signals.hasActiveSigintListener()).toBe(false);
  });

  it("cleanup é idempotente: eventos simulados após o assentamento não têm efeito observável adicional", async () => {
    const input = new FakeTtyInputStream();
    const output = new FakeOutputStream();
    const signals = new FakeProcessSignals();

    const promise = readHiddenLineFrom("Senha: ", input, output, signals);
    input.pushKeystrokes("x", "\n");
    await promise;

    expect(() => input.emitEnd()).not.toThrow();
    expect(() => signals.emitSigint()).not.toThrow();
    expect(input.rawModeCalls).toEqual([true, false]); // nunca chamado uma terceira vez
  });
});

describe("bootstrap-first-credential CLI — readHiddenLine (wrapper de produção)", () => {
  it("readHiddenLine (não injetado) rejeita imediatamente fora de um TTY real — mesmo comportamento do núcleo testável", async () => {
    const mod = await import("../bootstrap-first-credential.js");
    await expect(mod.readHiddenLine("Senha: ")).rejects.toThrow("TTY");
  });
});
