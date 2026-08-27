import { describe, it, expect, vi } from "vitest";
import { runBootstrapCli, maskCpf, maskEmail, type BootstrapCliDependencies, type BootstrapCliInput } from "../bootstrap-first-identity.js";
import { BootstrapAlreadyCompletedError, BootstrapLockNotAcquiredError } from "../../modules/identity/application/errors/BootstrapErrors.js";

const VALID_INPUT: BootstrapCliInput = { fullName: "Fundador da Plataforma", email: "fundador@example.com" };

function makeDeps(overrides: Partial<BootstrapCliDependencies> = {}): { deps: BootstrapCliDependencies; logs: string[]; errorLogs: string[] } {
  const logs: string[] = [];
  const errorLogs: string[] = [];
  const deps: BootstrapCliDependencies = {
    nodeEnv: "development",
    collectInput: async () => VALID_INPUT,
    confirm: async () => "BOOTSTRAP",
    service: { execute: vi.fn().mockResolvedValue({ publicId: "11111111-1111-1111-1111-111111111111", status: "PENDING", loginEnabled: false }) },
    log: (line) => logs.push(line),
    logError: (line) => errorLogs.push(line),
    ...overrides
  };
  return { deps, logs, errorLogs };
}

describe("maskEmail", () => {
  it("mostra só o primeiro caractere da parte local + domínio completo — nunca o e-mail completo", () => {
    expect(maskEmail("fundador@example.com")).toBe("f***@example.com");
    expect(maskEmail("a@pctec.com.br")).toBe("a***@pctec.com.br");
  });

  it("é determinístico — o mesmo e-mail sempre produz a mesma máscara", () => {
    expect(maskEmail("fundador@example.com")).toBe(maskEmail("fundador@example.com"));
  });

  it("nunca inclui a parte local completa na saída mascarada", () => {
    const masked = maskEmail("fundador@example.com");
    expect(masked).not.toContain("fundador");
  });
});

describe("maskCpf", () => {
  it("mostra somente os 2 últimos dígitos, nunca o CPF completo", () => {
    expect(maskCpf("52998224725")).toBe("***.***.**25");
    expect(maskCpf("529.982.247-25")).toBe("***.***.**25");
  });

  it("nunca inclui os dígitos completos originais na saída mascarada", () => {
    const masked = maskCpf("52998224725");
    expect(masked).not.toContain("529982247");
  });
});

describe("runBootstrapCli — e-mail nunca aparece completo em stdout/stderr (hardening)", () => {
  const FULL_EMAIL = "fundador-completo@example.com";

  it("sucesso: e-mail completo nunca aparece em nenhuma linha de log — só a versão mascarada", async () => {
    const { deps, logs, errorLogs } = makeDeps({
      collectInput: async () => ({ ...VALID_INPUT, email: FULL_EMAIL })
    });

    const exitCode = await runBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n");

    expect(exitCode).toBe(0);
    expect(output).not.toContain(FULL_EMAIL);
    expect(output).toContain(maskEmail(FULL_EMAIL));
  });

  it("cancelamento: e-mail completo nunca aparece (mostrado na confirmação, mas já mascarado)", async () => {
    const { deps, logs, errorLogs } = makeDeps({
      collectInput: async () => ({ ...VALID_INPUT, email: FULL_EMAIL }),
      confirm: async () => "não"
    });

    await runBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n");

    expect(output).not.toContain(FULL_EMAIL);
  });

  it("erro do serviço: e-mail completo nunca aparece na saída de erro", async () => {
    const { deps, logs, errorLogs } = makeDeps({
      collectInput: async () => ({ ...VALID_INPUT, email: FULL_EMAIL }),
      service: { execute: vi.fn().mockRejectedValue(new Error("falha simulada")) }
    });

    await runBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n");

    expect(output).not.toContain(FULL_EMAIL);
  });

  it("recusa de produção: e-mail nunca é sequer coletado, então nunca pode vazar", async () => {
    const { deps, logs, errorLogs } = makeDeps({
      nodeEnv: "production",
      collectInput: async () => ({ ...VALID_INPUT, email: FULL_EMAIL })
    });

    await runBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n");

    expect(output).not.toContain(FULL_EMAIL);
  });
});

describe("runBootstrapCli — gate de ambiente (19.)", () => {
  it("recusa NODE_ENV=production SEM autorização temporária, exit 2, nunca coleta input nem chama o serviço", async () => {
    // v1.0 (ADR-027): produção deixou de ser proibida em absoluto e
    // passou a exigir cerimônia. Sem a autorização temporária, o
    // resultado observável é o mesmo de antes — recusa com exit 2, antes
    // de qualquer coleta de dado ou conexão de escrita.
    const { deps, errorLogs } = makeDeps({ nodeEnv: "production" });
    const collectInputSpy = vi.spyOn(deps, "collectInput" as never);

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(2);
    expect(errorLogs.join("\n")).toContain("INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP");
    expect(deps.service.execute).not.toHaveBeenCalled();
    expect(collectInputSpy).not.toHaveBeenCalled();
  });

  it("recusa qualquer NODE_ENV fora de development/test (ex.: staging, ou ausente/vazio)", async () => {
    const { deps: depsStaging } = makeDeps({ nodeEnv: "staging" });
    expect(await runBootstrapCli(depsStaging)).toBe(2);

    const { deps: depsEmpty } = makeDeps({ nodeEnv: "" });
    expect(await runBootstrapCli(depsEmpty)).toBe(2);
  });

  it("permite development e test", async () => {
    const { deps: depsDev } = makeDeps({ nodeEnv: "development" });
    expect(await runBootstrapCli(depsDev)).toBe(0);

    const { deps: depsTest } = makeDeps({ nodeEnv: "test" });
    expect(await runBootstrapCli(depsTest)).toBe(0);
  });
});

