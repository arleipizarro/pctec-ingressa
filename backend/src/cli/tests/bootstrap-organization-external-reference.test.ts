import { describe, it, expect, vi } from "vitest";
import {
  parseArgs,
  evaluateExternalReferenceWriteGate,
  resolveExternalReferenceProductionCeremony,
  runExternalReferenceCli,
  describeStartupFailure,
  type CliArgs,
  type ExternalReferenceCliDependencies
} from "../bootstrap-organization-external-reference.js";
import {
  PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE
} from "../productionBootstrapGuard.js";

describe("parseArgs", () => {
  it("exige organizationPublicId, systemCode, entityType, legacyId; sem flags = execute=false, actor=undefined", () => {
    expect(parseArgs(["0b13f6f0-8f3a-4a1e-9c2d-000000000001", "PCTEC_PORTAL", "clientes", "75"])).toEqual({
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: "75",
      execute: false,
      actorPublicId: undefined
    });
  });

  it("aceita entityType='clientes_grupo' (referência de rastreabilidade do grupo legado)", () => {
    const args = parseArgs(["0b13f6f0-8f3a-4a1e-9c2d-000000000001", "PCTEC_PORTAL", "clientes_grupo", "27"]);
    expect(args.entityType).toBe("clientes_grupo");
    expect(args.legacyId).toBe("27");
  });

  it("reconhece --execute e --actor", () => {
    const args = parseArgs([
      "org-1",
      "PCTEC_PORTAL",
      "clientes",
      "75",
      "--execute",
      "--actor",
      "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    ]);
    expect(args.execute).toBe(true);
    expect(args.actorPublicId).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("lança erro quando algum argumento obrigatório está ausente", () => {
    expect(() => parseArgs([])).toThrow(/Uso:/);
    expect(() => parseArgs(["org-1", "PCTEC_PORTAL"])).toThrow(/Uso:/);
    expect(() => parseArgs(["org-1", "PCTEC_PORTAL", "clientes"])).toThrow(/Uso:/);
  });

  it("lança erro se --actor não for seguido de um valor", () => {
    expect(() => parseArgs(["org-1", "PCTEC_PORTAL", "clientes", "75", "--actor"])).toThrow(/--actor exige/);
  });

  it("erro de systemCode inválido NÃO é responsabilidade de parseArgs — a validação real (PCTEC_HUB/PCTEC_HELPDESK/PCTEC_PORTAL) é feita por SystemCode dentro de CreateOrganizationExternalReferenceService, no domínio, nunca reimplementada aqui", () => {
    expect(() => parseArgs(["org-1", "SISTEMA_INVENTADO", "clientes", "75"])).not.toThrow();
    expect(parseArgs(["org-1", "SISTEMA_INVENTADO", "clientes", "75"]).systemCode).toBe("SISTEMA_INVENTADO");
  });
});

describe("evaluateExternalReferenceWriteGate — mesmo gate duplo + --actor obrigatório em execute", () => {
  const baseArgsWithActor = {
    organizationPublicId: "org-1",
    systemCode: "PCTEC_PORTAL",
    entityType: "clientes",
    legacyId: "75",
    execute: true,
    actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
  };

  it("não decide nada sobre ambiente — produção é barreira separada (cerimônia do ADR-027)", () => {
    expect(evaluateExternalReferenceWriteGate(baseArgsWithActor, { allowWriteEnvVar: true })).toEqual({
      allowed: true,
      actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    });
  });

  it("dry-run sem --actor É PERMITIDO — actor só é exigido quando execute=true", () => {
    const dryRunWithoutActor = { ...baseArgsWithActor, execute: false, actorPublicId: undefined };
    expect(
      evaluateExternalReferenceWriteGate(dryRunWithoutActor, { allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_execute_flag" });
  });

  it("execute SEM --actor -> REJEITADO com motivo próprio (missing_actor_for_execute)", () => {
    const executeWithoutActor = { ...baseArgsWithActor, actorPublicId: undefined };
    expect(
      evaluateExternalReferenceWriteGate(executeWithoutActor, { allowWriteEnvVar: true })
    ).toEqual({ allowed: false, reason: "missing_actor_for_execute" });
  });

  it("execute COM --actor, mas sem BOOTSTRAP_ALLOW_WRITE=true -> ainda bloqueado", () => {
    expect(
      evaluateExternalReferenceWriteGate(baseArgsWithActor, { allowWriteEnvVar: false })
    ).toEqual({ allowed: false, reason: "missing_env_var" });
  });

  it("execute COM --actor -> PERMITIDO quando as demais condições também são satisfeitas", () => {
    const decision = evaluateExternalReferenceWriteGate(baseArgsWithActor, { allowWriteEnvVar: true });
    expect(decision).toEqual({ allowed: true, actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099" });
  });
});

describe(
  "cerimônia de production da OrganizationExternalReference",
  () => {
    const baseContext = {
      nodeEnv: "production",
      authorization:
        PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE,
      databaseName: "pctec_ingressa",
      hostname: "servidor-producao",
      interactive: true
    };

    it("nomeia operação, database e hostname", () => {
      const ceremony =
        resolveExternalReferenceProductionCeremony(
          baseContext
        );

      expect(ceremony.allowed).toBe(true);

      if (ceremony.allowed) {
        expect(
          ceremony.confirmationPhrase
        ).toBe(
          "PRODUCTION " +
          "LINK_ORGANIZATION_EXTERNAL_REFERENCE " +
          "pctec_ingressa servidor-producao"
        );
      }
    });

    it("recusa sem autorização temporária", () => {
      const ceremony =
        resolveExternalReferenceProductionCeremony({
          ...baseContext,
          authorization: undefined
        });

      expect(ceremony.allowed).toBe(false);
    });

    it("recusa sem TTY", () => {
      const ceremony =
        resolveExternalReferenceProductionCeremony({
          ...baseContext,
          interactive: false
        });

      expect(ceremony.allowed).toBe(false);
    });
  }
);

describe("runExternalReferenceCli — barreiras de escrita ponta a ponta, sem TTY e sem banco real", () => {
  const ARGS_EXECUTE: CliArgs = {
    organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
    systemCode: "PCTEC_PORTAL",
    entityType: "clientes",
    legacyId: "75",
    execute: true,
    actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
  };

  const ARGS_DRY_RUN: CliArgs = { ...ARGS_EXECUTE, execute: false, actorPublicId: undefined };

  const PRODUCTION_PHRASE =
    "PRODUCTION LINK_ORGANIZATION_EXTERNAL_REFERENCE pctec_ingressa servidor-producao";

  /**
   * Harness controlado: `openService` é a ÚNICA porta para conexão e
   * serviço oficial, então `expect(openService).not.toHaveBeenCalled()`
   * é a asserção literal de "nenhuma conexão foi aberta".
   */
  function buildDeps(
    overrides: Partial<ExternalReferenceCliDependencies> = {}
  ): {
    deps: ExternalReferenceCliDependencies;
    openService: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    logs: string[];
    errors: string[];
  } {
    const logs: string[] = [];
    const errors: string[] = [];
    const execute = vi.fn(async () => ({
      publicId: "ref-1",
      organizationPublicId: ARGS_EXECUTE.organizationPublicId,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      status: "ACTIVE"
    }));
    const close = vi.fn(async () => undefined);
    const openService = vi.fn(() => ({ service: { execute }, close }));
    const confirm = vi.fn(async () => PRODUCTION_PHRASE);

    const deps: ExternalReferenceCliDependencies = {
      args: ARGS_EXECUTE,
      nodeEnv: "production",
      allowWriteEnvVar: true,
      authorization: PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE,
      databaseName: "pctec_ingressa",
      hostname: "servidor-producao",
      interactive: true,
      openService,
      confirm,
      log: (line) => logs.push(line),
      logError: (line) => errors.push(line),
      ...overrides
    };

    return { deps, openService, execute, close, confirm, logs, errors };
  }

  it("dry-run em production: termina antes de qualquer conexão, não pede confirmação e sai com 0", async () => {
    const { deps, openService, confirm, logs } = buildDeps({ args: ARGS_DRY_RUN });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(0);

    expect(openService).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("DRY-RUN concluído. Nada foi escrito.");
  });

  it("dry-run imprime só identificadores técnicos — nunca actor, segredo ou payload cadastral", async () => {
    const { deps, logs } = buildDeps({ args: ARGS_DRY_RUN });

    await runExternalReferenceCli(deps);

    const saida = logs.join("\n");
    expect(saida).toContain("0b13f6f0-8f3a-4a1e-9c2d-000000000001");
    expect(saida).toContain("PCTEC_PORTAL/clientes/75");
    expect(saida).not.toContain("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("--execute sem BOOTSTRAP_ALLOW_WRITE: recusa com 2 e nunca abre conexão", async () => {
    const { deps, openService, confirm, errors } = buildDeps({
      nodeEnv: "development",
      allowWriteEnvVar: false
    });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(2);

    expect(openService).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("missing_env_var");
  });

  it("--execute sem --actor: recusa com 2 e nunca abre conexão", async () => {
    const { deps, openService, errors } = buildDeps({
      nodeEnv: "development",
      args: { ...ARGS_EXECUTE, actorPublicId: undefined }
    });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(2);

    expect(openService).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("missing_actor_for_execute");
  });

  it("production sem INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP: recusa antes da confirmação e sem conexão", async () => {
    const { deps, openService, confirm } = buildDeps({ authorization: undefined });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(2);

    expect(confirm).not.toHaveBeenCalled();
    expect(openService).not.toHaveBeenCalled();
  });

  it("production sem TTY: recusa antes da confirmação e sem conexão", async () => {
    const { deps, openService, confirm } = buildDeps({ interactive: false });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(2);

    expect(confirm).not.toHaveBeenCalled();
    expect(openService).not.toHaveBeenCalled();
  });

  it("NODE_ENV desconhecido: fail-closed, recusa mesmo com todas as demais barreiras satisfeitas", async () => {
    const { deps, openService } = buildDeps({ nodeEnv: "staging" });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(2);

    expect(openService).not.toHaveBeenCalled();
  });

  it("frase errada em production: cancela com 1, sem conexão e sem chamar o serviço", async () => {
    const { deps, openService, execute, logs } = buildDeps({
      confirm: vi.fn(async () => "LINK_ORGANIZATION_EXTERNAL_REFERENCE")
    });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(1);

    expect(openService).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Cancelado. Nenhuma conexão de escrita foi aberta");
  });

  it("production autorizado: pede a frase exata (com database e hostname) e só então chega ao serviço oficial", async () => {
    const { deps, openService, execute, close, confirm, logs } = buildDeps();

    await expect(runExternalReferenceCli(deps)).resolves.toBe(0);

    expect(confirm).toHaveBeenCalledWith(PRODUCTION_PHRASE);
    expect(openService).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      organizationPublicId: ARGS_EXECUTE.organizationPublicId,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: "75",
      actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099"
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain("ExternalReference criada: ref-1");
  });

  it("fora de produção não há cerimônia: execução autorizada chega ao serviço sem pedir frase", async () => {
    const { deps, openService, confirm } = buildDeps({ nodeEnv: "development" });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(0);

    expect(confirm).not.toHaveBeenCalled();
    expect(openService).toHaveBeenCalledTimes(1);
  });

  it("falha do serviço em production: mensagem genérica, nunca o detalhe do erro; conexão sempre encerrada", async () => {
    const execute = vi.fn(async () => {
      throw new Error("INSERT INTO organization_external_references falhou em db-prod:3306");
    });
    const close = vi.fn(async () => undefined);
    const { deps, errors } = buildDeps({
      openService: vi.fn(() => ({ service: { execute }, close }))
    });

    await expect(runExternalReferenceCli(deps)).resolves.toBe(1);

    const saidaDeErro = errors.join("\n");
    expect(saidaDeErro).not.toContain("db-prod");
    expect(saidaDeErro).not.toContain("organization_external_references");
    expect(saidaDeErro).toContain("Nada foi confirmado.");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("describeStartupFailure — falhas antes do fluxo controlado nunca viram vazamento", () => {
  it("ecoa a mensagem de uso e a de configuração inválida (curadas, sem valores)", () => {
    expect(describeStartupFailure(new Error("Uso: bootstrap-organization-external-reference.js <...>"))).toContain(
      "Uso: bootstrap-organization-external-reference.js"
    );
    expect(describeStartupFailure(new Error("--actor exige um publicId em seguida."))).toContain("--actor exige");
    expect(
      describeStartupFailure(new Error("Configuração inválida: SESSION_TTL_SECONDS é obrigatório com NODE_ENV=production"))
    ).toContain("SESSION_TTL_SECONDS");
  });

  it("redige qualquer outro erro — driver, SQL, host ou stack nunca chegam ao terminal", () => {
    const saida = describeStartupFailure(
      new Error("connect ECONNREFUSED 10.0.0.7:3306 (user pctec_ingressa_app, senha rejeitada)")
    );

    expect(saida).not.toContain("10.0.0.7");
    expect(saida).not.toContain("pctec_ingressa_app");
    expect(saida).toContain("Falha inesperada antes de qualquer escrita. Nada foi escrito.");
  });
});

describe("estrutura do arquivo — reaproveita CreateOrganizationExternalReferenceService, nenhuma query/insert manual", () => {
  it("importa e usa CreateOrganizationExternalReferenceService, nunca SQL bruto", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("../bootstrap-organization-external-reference.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).toContain("CreateOrganizationExternalReferenceService");

    const sourceUpper = source.toUpperCase();
    expect(sourceUpper).not.toContain("INSERT INTO");
    expect(sourceUpper).not.toContain("UPDATE ORGANIZATION_EXTERNAL_REFERENCES");
    expect(sourceUpper).not.toContain("DELETE FROM");
  });
});
