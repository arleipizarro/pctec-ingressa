import { describe, expect, it, vi } from "vitest";

import {
  PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE,
  PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE,
  buildProductionConfirmationPhrase,
  normalizeConfirmation,
  resolveBootstrapCeremony,
  type ProductionBootstrapContext
} from "../productionBootstrapGuard.js";
import { runBootstrapCli, type BootstrapCliDependencies } from "../bootstrap-first-identity.js";

const PRODUCAO_AUTORIZADA: ProductionBootstrapContext = {
  nodeEnv: "production",
  authorization: PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE,
  databaseName: "pctec_ingressa",
  hostname: "servidor-de-producao",
  interactive: true
};

describe("resolveBootstrapCeremony — ambientes que não são produção", () => {
  it.each(["development", "test"])("em %s usa a frase base e não exibe preâmbulo", (nodeEnv) => {
    const ceremony = resolveBootstrapCeremony("BOOTSTRAP", {
      ...PRODUCAO_AUTORIZADA,
      nodeEnv,
      authorization: undefined,
      interactive: false
    });

    expect(ceremony.allowed).toBe(true);
    if (ceremony.allowed) {
      expect(ceremony.confirmationPhrase).toBe("BOOTSTRAP");
      expect(ceremony.preamble).toEqual([]);
    }
  });

  it("recusa NODE_ENV desconhecido — nunca tratado como desenvolvimento", () => {
    const ceremony = resolveBootstrapCeremony("BOOTSTRAP", { ...PRODUCAO_AUTORIZADA, nodeEnv: "staging" });

    expect(ceremony.allowed).toBe(false);
    if (!ceremony.allowed) {
      expect(ceremony.exitCode).toBe(2);
    }
  });
});

describe("resolveBootstrapCeremony — produção é fail-closed em cada barreira", () => {
  it("recusa sem autorização temporária, nomeando a variável a exportar", () => {
    const ceremony = resolveBootstrapCeremony("BOOTSTRAP", { ...PRODUCAO_AUTORIZADA, authorization: undefined });

    expect(ceremony.allowed).toBe(false);
    if (!ceremony.allowed) {
      expect(ceremony.exitCode).toBe(2);
      expect(ceremony.message).toContain(PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE);
      expect(ceremony.message).toContain("NUNCA no .env");
    }
  });

  it.each(["yes", "Yes", "1", "true", "sim", "", " YES "])(
    "recusa autorização com valor %o — só o valor exato vale",
    (valor) => {
      const ceremony = resolveBootstrapCeremony("BOOTSTRAP", { ...PRODUCAO_AUTORIZADA, authorization: valor });

      expect(ceremony.allowed).toBe(false);
    }
  );

  it("recusa execução não interativa mesmo com autorização válida", () => {
    const ceremony = resolveBootstrapCeremony("BOOTSTRAP", { ...PRODUCAO_AUTORIZADA, interactive: false });

    expect(ceremony.allowed).toBe(false);
    if (!ceremony.allowed) {
      expect(ceremony.exitCode).toBe(2);
      expect(ceremony.message).toContain("TTY");
    }
  });

  it.each([
    ["database", { databaseName: "" }],
    ["hostname", { hostname: "   " }]
  ])("recusa quando %s não pode ser determinado", (_rotulo, patch) => {
    const ceremony = resolveBootstrapCeremony("BOOTSTRAP", { ...PRODUCAO_AUTORIZADA, ...patch });

    expect(ceremony.allowed).toBe(false);
  });
});

