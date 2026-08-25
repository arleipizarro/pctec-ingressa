import { describe, expect, it, vi } from "vitest";
import {
  PilotApproverNotEligibleError,
  PilotBatchContainsUnsupportedActionError,
  PilotSourceClientMismatchError,
  PilotSourceClientNotFoundError,
  PilotSourceUserMissingError,
  RunHelpdeskPilotImportService,
  type RunHelpdeskPilotImportDeps
} from "../application/RunHelpdeskPilotImportService.js";
import type { HelpdeskClientRecord, HelpdeskSourceReader, HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";
import type { IngressaTargetState } from "../domain/pilot/IngressaTargetState.js";
import { NegativeControlLeakError, PILOT_USER_IDS } from "../domain/pilot/HelpdeskPilotScope.js";

const ORG_PUBLIC_ID = "971ec096-e7de-4cc1-be06-2b4709565757";
const APP_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000003";
const APROVADOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const RAZAO_SOCIAL = "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA - BOSQUE";
const MAPPING = { expectedSourceClientId: 75, targetOrganizationPublicId: ORG_PUBLIC_ID };

const USUARIOS: readonly HelpdeskUserRecord[] = [
  { id: 35, name: "Piloto Um", email: "piloto.um@example.invalid", role: "cliente", active: true, clientId: 75 },
  { id: 44, name: "Piloto Dois", email: "piloto.dois@example.invalid", role: "cliente", active: true, clientId: 75 }
];

const CLIENTE: HelpdeskClientRecord = { id: 75, name: RAZAO_SOCIAL, active: true };

class FakeSource implements HelpdeskSourceReader {
  public readIds: number[][] = [];

  public constructor(
    private readonly users: readonly HelpdeskUserRecord[] = USUARIOS,
    private readonly client: HelpdeskClientRecord | null = CLIENTE
  ) {}

  public async readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    this.readIds.push([...ids]);
    return this.users;
  }

  public async readClientById(): Promise<HelpdeskClientRecord | undefined> {
    return this.client ?? undefined;
  }
}

function estadoLimpo(): IngressaTargetState {
  return {
    organization: { publicId: ORG_PUBLIC_ID, legalName: RAZAO_SOCIAL, type: "COMPANY", status: "ACTIVE" },
    application: { publicId: APP_PUBLIC_ID, code: "PCTEC_HELPDESK", status: "ACTIVE" },
    externalReferencesByLegacyId: new Map(),
    identitiesByEmailNormalized: new Map(),
    identitiesByPublicId: new Map(),
    membershipsByIdentityPublicId: new Map(),
    applicationAccessesByIdentityPublicId: new Map(),
    counts: { identities: 7, identityExternalReferences: 1, memberships: 3, applicationAccesses: 2 }
  };
}

interface Espiao {
  readonly deps: RunHelpdeskPilotImportDeps;
  readonly start: ReturnType<typeof vi.fn>;
  readonly record: ReturnType<typeof vi.fn>;
  readonly complete: ReturnType<typeof vi.fn>;
  readonly fail: ReturnType<typeof vi.fn>;
  readonly leituraDoDestino: ReturnType<typeof vi.fn>;
}

function montarDeps(
  source: HelpdeskSourceReader = new FakeSource(),
  estado: IngressaTargetState | Error = estadoLimpo(),
  extras: Partial<RunHelpdeskPilotImportDeps> = {},
  aprovador: { status: string } | null = { status: "ACTIVE" }
): Espiao {
  const start = vi.fn(async (request: { mode: string }) => ({
    batchPublicId: "batch-1",
    mode: request.mode,
    status: "RUNNING"
  }));
  const record = vi.fn(async (request: { items: readonly unknown[] }) => ({
    batchPublicId: "batch-1",
    recorded: request.items.length,
    skippedAsAlreadyProcessed: 0
  }));
  const complete = vi.fn(async () => ({ batchPublicId: "batch-1", status: "COMPLETED" }));
  const fail = vi.fn(async () => ({ batchPublicId: "batch-1", status: "FAILED" }));
  const leituraDoDestino = vi.fn(async () => {
    if (estado instanceof Error) {
      throw estado;
    }
    return estado;
  });

  const deps = {
    source,
    targetStateReader: {
      read: leituraDoDestino,
      findIdentityByPublicId: vi.fn(async () =>
        aprovador === null
          ? undefined
          : { publicId: APROVADOR, fullName: "Admin", emailNormalized: "aprovador@example.invalid", status: aprovador.status }
      )
    },
    startImportBatchService: { execute: start },
    recordImportBatchItemService: { execute: record, withConnection: () => ({ execute: record }) },
    finishImportBatchService: { complete, fail },
    ...extras
  } as unknown as RunHelpdeskPilotImportDeps;

  return { deps, start, record, complete, fail, leituraDoDestino };
}

