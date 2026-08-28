import { describe, expect, it, vi } from "vitest";
import type {
  HelpdeskClientDocumentRead,
  HelpdeskClientRecord,
  HelpdeskSourceReader,
  HelpdeskUserRecord
} from "../domain/pilot/HelpdeskSourcePort.js";
import { HelpdeskImportSelection } from "../domain/wizard/HelpdeskImportSelection.js";
import type { WizardTargetState } from "../domain/wizard/WizardTargetState.js";
import {
  RunHelpdeskImportWizardService,
  WIZARD_APPLY_CONFIRMATION,
  WizardApplyConfirmationMismatchError,
  WizardApplyWriterMissingError,
  WizardApproverNotEligibleError,
  WizardBatchContainsUnsupportedActionError,
  WizardSourceClientNotFoundError,
  type RunHelpdeskImportWizardDeps,
  type WizardApplyWriter
} from "../application/RunHelpdeskImportWizardService.js";
import { WIZARD_MAPPING_RULES_VERSION } from "../domain/wizard/HelpdeskImportScope.js";
import {
  acessoConcedido,
  alvo,
  CLIENTE,
  CLIENTE_ID,
  GRUPO_PUBLIC_ID,
  jaImportado,
  membershipAtiva,
  organizacaoJaVinculada,
  ORG_PUBLIC_ID,
  usuario
} from "./wizardTestSupport.js";

const APROVADOR = "bbbbbbb1-0000-4000-8000-000000000001";
const NOVA_ORG = "bbbbbbb2-0000-4000-8000-000000000002";
const USUARIOS: readonly HelpdeskUserRecord[] = [
  usuario({ id: 999911 }),
  usuario({ id: 999912, name: "Externo Sintetico Dois", email: "externo.dois.999901@example.invalid" })
];

class FonteFake implements HelpdeskSourceReader {
  public idsLidos: number[][] = [];

  public constructor(
    private readonly users: readonly HelpdeskUserRecord[] = USUARIOS,
    private readonly client: HelpdeskClientRecord | null = CLIENTE
  ) {}

  public async readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    this.idsLidos.push([...ids]);
    return this.users.filter((u) => ids.includes(u.id));
  }

  public async readClientById(): Promise<HelpdeskClientRecord | undefined> {
    return this.client ?? undefined;
  }
}

function selecao(overrides: Record<string, unknown> = {}): HelpdeskImportSelection {
  return HelpdeskImportSelection.create({
    sourceClientId: CLIENTE_ID,
    selectedSourceUserIds: USUARIOS.map((u) => u.id),
    ...overrides
  });
}

interface Bancada {
  readonly deps: RunHelpdeskImportWizardDeps;
  readonly start: ReturnType<typeof vi.fn>;
  readonly record: ReturnType<typeof vi.fn>;
  readonly complete: ReturnType<typeof vi.fn>;
  readonly fail: ReturnType<typeof vi.fn>;
  readonly writer: WizardApplyWriter;
  readonly escritasDeOrganizacao: unknown[];
  /** O CNPJ que a fonte forneceu para a organização criada — `null` quando não forneceu. */
  readonly documentosDeOrganizacao: (string | null)[];
  readonly escritasDeUsuario: { readonly sourceLegacyId: number; readonly organizationPublicId: string }[];
  readonly ordemDeChamadas: string[];
}

