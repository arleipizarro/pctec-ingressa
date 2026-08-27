import { describe, it, expect, vi } from "vitest";
import {
  runAdminAccessBootstrapCli,
  maskEmail,
  type AdminAccessCliDependencies,
  type AdminAccessCliInput
} from "../bootstrap-first-admin-access.js";
import {
  ApplicationAccessBootstrapAlreadyCompletedError,
  ApplicationAccessLockNotAcquiredError
} from "../../modules/application/application/errors/ApplicationAccessBootstrapErrors.js";

const VALID_INPUT: AdminAccessCliInput = { identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec" };
const VALID_IDENTITY_SUMMARY = { publicId: VALID_INPUT.identityPublicId, status: "PENDING", maskedEmail: "f***@example.com" };

function makeDeps(overrides: Partial<AdminAccessCliDependencies> = {}): {
  deps: AdminAccessCliDependencies;
  logs: string[];
  errorLogs: string[];
} {
  const logs: string[] = [];
  const errorLogs: string[] = [];
  const deps: AdminAccessCliDependencies = {
    nodeEnv: "development",
    collectInput: async () => VALID_INPUT,
    findIdentity: async () => VALID_IDENTITY_SUMMARY,
    confirm: async () => "GRANT_ADMIN",
    service: {
      execute: vi.fn().mockResolvedValue({
        applicationAccessPublicId: "22222222-2222-2222-2222-222222222222",
        identityPublicId: VALID_INPUT.identityPublicId,
        applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
        accessProfile: "ADMIN"
      })
    },
    log: (line) => logs.push(line),
    logError: (line) => errorLogs.push(line),
    ...overrides
  };
  return { deps, logs, errorLogs };
}

describe("maskEmail (CLI de acesso administrativo)", () => {
  it("mostra só o primeiro caractere da parte local + domínio completo — nunca o e-mail completo", () => {
    expect(maskEmail("fundador@example.com")).toBe("f***@example.com");
  });
});

describe("runAdminAccessBootstrapCli — sucesso", () => {
  it("concede com sucesso e imprime exatamente os campos exigidos (seção 19 da task)", async () => {
    const { deps, logs } = makeDeps();

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("Acesso administrativo concedido.");
    expect(output).toContain(`identityPublicId: ${VALID_INPUT.identityPublicId}`);
    expect(output).toContain("application: PCTEC_INGRESSA");
    expect(output).toContain("profile: ADMIN");
  });

  it("chama o serviço com o identityPublicId informado pelo operador — nunca hardcoded", async () => {
    const executeSpy = vi.fn().mockResolvedValue({
      applicationAccessPublicId: "x",
      identityPublicId: "outro-id",
      applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      accessProfile: "ADMIN"
    });
    const { deps } = makeDeps({
      collectInput: async () => ({ identityPublicId: "outro-id" }),
      findIdentity: async () => ({ publicId: "outro-id", status: "PENDING", maskedEmail: "o***@x.com" }),
      service: { execute: executeSpy }
    });

    await runAdminAccessBootstrapCli(deps);

    expect(executeSpy).toHaveBeenCalledWith({ identityPublicId: "outro-id" });
  });
});

describe("runAdminAccessBootstrapCli — 24. cancela sem GRANT_ADMIN", () => {
  it("qualquer confirmação diferente de 'GRANT_ADMIN' cancela, sem chamar o serviço", async () => {
    const executeSpy = vi.fn();
    const { deps, logs } = makeDeps({ confirm: async () => "sim", service: { execute: executeSpy } });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Cancelado");
  });

  it("string vazia também cancela", async () => {
    const executeSpy = vi.fn();
    const { deps } = makeDeps({ confirm: async () => "", service: { execute: executeSpy } });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("'grant_admin' em minúsculas NÃO confirma (comparação exata, case-sensitive)", async () => {
    const executeSpy = vi.fn();
    const { deps } = makeDeps({ confirm: async () => "grant_admin", service: { execute: executeSpy } });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });
});

describe("runAdminAccessBootstrapCli — 25. recusa production", () => {
  it("NODE_ENV=production é recusado com exit code 2, antes de coletar qualquer entrada", async () => {
    const collectInputSpy = vi.fn();
    const { deps, errorLogs } = makeDeps({ nodeEnv: "production", collectInput: collectInputSpy });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(2);
    expect(collectInputSpy).not.toHaveBeenCalled();
    // v1.0 (ADR-027): produção exige cerimônia. Sem autorização temporária,
    // a recusa continua sendo exit 2, antes de qualquer coleta ou escrita.
    expect(errorLogs.join("\n")).toContain("INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP");
  });

  it("NODE_ENV=development e test são permitidos", async () => {
    const { deps: devDeps } = makeDeps({ nodeEnv: "development" });
    const { deps: testDeps } = makeDeps({ nodeEnv: "test" });

    expect(await runAdminAccessBootstrapCli(devDeps)).toBe(0);
    expect(await runAdminAccessBootstrapCli(testDeps)).toBe(0);
  });
});

describe("runAdminAccessBootstrapCli — erros do serviço", () => {
  it("BOOTSTRAP_ALREADY_COMPLETED retorna exit code 1 com mensagem clara", async () => {
    const { deps, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(new ApplicationAccessBootstrapAlreadyCompletedError()) }
    });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(errorLogs.join("\n")).toContain("já foi realizada anteriormente");
  });

  it("LOCK_NOT_ACQUIRED retorna exit code 3, distinto de 'já concluído'", async () => {
    const { deps, errorLogs } = makeDeps({
      service: {
        execute: vi.fn().mockRejectedValue(new ApplicationAccessLockNotAcquiredError("pctec_ingressa_application_access_bootstrap", 10))
      }
    });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(3);
    expect(errorLogs.join("\n")).toContain("lock");
  });

  it("Identity não encontrada na etapa de exibição prévia cancela com exit code 1, sem chamar o serviço", async () => {
    const executeSpy = vi.fn();
    const { deps, errorLogs } = makeDeps({
      findIdentity: async () => {
        throw new Error("não encontrada");
      },
      service: { execute: executeSpy }
    });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(errorLogs.join("\n")).toContain("não encontrada");
  });

  it("erro inesperado do serviço nunca vaza mensagem de driver/SQL/stack", async () => {
    const { deps, errorLogs } = makeDeps({
      service: {
        execute: vi.fn().mockRejectedValue(new Error("ER_ACCESS_DENIED_ERROR: senha incorreta em host=db.internal"))
      }
    });

    const exitCode = await runAdminAccessBootstrapCli(deps);

    expect(exitCode).toBe(1);
    const output = errorLogs.join("\n");
    expect(output).not.toContain("ER_ACCESS_DENIED_ERROR");
    expect(output).not.toContain("db.internal");
  });
});

describe("runAdminAccessBootstrapCli — 26. nunca vaza dados sensíveis", () => {
  const FULL_EMAIL = "fundador-completo@example.com";

  it("sucesso: e-mail completo nunca aparece em nenhuma linha de log — só a versão mascarada", async () => {
    const { deps, logs, errorLogs } = makeDeps({
      findIdentity: async () => ({ publicId: VALID_INPUT.identityPublicId, status: "PENDING", maskedEmail: maskEmail(FULL_EMAIL) })
    });

    await runAdminAccessBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n");

    expect(output).not.toContain(FULL_EMAIL);
    expect(output).toContain(maskEmail(FULL_EMAIL));
  });

  it("nunca imprime internalId, CPF, SQL, DB_PASSWORD ou stack trace", async () => {
    const { deps, logs, errorLogs } = makeDeps();

    await runAdminAccessBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n").toUpperCase();

    expect(output).not.toContain("INTERNALID");
    expect(output).not.toContain("CPF");
    expect(output).not.toContain("SELECT ");
    expect(output).not.toContain("INSERT INTO");
    expect(output).not.toContain("DB_PASSWORD");
    expect(output).not.toContain("AT MODULE.");
  });

  it("erro inesperado: nenhum stack trace é impresso", async () => {
    const errorWithStack = new Error("falha interna");
    const { deps, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(errorWithStack) }
    });

    await runAdminAccessBootstrapCli(deps);
    const output = errorLogs.join("\n");

    expect(output).not.toContain(errorWithStack.stack ?? "__STACK__");
    expect(output).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