describe("resolveBootstrapCeremony — frase de produção nomeia o alvo", () => {
  it("exige PRODUCTION, a frase base, o database e o hostname", () => {
    const ceremony = resolveBootstrapCeremony("BOOTSTRAP", PRODUCAO_AUTORIZADA);

    expect(ceremony.allowed).toBe(true);
    if (ceremony.allowed) {
      expect(ceremony.confirmationPhrase).toBe("PRODUCTION BOOTSTRAP pctec_ingressa servidor-de-producao");
      expect(ceremony.preamble.join("\n")).toContain("pctec_ingressa");
      expect(ceremony.preamble.join("\n")).toContain("servidor-de-producao");
    }
  });

  it("uma frase montada com outro database NÃO coincide — protege contra .env do ambiente errado", () => {
    const ceremony = resolveBootstrapCeremony("BOOTSTRAP", PRODUCAO_AUTORIZADA);
    const fraseDoOutroBanco = buildProductionConfirmationPhrase(
      "BOOTSTRAP",
      "pctec_ingressa_dev",
      "servidor-de-producao"
    );

    expect(ceremony.allowed).toBe(true);
    if (ceremony.allowed) {
      expect(fraseDoOutroBanco).not.toBe(ceremony.confirmationPhrase);
    }
  });

  it("normalização tolera espaço extra, mas nunca palavra diferente", () => {
    expect(normalizeConfirmation("  PRODUCTION   BOOTSTRAP  db   host ")).toBe("PRODUCTION BOOTSTRAP db host");
    expect(normalizeConfirmation("PRODUCTION BOOTSTRAP db outro")).not.toBe("PRODUCTION BOOTSTRAP db host");
  });
});

describe("bootstrap-first-identity em produção — cerimônia ponta a ponta", () => {
  function makeDeps(overrides: Partial<BootstrapCliDependencies> = {}): {
    deps: BootstrapCliDependencies;
    logs: string[];
    errorLogs: string[];
  } {
    const logs: string[] = [];
    const errorLogs: string[] = [];
    const deps: BootstrapCliDependencies = {
      nodeEnv: "production",
      authorization: PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE,
      databaseName: "pctec_ingressa",
      hostname: "servidor-de-producao",
      interactive: true,
      collectInput: async () => ({ fullName: "Fulana Fundacional", email: "fulana@exemplo.invalid" }),
      confirm: async (phrase: string) => phrase,
      service: {
        execute: vi.fn().mockResolvedValue({ publicId: "id-1", status: "ACTIVE", loginEnabled: false })
      },
      log: (line) => logs.push(line),
      logError: (line) => errorLogs.push(line),
      ...overrides
    };
    return { deps, logs, errorLogs };
  }

  it("com autorização, TTY e frase correta, chega ao serviço oficial", async () => {
    const { deps, logs } = makeDeps();

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(0);
    expect(deps.service.execute).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain("*** AMBIENTE DE PRODUÇÃO ***");
    expect(logs.join("\n")).toContain("pctec_ingressa");
  });

  it("cancela sem escrever quando a frase digitada nomeia outro database", async () => {
    const { deps } = makeDeps({
      confirm: async () => buildProductionConfirmationPhrase("BOOTSTRAP", "pctec_ingressa_dev", "servidor-de-producao")
    });

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(deps.service.execute).not.toHaveBeenCalled();
  });

  it("cancela quando a frase é apenas a base, sem nomear o ambiente", async () => {
    const { deps } = makeDeps({ confirm: async () => "BOOTSTRAP" });

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(deps.service.execute).not.toHaveBeenCalled();
  });

  it("nunca coleta dado nem escreve quando a autorização temporária está ausente", async () => {
    const collectInput = vi.fn();
    const { deps } = makeDeps({ authorization: undefined, collectInput });

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(2);
    expect(collectInput).not.toHaveBeenCalled();
    expect(deps.service.execute).not.toHaveBeenCalled();
  });

  it("nenhuma saída do CLI ecoa a autorização, o e-mail completo ou qualquer segredo", async () => {
    const { deps, logs, errorLogs } = makeDeps();

    await runBootstrapCli(deps);
    const saida = [...logs, ...errorLogs].join("\n");

    expect(saida).not.toContain("fulana@exemplo.invalid");
    expect(saida).not.toContain(PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE);
  });
});