function montar(
  estado: WizardTargetState = alvo(),
  extras: Partial<RunHelpdeskImportWizardDeps> = {},
  aprovador: { status: string } | null = { status: "ACTIVE" },
  source: HelpdeskSourceReader = new FonteFake()
): Bancada {
  const ordemDeChamadas: string[] = [];
  const escritasDeOrganizacao: unknown[] = [];
  const documentosDeOrganizacao: (string | null)[] = [];
  const escritasDeUsuario: { sourceLegacyId: number; organizationPublicId: string }[] = [];

  const start = vi.fn(async (request: { mode: string }) => {
    ordemDeChamadas.push(`start:${request.mode}`);
    return { batchPublicId: "lote-1", mode: request.mode, status: "RUNNING" };
  });
  const record = vi.fn(async (request: { items: readonly unknown[] }) => ({
    batchPublicId: "lote-1",
    recorded: request.items.length,
    skippedAsAlreadyProcessed: 0
  }));
  const complete = vi.fn(async () => ({ batchPublicId: "lote-1", status: "COMPLETED" }));
  const fail = vi.fn(async () => ({ batchPublicId: "lote-1", status: "FAILED" }));

  const writer: WizardApplyWriter = {
    writeOrganization: async (input) => {
      ordemDeChamadas.push("writeOrganization");
      escritasDeOrganizacao.push(input.plan);
      documentosDeOrganizacao.push(input.sourceDocumentNumber);
      await input.recordItems({} as never, { ORGANIZATION: NOVA_ORG });
      return { organizationPublicId: NOVA_ORG, targetPublicIdByEntityKind: { ORGANIZATION: NOVA_ORG } };
    },
    writeUser: async (input) => {
      ordemDeChamadas.push(`writeUser:${input.plan.sourceLegacyId}`);
      escritasDeUsuario.push({
        sourceLegacyId: input.plan.sourceLegacyId,
        organizationPublicId: input.membershipOrganizationPublicId
      });
      await input.recordItems({} as never, { IDENTITY: `id-${input.plan.sourceLegacyId}` });
      return {
        identityPublicId: `id-${input.plan.sourceLegacyId}`,
        identityStatus: "ACTIVE",
        activatedNow: true,
        targetPublicIdByEntityKind: { IDENTITY: `id-${input.plan.sourceLegacyId}` }
      };
    }
  };

  const deps = {
    source,
    targetStateReader: {
      read: vi.fn(async () => estado),
      findIdentityByPublicId: vi.fn(async () =>
        aprovador === null
          ? undefined
          : {
              publicId: APROVADOR,
              fullName: "Administrador Sintetico",
              emailNormalized: "admin.999901@example.invalid",
              status: aprovador.status
            }
      ),
      readCounts: vi.fn(async () => ({ identities: 99 }))
    },
    startImportBatchService: { execute: start },
    recordImportBatchItemService: { execute: record, withConnection: () => ({ execute: record }) },
    finishImportBatchService: { complete, fail },
    applyWriter: writer,
    ...extras
  } as unknown as RunHelpdeskImportWizardDeps;

  return {
    deps,
    start,
    record,
    complete,
    fail,
    writer,
    escritasDeOrganizacao,
    documentosDeOrganizacao,
    escritasDeUsuario,
    ordemDeChamadas
  };
}

function pedidoApply(overrides: Record<string, unknown> = {}) {
  return {
    mode: "APPLY" as const,
    selection: selecao(),
    actorIdentityPublicId: APROVADOR,
    dryRunBatchPublicId: "lote-0",
    confirmation: WIZARD_APPLY_CONFIRMATION,
    ...overrides
  };
}