const PEDIDO_DRY_RUN = { mode: "DRY_RUN" as const, mapping: MAPPING };

function pedidoApply(overrides: Record<string, unknown> = {}) {
  return {
    mode: "APPLY" as const,
    mapping: MAPPING,
    dryRunBatchPublicId: "batch-0",
    approvedByIdentityPublicId: APROVADOR,
    ...overrides
  };
}

describe("runner do piloto — DRY_RUN", () => {
  it("lê exatamente o escopo fixo, sem opção de ampliar", async () => {
    const source = new FakeSource();
    const { deps } = montarDeps(source);
    await new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN);

    expect(source.readIds).toEqual([[...PILOT_USER_IDS]]);
    expect(source.readIds[0]).not.toContain(45);
  });

  it("resolve o destino pelo publicId informado, nunca por nome", async () => {
    const { deps, leituraDoDestino } = montarDeps();
    await new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN);

    const params = leituraDoDestino.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params["targetOrganizationPublicId"]).toBe(ORG_PUBLIC_ID);
    expect(params).not.toHaveProperty("organizationLegalName");
  });

  it("abre o lote em helpdesk-v2 com os dois fingerprints", async () => {
    const { deps, start } = montarDeps();
    const resultado = await new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN);

    const request = start.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request["mappingRulesVersion"]).toBe("helpdesk-v2");
    expect(String(request["snapshotFingerprint"])).toMatch(/^[0-9a-f]{64}$/);
    expect(request["snapshotFingerprint"]).not.toBe(request["scopeFingerprint"]);
    expect(resultado.expectedSourceClientId).toBe(75);
    expect(resultado.sourceClientName).toBe(RAZAO_SOCIAL);
  });

  it("o mapeamento entra no scope_fingerprint — trocar qualquer ponta muda o escopo", async () => {
    const executar = async (mapping: { expectedSourceClientId: number; targetOrganizationPublicId: string }) => {
      const estado = estadoLimpo();
      // O vínculo real acompanha o mapeamento informado — do contrário a
      // verificação de client_id recusaria antes de fingerprintar.
      const source = new FakeSource(
        USUARIOS.map((u) => ({ ...u, clientId: mapping.expectedSourceClientId }))
      );
      const { deps } = montarDeps(source, {
        ...estado,
        organization: { ...estado.organization, publicId: mapping.targetOrganizationPublicId }
      });
      const resultado = await new RunHelpdeskPilotImportService(deps).execute({ mode: "DRY_RUN", mapping });
      return { escopo: resultado.scopeFingerprint, snapshot: resultado.snapshotFingerprint };
    };

    const base = await executar(MAPPING);
    const outroDestino = await executar({
      ...MAPPING,
      targetOrganizationPublicId: "3abb40e7-1e3e-44fa-9a14-44569e373fbc"
    });

    // Mesmo cadastro de origem, destino diferente: o snapshot (que
    // descreve só a origem) não muda, mas o escopo — que autoriza o
    // apply — muda. É isso que impede aprovar para uma empresa e
    // aplicar em outra.
    expect(outroDestino.snapshot).toBe(base.snapshot);
    expect(outroDestino.escopo).not.toBe(base.escopo);

    const outroCliente = await executar({ ...MAPPING, expectedSourceClientId: 76 });
    expect(outroCliente.escopo).not.toBe(base.escopo);
  });

  it("persiste a associação origem→destino no snapshot de cada membership", async () => {
    const { deps, record } = montarDeps();
    await new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN);

    const items = (record.mock.calls[0]?.[0] as { items: { entityKind: string; after?: { source: Record<string, unknown> } }[] }).items;
    const memberships = items.filter((i) => i.entityKind === "MEMBERSHIP");
    expect(memberships).toHaveLength(2);
    for (const membership of memberships) {
      expect(membership.after?.source["source_client_id"]).toBe(75);
      expect(membership.after?.source["organization_public_id"]).toBe(ORG_PUBLIC_ID);
      expect(membership.after?.source["source_client_name"]).toBe(RAZAO_SOCIAL);
    }
  });

  it("registra 8 decisões e nenhuma delas aponta entidade escrita", async () => {
    const { deps, record } = montarDeps();
    const resultado = await new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN);

    const items = (record.mock.calls[0]?.[0] as { items: { targetPublicId: unknown }[] }).items;
    expect(items).toHaveLength(8);
    expect(items.every((i) => i.targetPublicId === null)).toBe(true);
    expect(resultado.countsByAction).toMatchObject({ CREATE: 8, CONFLICT: 0, QUARANTINE: 0 });
  });

  it("propõe counts_after somando apenas as criações", async () => {
    const { deps } = montarDeps();
    const resultado = await new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN);
    expect(resultado.countsAfter).toEqual({
      identities: 9,
      identityExternalReferences: 3,
      memberships: 5,
      applicationAccesses: 4
    });
  });

  it("o usuário 45 não aparece em nenhum item registrado", async () => {
    const { deps, record } = montarDeps();
    await new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN);
    const items = (record.mock.calls[0]?.[0] as { items: { sourceLegacyId: number }[] }).items;
    expect(items.map((i) => i.sourceLegacyId).sort()).toEqual([35, 35, 35, 35, 44, 44, 44, 44]);
    expect(items.some((i) => i.sourceLegacyId === 45)).toBe(false);
  });
});

