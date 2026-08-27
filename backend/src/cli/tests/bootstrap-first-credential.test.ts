import { describe, it, expect, vi } from "vitest";
import {
  runCredentialBootstrapCli,
  maskEmail,
  type CredentialCliDependencies,
  type CredentialCliInput
} from "../bootstrap-first-credential.js";
import {
  CredentialBootstrapAlreadyCompletedError,
  CredentialLockNotAcquiredError
} from "../../modules/security/application/errors/CredentialBootstrapErrors.js";
import { CredentialPasswordPolicyViolationError } from "../../modules/security/domain/value-objects/PlainPassword.js";

const VALID_INPUT: CredentialCliInput = {
  identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
  plainPassword: "senha-valida-123456",
  plainPasswordConfirmation: "senha-valida-123456"
};
const VALID_IDENTITY_SUMMARY = { publicId: VALID_INPUT.identityPublicId, status: "PENDING", maskedEmail: "f***@example.com" };

function makeDeps(overrides: Partial<CredentialCliDependencies> = {}): {
  deps: CredentialCliDependencies;
  logs: string[];
  errorLogs: string[];
} {
  const logs: string[] = [];
  const errorLogs: string[] = [];
  const deps: CredentialCliDependencies = {
    nodeEnv: "development",
    collectInput: async () => VALID_INPUT,
    findIdentity: async () => VALID_IDENTITY_SUMMARY,
    confirm: async () => "CREATE_CREDENTIAL",
    service: {
      execute: vi.fn().mockResolvedValue({
        credentialPublicId: "22222222-2222-2222-2222-222222222222",
        identityPublicId: VALID_INPUT.identityPublicId,
        credentialType: "LOCAL_PASSWORD",
        identityStatus: "ACTIVE",
        loginEnabled: true
      })
    },
    log: (line) => logs.push(line),
    logError: (line) => errorLogs.push(line),
    ...overrides
  };
  return { deps, logs, errorLogs };
}

describe("maskEmail (CLI de bootstrap de credencial)", () => {
  it("mostra só o primeiro caractere da parte local + domínio completo — nunca o e-mail completo", () => {
    expect(maskEmail("fundador@example.com")).toBe("f***@example.com");
  });
});

describe("runCredentialBootstrapCli — sucesso", () => {
  it("cria com sucesso e imprime exatamente os campos exigidos", async () => {
    const { deps, logs } = makeDeps();

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("Credential criada.");
    expect(output).toContain(`identityPublicId: ${VALID_INPUT.identityPublicId}`);
    expect(output).toContain("credentialType: LOCAL_PASSWORD");
    expect(output).toContain("identityStatus: ACTIVE");
    expect(output).toContain("loginEnabled: true");
  });

  it("chama o serviço com o identityPublicId informado pelo operador — nunca hardcoded", async () => {
    const executeSpy = vi.fn().mockResolvedValue({
      credentialPublicId: "x",
      identityPublicId: "outro-id",
      credentialType: "LOCAL_PASSWORD",
      identityStatus: "ACTIVE",
      loginEnabled: true
    });
    const { deps } = makeDeps({
      collectInput: async () => ({ identityPublicId: "outro-id", plainPassword: "senha-valida-123456", plainPasswordConfirmation: "senha-valida-123456" }),
      findIdentity: async () => ({ publicId: "outro-id", status: "PENDING", maskedEmail: "o***@x.com" }),
      service: { execute: executeSpy }
    });

    await runCredentialBootstrapCli(deps);

    expect(executeSpy).toHaveBeenCalledWith({
      identityPublicId: "outro-id",
      plainPassword: "senha-valida-123456",
      plainPasswordConfirmation: "senha-valida-123456"
    });
  });
});