describe("assistente — DRY_RUN", () => {
  it("registra o plano e NUNCA escreve entidade de domínio", async () => {
    const bancada = montar();
    const escrever = vi.spyOn(bancada.writer, "writeUser");
    const escreverOrg = vi.spyOn(bancada.writer, "writeOrganization");

    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: APROVADOR
    });

    expect(resultado.mode).toBe("DRY_RUN");
    expect(escrever).not.toHaveBeenCalled();
    expect(escreverOrg).not.toHaveBeenCalled();
    expect(bancada.record).toHaveBeenCalledTimes(1);
  });

  it("o dry-run nunca registra aprovador — não há aprovação a registrar", async () => {
    const bancada = montar();
    await new RunHelpdeskImportWizardService(bancada.deps).execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: APROVADOR
    });

    expect(bancada.start.mock.calls[0]?.[0]).toMatchObject({
      mode: "DRY_RUN",
      approvedByIdentityPublicId: undefined,
      mappingRulesVersion: WIZARD_MAPPING_RULES_VERSION
    });
  });

  it("lê exatamente os ids selecionados — nunca 'os usuários da empresa'", async () => {
    const fonte = new FonteFake();
    const bancada = montar(alvo(), {}, { status: "ACTIVE" }, fonte);

    await new RunHelpdeskImportWizardService(bancada.deps).execute({
      mode: "DRY_RUN",
      selection: selecao({ selectedSourceUserIds: [999912] }),
      actorIdentityPublicId: APROVADOR
    });

    expect(fonte.idsLidos).toEqual([[999912]]);
  });

  it("counts_after do dry-run é PROPOSTA — soma só os CREATE, sem reler o banco", async () => {
    const bancada = montar(alvo({ counts: { identities: 10, memberships: 4, organizations: 3 } }));
    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: APROVADOR
    });

    expect(resultado.countsBefore["identities"]).toBe(10);
    expect(resultado.countsAfter["identities"]).toBe(12);
    expect(resultado.countsAfter["organizations"]).toBe(4);
    expect(bancada.deps.targetStateReader.readCounts).not.toHaveBeenCalled();
  });

  it("empresa inexistente na origem impede a abertura do lote", async () => {
    const bancada = montar(alvo(), {}, { status: "ACTIVE" }, new FonteFake(USUARIOS, null));

    await expect(
      new RunHelpdeskImportWizardService(bancada.deps).execute({
        mode: "DRY_RUN",
        selection: selecao(),
        actorIdentityPublicId: APROVADOR
      })
    ).rejects.toBeInstanceOf(WizardSourceClientNotFoundError);
    expect(bancada.start).not.toHaveBeenCalled();
  });
});

describe("assistente — APPLY exige aprovação", () => {
  it("recusa sem a confirmação literal, antes de abrir qualquer lote", async () => {
    const bancada = montar();

    await expect(
      new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply({ confirmation: "aplicar" }))
    ).rejects.toBeInstanceOf(WizardApplyConfirmationMismatchError);
    expect(bancada.start).not.toHaveBeenCalled();
  });

  it.each([[undefined], [""], ["APLICA"], ["APLICAR "], ["CONFIRMAR"]])(
    "confirmação incorreta (%s) nunca escreve",
    async (valor) => {
      const bancada = montar();
      await expect(
        new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply({ confirmation: valor }))
      ).rejects.toBeInstanceOf(WizardApplyConfirmationMismatchError);
      expect(bancada.start).not.toHaveBeenCalled();
    }
  );

  it("recusa aprovador que não está ACTIVE", async () => {
    const bancada = montar(alvo(), {}, { status: "PENDING" });

    await expect(
      new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply())
    ).rejects.toBeInstanceOf(WizardApproverNotEligibleError);
    expect(bancada.start).not.toHaveBeenCalled();
  });

  it("recusa aprovador inexistente", async () => {
    const bancada = montar(alvo(), {}, null);

    await expect(
      new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply())
    ).rejects.toBeInstanceOf(WizardApproverNotEligibleError);
  });

  it("o aprovador registrado é o ator da SESSÃO, nunca um campo do pedido", async () => {
    const bancada = montar();
    await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(bancada.start.mock.calls[0]?.[0]).toMatchObject({
      mode: "APPLY",
      approvedByIdentityPublicId: APROVADOR,
      dryRunBatchPublicId: "lote-0"
    });
  });

  it("lote de origem com UPDATE herdado é recusado antes de abrir o apply", async () => {
    const bancada = montar(alvo(), { batchActionCounter: async () => ({ UPDATE: 2, CREATE: 4 }) });

    await expect(
      new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply())
    ).rejects.toBeInstanceOf(WizardBatchContainsUnsupportedActionError);
    expect(bancada.start).not.toHaveBeenCalled();
  });

  it("modo APPLY sem escritor configurado não improvisa", async () => {
    const bancada = montar(alvo(), { applyWriter: undefined });

    await expect(
      new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply())
    ).rejects.toBeInstanceOf(WizardApplyWriterMissingError);
    // O lote foi aberto e depois marcado FAILED — a falha fica na
    // trilha em vez de sumir.
    expect(bancada.fail).toHaveBeenCalled();
  });
});