describe("runner do piloto — verificação do mapeamento antes do lote", () => {
  it("recusa quando um usuário do escopo não tem o client_id informado", async () => {
    const source = new FakeSource([USUARIOS[0]!, { ...USUARIOS[1]!, clientId: 77 }]);
    const { deps, start } = montarDeps(source);

    await expect(new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN)).rejects.toThrow(
      PilotSourceClientMismatchError
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("a mensagem de recusa diz qual usuário e qual vínculo real", async () => {
    const source = new FakeSource([USUARIOS[0]!, { ...USUARIOS[1]!, clientId: null }]);
    const { deps } = montarDeps(source);

    await expect(new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN)).rejects.toThrow(
      /users:44 -> client_id=NULL/
    );
  });

  it("recusa quando o cliente informado não existe na origem", async () => {
    const { deps, start } = montarDeps(new FakeSource(USUARIOS, null));
    await expect(new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN)).rejects.toThrow(
      PilotSourceClientNotFoundError
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("uma organização de destino inelegível derruba a execução antes de abrir lote", async () => {
    const { deps, start } = montarDeps(new FakeSource(), new Error("organização de destino não é elegível"));
    await expect(new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN)).rejects.toThrow(/não é elegível/);
    expect(start).not.toHaveBeenCalled();
  });

  it("aborta se a fonte devolver o controle negativo", async () => {
    const source = new FakeSource([...USUARIOS, { ...USUARIOS[0]!, id: 45 }]);
    const { deps, start } = montarDeps(source);

    await expect(new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN)).rejects.toThrow(
      NegativeControlLeakError
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("aborta se algum usuário do escopo sumiu da origem — nunca lote parcial", async () => {
    const { deps, start } = montarDeps(new FakeSource([USUARIOS[0]!]));
    await expect(new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN)).rejects.toThrow(
      PilotSourceUserMissingError
    );
    expect(start).not.toHaveBeenCalled();
  });
});

describe("runner do piloto — gates do APPLY", () => {
  function writerEspiao() {
    return {
      writeUser: vi.fn(async (input: {
        plan: { sourceLegacyId: number };
        recordItems: (c: unknown, t: Record<string, string>) => Promise<void>;
      }) => {
        const targets = {
          IDENTITY: `identity-${input.plan.sourceLegacyId}`,
          IDENTITY_EXTERNAL_REFERENCE: `ref-${input.plan.sourceLegacyId}`,
          MEMBERSHIP: `mem-${input.plan.sourceLegacyId}`,
          APPLICATION_ACCESS: `acc-${input.plan.sourceLegacyId}`
        };
        await input.recordItems({}, targets);
        return { identityPublicId: targets.IDENTITY, targetPublicIdByEntityKind: targets };
      })
    };
  }

  it("recusa APPLY sem escritor configurado", async () => {
    const { deps } = montarDeps();
    await expect(new RunHelpdeskPilotImportService(deps).execute(pedidoApply())).rejects.toThrow(
      /escritor configurado/
    );
  });

  it.each([
    ["inexistente", null],
    ["INACTIVE", { status: "INACTIVE" }],
    ["BLOCKED", { status: "BLOCKED" }]
  ])("recusa aprovador %s antes de abrir o lote", async (_caso, aprovador) => {
    const { deps, start } = montarDeps(new FakeSource(), estadoLimpo(), { applyWriter: writerEspiao() as never }, aprovador);
    await expect(new RunHelpdeskPilotImportService(deps).execute(pedidoApply())).rejects.toThrow(
      PilotApproverNotEligibleError
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("recusa lote de origem que contenha UPDATE — planejado sob regra antiga", async () => {
    const { deps, start } = montarDeps(new FakeSource(), estadoLimpo(), {
      applyWriter: writerEspiao() as never,
      batchActionCounter: async () => ({ CREATE: 4, UPDATE: 2 })
    });

    await expect(new RunHelpdeskPilotImportService(deps).execute(pedidoApply())).rejects.toThrow(
      PilotBatchContainsUnsupportedActionError
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("aceita lote de origem sem UPDATE", async () => {
    const writer = writerEspiao();
    const { deps } = montarDeps(new FakeSource(), estadoLimpo(), {
      applyWriter: writer as never,
      batchActionCounter: async () => ({ CREATE: 8 })
    });

    await new RunHelpdeskPilotImportService(deps).execute(pedidoApply());
    expect(writer.writeUser).toHaveBeenCalledTimes(2);
  });

  it("grava o target_public_id real de cada entidade criada", async () => {
    const writer = writerEspiao();
    const { deps, record } = montarDeps(new FakeSource(), estadoLimpo(), { applyWriter: writer as never });

    const resultado = await new RunHelpdeskPilotImportService(deps).execute(pedidoApply());

    const gravados = record.mock.calls.flatMap(
      (call) => (call[0] as { items: { entityKind: string; targetPublicId: unknown; sourceLegacyId: number }[] }).items
    );
    expect(gravados).toHaveLength(8);
    expect(gravados.every((i) => typeof i.targetPublicId === "string")).toBe(true);
    expect(gravados.find((i) => i.sourceLegacyId === 35 && i.entityKind === "MEMBERSHIP")?.targetPublicId).toBe("mem-35");
    expect(resultado.users[0]?.writtenTargets["APPLICATION_ACCESS"]).toBe("acc-35");
  });

  it("retomada: usuário já decidido neste lote não é reprocessado", async () => {
    const writer = writerEspiao();
    const chavesDoUsuario35 = new Set([
      "IDENTITY:users:35",
      "IDENTITY_EXTERNAL_REFERENCE:users:35",
      "MEMBERSHIP:users:35",
      "APPLICATION_ACCESS:users:35"
    ]);
    const { deps } = montarDeps(new FakeSource(), estadoLimpo(), {
      applyWriter: writer as never,
      processedSourceKeysReader: async () => chavesDoUsuario35
    });

    const resultado = await new RunHelpdeskPilotImportService(deps).execute(pedidoApply());

    expect(writer.writeUser).toHaveBeenCalledTimes(1);
    expect((writer.writeUser.mock.calls[0]?.[0] as { plan: { sourceLegacyId: number } }).plan.sourceLegacyId).toBe(44);
    expect(resultado.resumedUsers).toEqual([35]);
  });

  it("rerun sobre destino já vinculado não escreve nada", async () => {
    const estado = estadoLimpo();
    const vinculados: IngressaTargetState = {
      ...estado,
      externalReferencesByLegacyId: new Map(
        USUARIOS.map((u) => [
          String(u.id),
          {
            publicId: `ref-${u.id}`,
            identityPublicId: `identity-${u.id}`,
            legacyId: String(u.id),
            matchMethod: "CREATED_FROM_SOURCE",
            status: "ACTIVE"
          }
        ])
      ),
      identitiesByPublicId: new Map(
        USUARIOS.map((u) => [
          `identity-${u.id}`,
          { publicId: `identity-${u.id}`, fullName: u.name, emailNormalized: u.email, status: "ACTIVE" }
        ])
      ),
      membershipsByIdentityPublicId: new Map(
        USUARIOS.map((u) => [
          `identity-${u.id}`,
          {
            publicId: `mem-${u.id}`,
            identityPublicId: `identity-${u.id}`,
            organizationPublicId: ORG_PUBLIC_ID,
            profile: "CUSTOMER",
            scope: "ORGANIZATION_ONLY",
            status: "ACTIVE"
          }
        ])
      ),
      applicationAccessesByIdentityPublicId: new Map(
        USUARIOS.map((u) => [
          `identity-${u.id}`,
          {
            publicId: `acc-${u.id}`,
            identityPublicId: `identity-${u.id}`,
            applicationPublicId: APP_PUBLIC_ID,
            accessProfile: "USER",
            status: "GRANTED"
          }
        ])
      )
    };

    const writer = writerEspiao();
    const { deps } = montarDeps(new FakeSource(), vinculados, { applyWriter: writer as never });
    const resultado = await new RunHelpdeskPilotImportService(deps).execute(pedidoApply());

    expect(writer.writeUser).not.toHaveBeenCalled();
    expect(resultado.countsByAction).toMatchObject({ CREATE: 0, SKIP: 8 });
    expect(resultado.countsAfter).toEqual(resultado.countsBefore);
  });

  it("falha no segundo usuário marca o lote FAILED e não desfaz o primeiro", async () => {
    const escritos: number[] = [];
    const writer = {
      writeUser: vi.fn(async (input: { plan: { sourceLegacyId: number }; recordItems: (c: unknown, t: Record<string, string>) => Promise<void> }) => {
        if (input.plan.sourceLegacyId === 44) {
          throw new Error("ER_LOCK_DEADLOCK ao gravar o segundo usuário");
        }
        escritos.push(input.plan.sourceLegacyId);
        await input.recordItems({}, { IDENTITY: "identity-35" });
        return { identityPublicId: "identity-35", targetPublicIdByEntityKind: { IDENTITY: "identity-35" } };
      })
    };
    const { deps, fail, complete } = montarDeps(new FakeSource(), estadoLimpo(), { applyWriter: writer as never });

    await expect(new RunHelpdeskPilotImportService(deps).execute(pedidoApply())).rejects.toThrow(/ER_LOCK_DEADLOCK/);

    // O primeiro usuário permanece escrito: desfazê-lo exigiria compensar
    // escrita já comitada, que é operação auditável própria.
    expect(escritos).toEqual([35]);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(String((fail.mock.calls[0]?.[0] as { reason: string }).reason)).toMatch(/ER_LOCK_DEADLOCK/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("falha no dry-run também deixa o lote FAILED, com motivo", async () => {
    const { deps, fail } = montarDeps(new FakeSource(), estadoLimpo(), {
      recordImportBatchItemService: {
        execute: vi.fn(async () => {
          throw new Error("banco indisponível");
        }),
        withConnection: () => ({ execute: vi.fn() })
      } as never
    });

    await expect(new RunHelpdeskPilotImportService(deps).execute(PEDIDO_DRY_RUN)).rejects.toThrow(/indisponível/);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