describe("runBootstrapCli — confirmação explícita (18.)", () => {
  it("cancela sem qualquer chamada ao serviço quando a confirmação não é exatamente 'BOOTSTRAP'", async () => {
    const { deps, logs } = makeDeps({ confirm: async () => "" }); // Enter simples

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(deps.service.execute).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Cancelado");
  });

  it("cancela com qualquer texto diferente de 'BOOTSTRAP' (não aceita variações/case-insensitive)", async () => {
    const { deps: depsYes } = makeDeps({ confirm: async () => "yes" });
    expect(await runBootstrapCli(depsYes)).toBe(1);
    expect(depsYes.service.execute).not.toHaveBeenCalled();

    const { deps: depsLower } = makeDeps({ confirm: async () => "bootstrap" });
    expect(await runBootstrapCli(depsLower)).toBe(1);
    expect(depsLower.service.execute).not.toHaveBeenCalled();
  });

  it("prossegue quando a confirmação é exatamente 'BOOTSTRAP'", async () => {
    const { deps } = makeDeps({ confirm: async () => "BOOTSTRAP" });

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(0);
    expect(deps.service.execute).toHaveBeenCalledTimes(1);
  });
});

describe("runBootstrapCli — entrada inválida", () => {
  it("entrada inválida/cancelada (collectInput lança) nunca chega a pedir confirmação nem chamar o serviço", async () => {
    const { deps, errorLogs } = makeDeps({
      collectInput: async () => {
        throw new Error("fullName e email são obrigatórios.");
      }
    });
    const confirmSpy = vi.spyOn(deps, "confirm" as never);

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(deps.service.execute).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(errorLogs.join("\n")).not.toMatch(/at\s+\S+\.ts:\d+/); // sem stack trace
  });
});

describe("runBootstrapCli — sucesso e saída sanitizada (16., 20., 21.)", () => {
  it("sucesso: exit 0, mostra publicId/status/loginEnabled, nunca internalId/CPF completo/senha", async () => {
    const { deps, logs } = makeDeps({
      collectInput: async () => ({ ...VALID_INPUT, cpf: "52998224725" })
    });

    const exitCode = await runBootstrapCli(deps);
    const output = logs.join("\n");

    expect(exitCode).toBe(0);
    expect(output).toContain("11111111-1111-1111-1111-111111111111");
    expect(output).toContain("PENDING");
    expect(output).toContain("loginEnabled: false");
    expect(output).not.toContain("52998224725"); // CPF completo nunca aparece
    expect(output).toContain("***.***.**25"); // só a versão mascarada
  });

  it("20. nunca vaza CPF completo, mesmo em cancelamento (a confirmação já mostra a versão mascarada)", async () => {
    const { deps, logs } = makeDeps({
      collectInput: async () => ({ ...VALID_INPUT, cpf: "52998224725" }),
      confirm: async () => "não"
    });

    await runBootstrapCli(deps);
    const output = logs.join("\n");

    expect(output).not.toContain("52998224725");
  });

  it("21. nunca vaza DB_PASSWORD ou qualquer variável de ambiente — o CLI não tem acesso a env, só a nodeEnv (string simples)", async () => {
    const { deps, logs, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(new Error("ER_ACCESS_DENIED for user 'x'@'y' (using password: YES) DB_PASSWORD=segredo123")) }
    });

    await runBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n");

    // O CLI nunca ecoa a mensagem crua do erro — só uma mensagem genérica sanitizada.
    expect(output).not.toContain("segredo123");
    expect(output).not.toContain("DB_PASSWORD");
  });
});

describe("runBootstrapCli — erros do serviço mapeados corretamente", () => {
  it("BootstrapAlreadyCompletedError → exit code 1, mensagem clara, nunca stack", async () => {
    const { deps, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(new BootstrapAlreadyCompletedError()) }
    });

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(errorLogs.join("\n")).toContain("já foi concluído");
  });

  it("BootstrapLockNotAcquiredError → exit code 3, distinto de 'já concluído'", async () => {
    const { deps, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(new BootstrapLockNotAcquiredError("pctec_ingressa_identity_bootstrap", 10)) }
    });

    const exitCode = await runBootstrapCli(deps);

    expect(exitCode).toBe(3);
    expect(errorLogs.join("\n")).toContain("execução");
    expect(errorLogs.join("\n")).not.toContain("já foi concluído");
  });

  it("25. erro genérico inesperado nunca vaza SQL/stack/driver — mensagem sempre sanitizada", async () => {
    const { deps, errorLogs } = makeDeps({
      service: {
        execute: vi.fn().mockRejectedValue(new Error("SELECT * FROM identities WHERE ... at MariaDbIdentityRepository.ts:42"))
      }
    });

    const exitCode = await runBootstrapCli(deps);
    const output = errorLogs.join("\n");

    expect(exitCode).toBe(1);
    expect(output).not.toContain("SELECT");
    expect(output).not.toContain("MariaDbIdentityRepository.ts");
  });
});