describe("assistente — APPLY", () => {
  it("escreve a organização ANTES dos usuários e passa o publicId criado para as memberships", async () => {
    const bancada = montar();
    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(bancada.ordemDeChamadas).toEqual([
      "start:APPLY",
      "writeOrganization",
      "writeUser:999911",
      "writeUser:999912"
    ]);
    expect(bancada.escritasDeUsuario.every((e) => e.organizationPublicId === NOVA_ORG)).toBe(true);
    expect(resultado.organizationPublicId).toBe(NOVA_ORG);
  });

  it("devolve o status da identidade e se a ativação federada aconteceu agora", async () => {
    const bancada = montar();
    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(resultado.users).toHaveLength(2);
    for (const usuarioResultado of resultado.users) {
      expect(usuarioResultado.identityStatus).toBe("ACTIVE");
      expect(usuarioResultado.activatedNow).toBe(true);
      expect(usuarioResultado.writtenTargets["IDENTITY"]).toBe(`id-${usuarioResultado.sourceLegacyId}`);
    }
  });

  it("counts_after do APPLY é MEDIDO — relê o banco em vez de somar proposta", async () => {
    const bancada = montar();
    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(bancada.deps.targetStateReader.readCounts).toHaveBeenCalled();
    expect(resultado.countsAfter).toEqual({ identities: 99 });
  });

  it("usuário sem escrita é registrado sem passar pelo escritor", async () => {
    const user = usuario({ id: 999911 });
    const estado = alvo({
      resolvedOrganization: organizacaoJaVinculada(),
      ...jaImportado(user, {
        membershipsByIdentityPublicId: membershipAtiva(),
        applicationAccessesByIdentityPublicId: acessoConcedido()
      })
    });
    const bancada = montar(estado, {}, { status: "ACTIVE" }, new FonteFake([user]));

    await new RunHelpdeskImportWizardService(bancada.deps).execute(
      pedidoApply({ selection: selecao({ selectedSourceUserIds: [999911] }) })
    );

    expect(bancada.escritasDeUsuario).toEqual([]);
    expect(bancada.ordemDeChamadas).toEqual(["start:APPLY"]);
  });

  it("membership de vínculo de grupo aponta para o GRUPO, não para a empresa", async () => {
    const bancada = montar(
      alvo({ businessGroup: { publicId: GRUPO_PUBLIC_ID, organization: undefined, eligible: true, ineligibleReason: undefined, existingRelationship: undefined } }),
      { linkKindResolver: () => new Map(USUARIOS.map((u) => [u.id, "BUSINESS_GROUP" as const])) }
    );

    await new RunHelpdeskImportWizardService(bancada.deps).execute(
      pedidoApply({ selection: selecao({ parentBusinessGroupPublicId: GRUPO_PUBLIC_ID }) })
    );

    expect(bancada.escritasDeUsuario.every((e) => e.organizationPublicId === GRUPO_PUBLIC_ID)).toBe(true);
  });
});