describe("runCredentialBootstrapCli — 36. cancelamento sem CREATE_CREDENTIAL", () => {
  it("qualquer confirmação diferente de 'CREATE_CREDENTIAL' cancela, sem chamar o serviço", async () => {
    const executeSpy = vi.fn();
    const { deps, logs } = makeDeps({ confirm: async () => "sim", service: { execute: executeSpy } });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Cancelado");
  });

  it("string vazia também cancela", async () => {
    const executeSpy = vi.fn();
    const { deps } = makeDeps({ confirm: async () => "", service: { execute: executeSpy } });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("'create_credential' em minúsculas NÃO confirma (comparação exata, case-sensitive)", async () => {
    const executeSpy = vi.fn();
    const { deps } = makeDeps({ confirm: async () => "create_credential", service: { execute: executeSpy } });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });
});

describe("runCredentialBootstrapCli — 37. recusa production", () => {
  it("NODE_ENV=production é recusado com exit code 2, antes de coletar qualquer entrada", async () => {
    const collectInputSpy = vi.fn();
    const { deps, errorLogs } = makeDeps({ nodeEnv: "production", collectInput: collectInputSpy });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(2);
    expect(collectInputSpy).not.toHaveBeenCalled();
    // v1.0 (ADR-027): produção exige cerimônia. Sem autorização temporária,
    // a recusa continua sendo exit 2, antes de qualquer coleta ou escrita.
    expect(errorLogs.join("\n")).toContain("INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP");
  });

  it("NODE_ENV=development e test são permitidos", async () => {
    const { deps: devDeps } = makeDeps({ nodeEnv: "development" });
    const { deps: testDeps } = makeDeps({ nodeEnv: "test" });

    expect(await runCredentialBootstrapCli(devDeps)).toBe(0);
    expect(await runCredentialBootstrapCli(testDeps)).toBe(0);
  });
});

describe("runCredentialBootstrapCli — erros do serviço", () => {
  it("CREDENTIAL_BOOTSTRAP_ALREADY_COMPLETED retorna exit code 1 com mensagem clara", async () => {
    const { deps, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(new CredentialBootstrapAlreadyCompletedError()) }
    });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(errorLogs.join("\n")).toContain("já foi realizado anteriormente");
  });

  it("CREDENTIAL_LOCK_NOT_ACQUIRED retorna exit code 3, distinto de 'já concluído'", async () => {
    const { deps, errorLogs } = makeDeps({
      service: {
        execute: vi.fn().mockRejectedValue(new CredentialLockNotAcquiredError("pctec_ingressa_credential_bootstrap", 10))
      }
    });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(3);
    expect(errorLogs.join("\n")).toContain("lock");
  });

  it("CREDENTIAL_PASSWORD_POLICY_VIOLATION retorna exit code 1, sem ecoar a senha", async () => {
    const { deps, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(new CredentialPasswordPolicyViolationError("comprimento mínimo")) }
    });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(errorLogs.join("\n")).toContain("política mínima");
  });

  it("Identity não encontrada na etapa de exibição prévia cancela com exit code 1, sem chamar o serviço", async () => {
    const executeSpy = vi.fn();
    const { deps, errorLogs } = makeDeps({
      findIdentity: async () => {
        throw new Error("não encontrada");
      },
      service: { execute: executeSpy }
    });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(errorLogs.join("\n")).toContain("não encontrada");
  });

  it("erro inesperado do serviço nunca vaza mensagem de driver/SQL/stack/senha", async () => {
    const { deps, errorLogs } = makeDeps({
      service: {
        execute: vi
          .fn()
          .mockRejectedValue(new Error(`ER_ACCESS_DENIED: senha=${VALID_INPUT.plainPassword} host=db.internal`))
      }
    });

    const exitCode = await runCredentialBootstrapCli(deps);

    expect(exitCode).toBe(1);
    const output = errorLogs.join("\n");
    expect(output).not.toContain("ER_ACCESS_DENIED");
    expect(output).not.toContain("db.internal");
    expect(output).not.toContain(VALID_INPUT.plainPassword);
  });
});

describe("runCredentialBootstrapCli — 38/39. senha nunca aparece em stdout/stderr", () => {
  it("sucesso: a senha em texto puro nunca aparece em nenhuma linha de log (stdout)", async () => {
    const { deps, logs } = makeDeps();

    await runCredentialBootstrapCli(deps);

    expect(logs.join("\n")).not.toContain(VALID_INPUT.plainPassword);
  });

  it("erro: a senha em texto puro nunca aparece em nenhuma linha de erro (stderr)", async () => {
    const { deps, errorLogs } = makeDeps({
      service: { execute: vi.fn().mockRejectedValue(new Error("falha qualquer")) }
    });

    await runCredentialBootstrapCli(deps);

    expect(errorLogs.join("\n")).not.toContain(VALID_INPUT.plainPassword);
  });

  it("nunca imprime internalId, CPF, SQL, DB_PASSWORD, hash ou stack trace", async () => {
    const { deps, logs, errorLogs } = makeDeps();

    await runCredentialBootstrapCli(deps);
    const output = [...logs, ...errorLogs].join("\n").toUpperCase();

    expect(output).not.toContain("INTERNALID");
    expect(output).not.toContain("CPF");
    expect(output).not.toContain("SELECT ");
    expect(output).not.toContain("INSERT INTO");
    expect(output).not.toContain("DB_PASSWORD");
    expect(output).not.toContain("$ARGON2ID$");
    expect(output).not.toContain("AT MODULE.");
  });
});

describe("runCredentialBootstrapCli — 40. senha nunca aceita via argv (garantia estrutural)", () => {
  it("collectInput é a única fonte de senha — a função não lê process.argv em nenhum momento", async () => {
    const originalArgv = process.argv;
    try {
      // Mesmo que argv contenha algo parecido com uma senha, o CLI
      // nunca a lê de lá — só de `collectInput` (stdin interativo real).
      process.argv = [...originalArgv, "--password=senha-vazando-via-argv"];
      const { deps, logs, errorLogs } = makeDeps();

      await runCredentialBootstrapCli(deps);

      expect([...logs, ...errorLogs].join("\n")).not.toContain("senha-vazando-via-argv");
    } finally {
      process.argv = originalArgv;
    }
  });
});

describe("runCredentialBootstrapCli — exibição prévia", () => {
  it("mostra identityPublicId, e-mail mascarado, status atual e as três ações antes de confirmar", async () => {
    const { deps, logs } = makeDeps();

    await runCredentialBootstrapCli(deps);
    const output = logs.join("\n");

    expect(output).toContain(VALID_IDENTITY_SUMMARY.publicId);
    expect(output).toContain(VALID_IDENTITY_SUMMARY.maskedEmail);
    expect(output).toContain(VALID_IDENTITY_SUMMARY.status);
    expect(output).toContain("LOCAL_PASSWORD");
    expect(output.toLowerCase()).toContain("ativar");
    expect(output.toLowerCase()).toContain("login");
  });
});