describe("assistente — retomada e idempotência", () => {
  function chavesDe(entidades: readonly string[], entityType: string, legacyId: number): string[] {
    return entidades.map((e) => `${e}:${entityType}:${legacyId}`);
  }

  it("usuário cujas quatro decisões já estão na trilha é RETOMADO, não reescrito", async () => {
    const jaFeitas = new Set([
      ...chavesDe(["ORGANIZATION", "ORGANIZATION_EXTERNAL_REFERENCE"], "clients", CLIENTE_ID),
      ...chavesDe(
        ["IDENTITY", "IDENTITY_EXTERNAL_REFERENCE", "MEMBERSHIP", "APPLICATION_ACCESS"],
        "users",
        999911
      )
    ]);
    // Retomada realista: a organização criada na execução anterior já
    // é reencontrada pela referência externa, então o destino da
    // membership do usuário restante continua resolvido.
    const bancada = montar(alvo({ resolvedOrganization: organizacaoJaVinculada() }), {
      processedSourceKeysReader: async () => jaFeitas
    });

    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(resultado.resumedUsers).toEqual([CLIENTE_ID, 999911]);
    expect(bancada.escritasDeUsuario).toEqual([{ sourceLegacyId: 999912, organizationPublicId: ORG_PUBLIC_ID }]);
    expect(bancada.ordemDeChamadas).not.toContain("writeOrganization");
  });

  it("duas execuções consecutivas do MESMO apply não escrevem duas vezes", async () => {
    const trilha = new Set<string>();
    const bancada = montar(alvo(), {
      processedSourceKeysReader: async () => new Set(trilha)
    });
    const servico = new RunHelpdeskImportWizardService(bancada.deps);

    await servico.execute(pedidoApply());
    // A trilha da primeira execução passa a existir para a segunda —
    // é exatamente o que a tabela `import_batch_items` faz no banco.
    for (const item of ["ORGANIZATION", "ORGANIZATION_EXTERNAL_REFERENCE"]) {
      trilha.add(`${item}:clients:${CLIENTE_ID}`);
    }
    for (const id of [999911, 999912]) {
      for (const item of ["IDENTITY", "IDENTITY_EXTERNAL_REFERENCE", "MEMBERSHIP", "APPLICATION_ACCESS"]) {
        trilha.add(`${item}:users:${id}`);
      }
    }
    const escritasDepoisDaPrimeira = bancada.escritasDeUsuario.length;

    const segunda = await servico.execute(pedidoApply());

    expect(escritasDepoisDaPrimeira).toBe(2);
    expect(bancada.escritasDeUsuario).toHaveLength(2);
    expect(segunda.resumedUsers).toEqual([CLIENTE_ID, 999911, 999912]);
  });
});

describe("assistente — fingerprints", () => {
  async function fingerprintDe(
    selection: HelpdeskImportSelection,
    estado: WizardTargetState = alvo()
  ): Promise<{ scope: string; snapshot: string }> {
    const bancada = montar(estado);
    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute({
      mode: "DRY_RUN",
      selection,
      actorIdentityPublicId: APROVADOR
    });
    return { scope: resultado.scopeFingerprint, snapshot: resultado.snapshotFingerprint };
  }

  it("a mesma seleção sobre a mesma origem produz o mesmo escopo", async () => {
    const a = await fingerprintDe(selecao());
    const b = await fingerprintDe(selecao({ selectedSourceUserIds: [999912, 999911] }));
    expect(a.scope).toBe(b.scope);
  });

  it("mudar a SELEÇÃO muda o escopo — aprovar dois não autoriza aplicar um", async () => {
    const dois = await fingerprintDe(selecao());
    const um = await fingerprintDe(selecao({ selectedSourceUserIds: [999911] }));
    expect(um.scope).not.toBe(dois.scope);
  });

  it("mudar a ORGANIZAÇÃO de destino muda o escopo, mesmo com a mesma seleção", async () => {
    const semDestino = await fingerprintDe(selecao());
    const comDestino = await fingerprintDe(
      selecao({ targetOrganizationPublicId: ORG_PUBLIC_ID }),
      alvo({ resolvedOrganization: organizacaoJaVinculada() })
    );
    expect(comDestino.scope).not.toBe(semDestino.scope);
  });

  it("mudar o GRUPO afirmado muda o escopo", async () => {
    const sem = await fingerprintDe(selecao());
    const com = await fingerprintDe(selecao({ parentBusinessGroupPublicId: GRUPO_PUBLIC_ID }));
    expect(com.scope).not.toBe(sem.scope);
  });

  it("mudar a ORIGEM muda os dois fingerprints", async () => {
    const original = await fingerprintDe(selecao());

    const alterado = montar(alvo(), {}, { status: "ACTIVE" }, new FonteFake([
      usuario({ id: 999911, name: "Nome Trocado Na Origem" }),
      USUARIOS[1]!
    ]));
    const resultado = await new RunHelpdeskImportWizardService(alterado.deps).execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: APROVADOR
    });

    expect(resultado.snapshotFingerprint).not.toBe(original.snapshot);
    expect(resultado.scopeFingerprint).not.toBe(original.scope);
  });

  it("o escopo do apply é RECALCULADO — o cliente não o envia e não pode forjá-lo", async () => {
    const bancada = montar();
    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute(
      pedidoApply({ scopeFingerprint: "f".repeat(64) } as never)
    );

    const enviado = bancada.start.mock.calls[0]?.[0] as { scopeFingerprint: string };
    expect(enviado.scopeFingerprint).toBe(resultado.scopeFingerprint);
    expect(enviado.scopeFingerprint).not.toBe("f".repeat(64));
  });
});

/**
 * CNPJ da origem — a única evidência que o vínculo automático com o
 * Portal aceita.
 *
 * A descoberta que motiva estes testes: `pctec_helpdesk.clients` TEM a
 * coluna `cnpj`, mas o principal read-only do Ingressa tem SELECT de
 * COLUNA em `(id, name, active)`. Enquanto o GRANT não for ampliado, a
 * fonte responde "não fornece" — e o assistente precisa se comportar
 * corretamente nos DOIS mundos, porque o segundo depende só de uma
 * decisão de quem opera.
 */
describe("assistente — CNPJ da origem", () => {
  class FonteComDocumento extends FonteFake {
    public readonly idsConsultados: number[] = [];
    public constructor(private readonly documento: string | null, private readonly disponivel = true) {
      super();
    }
    public async readClientDocument(clientId: number): Promise<HelpdeskClientDocumentRead> {
      this.idsConsultados.push(clientId);
      return this.disponivel ? { available: true, documentNumber: this.documento } : { available: false };
    }
  }

  it("transporta o CNPJ até a criação da Organization quando a fonte o fornece", async () => {
    const fonte = new FonteComDocumento("11.222.333/0001-81");
    const bancada = montar(alvo(), {}, { status: "ACTIVE" }, fonte);

    await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(bancada.documentosDeOrganizacao).toEqual(["11.222.333/0001-81"]);
    expect(fonte.idsConsultados).toEqual([CLIENTE_ID]);
  });

  it("empresa sem CNPJ na origem: organização criada sem documento, e NUNCA pelo nome", async () => {
    const bancada = montar(alvo(), {}, { status: "ACTIVE" }, new FonteComDocumento(null));

    await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(bancada.documentosDeOrganizacao).toEqual([null]);
  });

  it("fonte sem privilégio na coluna é tratada como 'não fornece', não como falha", async () => {
    const bancada = montar(alvo(), {}, { status: "ACTIVE" }, new FonteComDocumento("11222333000181", false));

    // O APPLY completa. Deixar o 1143 subir faria uma importação
    // inteira falhar por causa de um campo opcional que a operação
    // nunca teve.
    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(resultado.status).toBe("COMPLETED");
    expect(bancada.documentosDeOrganizacao).toEqual([null]);
  });

  it("fonte que sequer implementa a leitura continua funcionando", async () => {
    // `FonteFake` é a fonte de todos os outros testes desta suíte: ela
    // não tem `readClientDocument`. Tratar a ausência do método como
    // erro quebraria o assistente que já está em uso.
    const bancada = montar();

    const resultado = await new RunHelpdeskImportWizardService(bancada.deps).execute(pedidoApply());

    expect(resultado.status).toBe("COMPLETED");
    expect(bancada.documentosDeOrganizacao).toEqual([null]);
  });

  it("o documento NÃO é lido na pré-visualização nem no dry-run", async () => {
    const fonte = new FonteComDocumento("11222333000181");
    const bancada = montar(alvo(), {}, { status: "ACTIVE" }, fonte);
    const servico = new RunHelpdeskImportWizardService(bancada.deps);

    await servico.prepare(selecao());
    await servico.execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: APROVADOR
    });

    // Se entrasse no plano, um CNPJ corrigido no Helpdesk entre o
    // dry-run e o apply mudaria o `scopeFingerprint` e faria o apply ser
    // recusado por "a origem mudou" — punindo uma correção que não
    // altera nada do que vai ser escrito.
    expect(fonte.idsConsultados).toEqual([]);
  });
});
