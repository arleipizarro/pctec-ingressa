/**
 * Integração do assistente — Ingressa real, schema ISOLADO.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e `DB_NAME` terminado em `_test`
 * (`shouldRunIntegrationTests` → `assertIsolatedIntegrationDatabase`).
 * Nunca aponta para DEV, e não existe flag de override: a suíte já
 * deixou seis Identities sintéticas no banco de DEV uma vez.
 *
 * A ORIGEM aqui é um duplo em memória, de propósito: o objetivo é
 * provar o que acontece do lado do INGRESSA — que o dry-run não cria
 * domínio, que o apply cria e ativa, que reexecutar não duplica. A
 * leitura real do Helpdesk é provada em
 * `HelpdeskPilotSource.integration.test.ts`.
 *
 * Toda linha criada carrega o prefixo sintético `999902` e é removida
 * antes e depois — nunca um DELETE genérico de tabela.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { assertIsolatedIntegrationDatabase } from "../../../shared/types/integration-database-guard.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbImportBatchRepository } from "../infrastructure/persistence/MariaDbImportBatchRepository.js";
import { MariaDbImportBatchItemRepository } from "../infrastructure/persistence/MariaDbImportBatchItemRepository.js";
import { MariaDbWizardTargetStateReader } from "../infrastructure/persistence/MariaDbWizardTargetStateReader.js";
import { MariaDbWizardApplyWriter } from "../infrastructure/persistence/MariaDbWizardApplyWriter.js";
import { StartImportBatchService } from "../application/StartImportBatchService.js";
import { RecordImportBatchItemService } from "../application/RecordImportBatchItemService.js";
import { FinishImportBatchService } from "../application/FinishImportBatchService.js";
import {
  RunHelpdeskImportWizardService,
  WIZARD_APPLY_CONFIRMATION
} from "../application/RunHelpdeskImportWizardService.js";
import { GetHelpdeskCatalogService } from "../application/GetHelpdeskCatalogService.js";
import { HelpdeskImportSelection } from "../domain/wizard/HelpdeskImportSelection.js";
import { WIZARD_MAPPING_RULES_VERSION } from "../domain/wizard/HelpdeskImportScope.js";
import type {
  HelpdeskClientRecord,
  HelpdeskSourceReader,
  HelpdeskUserRecord
} from "../domain/pilot/HelpdeskSourcePort.js";
import type {
  HelpdeskCatalogPage,
  HelpdeskCatalogQuery,
  HelpdeskCatalogReader
} from "../domain/wizard/HelpdeskCatalogPort.js";
import { SourceChangedSinceDryRunError } from "../domain/errors/ImportErrors.js";

const DB_CONFIG = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "root",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? "pctec_ingressa_test"
};

const CLIENTE_ID = 999902;
const RAZAO_SOCIAL = "EMPRESA SINTETICA DO ASSISTENTE 999902";
const SUFIXO_EMAIL = "999902@example.invalid";

const EXTERNO_A: HelpdeskUserRecord = {
  id: 999921,
  name: "Externo Sintetico A",
  email: `externo.a.${SUFIXO_EMAIL}`,
  role: "cliente",
  active: true,
  clientId: CLIENTE_ID
};
const EXTERNO_B: HelpdeskUserRecord = {
  id: 999922,
  name: "Externo Sintetico B",
  email: `externo.b.${SUFIXO_EMAIL}`,
  role: "cliente",
  active: true,
  clientId: CLIENTE_ID
};
/** Interno da MESMA empresa — nunca deve receber membership. */
const INTERNO: HelpdeskUserRecord = {
  id: 999923,
  name: "Interno Sintetico",
  email: `interno.${SUFIXO_EMAIL}`,
  role: "atendente",
  active: true,
  clientId: CLIENTE_ID
};
/**
 * Controle negativo: existe na empresa, é elegível por todo critério
 * que não seja a seleção. Se alguma regra vazar de "selecionado" para
 * "parece elegível", é ele quem aparece no lote.
 */
const NAO_SELECIONADO: HelpdeskUserRecord = {
  id: 999924,
  name: "Externo Nao Selecionado",
  email: `nao.selecionado.${SUFIXO_EMAIL}`,
  role: "cliente",
  active: true,
  clientId: CLIENTE_ID
};

const TODOS = [EXTERNO_A, EXTERNO_B, INTERNO, NAO_SELECIONADO];

/**
 * Aprovador sintético — criado e removido por ESTA suíte.
 *
 * Existe porque `ActivateFederatedIdentityService` revalida o aprovador
 * DENTRO da transação do apply: sem uma Identity ACTIVE com
 * `ApplicationAccess(PCTEC_INGRESSA, ADMIN)` no banco, o caminho que se
 * quer provar nem chega a ser exercido.
 *
 * A fixture é da suíte e não do schema por um motivo concreto: uma
 * concessão ADMIN deixada no banco de teste faz
 * `BootstrapFirstApplicationAccessService.integration` falhar, porque
 * aquela suíte prova justamente o oposto — que o bootstrap recusa
 * quando já existe ADMIN. Duas suítes com pré-condições opostas só
 * convivem se cada uma criar e desfazer a sua.
 *
 * Isto não é o teste fabricando a própria autorização: o serviço
 * continua LENDO a autorização do banco e recusando quando ela não
 * serve — provado em `RunHelpdeskImportWizardService.test.ts`.
 */
const ADMIN_PUBLIC_ID = "99990200-0000-4000-8000-000000000001";
const ADMIN_ACESSO_PUBLIC_ID = "99990200-0000-4000-8000-000000000002";
const ADMIN_EMAIL = `aprovador.${SUFIXO_EMAIL}`;
const CLIENTE: HelpdeskClientRecord = { id: CLIENTE_ID, name: RAZAO_SOCIAL, active: true };

class FonteEmMemoria implements HelpdeskSourceReader, HelpdeskCatalogReader {
  public constructor(private readonly users: readonly HelpdeskUserRecord[] = TODOS) {}

  public async readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]> {
    return this.users.filter((u) => ids.includes(u.id));
  }

  public async readClientById(clientId: number): Promise<HelpdeskClientRecord | undefined> {
    return clientId === CLIENTE_ID ? CLIENTE : undefined;
  }

  public async readClients(query: HelpdeskCatalogQuery): Promise<HelpdeskCatalogPage<HelpdeskClientRecord>> {
    return { items: [CLIENTE], total: 1, limit: query.limit, offset: query.offset };
  }

  public async readUsersByClientId(): Promise<readonly HelpdeskUserRecord[]> {
    return this.users;
  }
}

const shouldRun = shouldRunIntegrationTests();

describe("guarda de isolamento — o assistente nunca escreve em banco real", () => {
  it("recusa DB_NAME de DEV mesmo com RUN_INTEGRATION_TESTS=true", () => {
    expect(() =>
      assertIsolatedIntegrationDatabase({ RUN_INTEGRATION_TESTS: "true", DB_NAME: "pctec_ingressa_dev" })
    ).toThrow(/nunca recebe escrita de teste/);
  });

  it("recusa qualquer banco que não termine em _test", () => {
    expect(() =>
      assertIsolatedIntegrationDatabase({ RUN_INTEGRATION_TESTS: "true", DB_NAME: "pctec_ingressa" })
    ).toThrow();
    expect(
      assertIsolatedIntegrationDatabase({ RUN_INTEGRATION_TESTS: "true", DB_NAME: "pctec_ingressa_test" })
    ).toEqual({ database: "pctec_ingressa_test" });
  });

  it("o alvo desta suíte termina em _test", () => {
    expect(DB_CONFIG.database.endsWith("_test")).toBe(true);
  });
});

describe.skipIf(!shouldRun)("assistente de importação — integração Ingressa", () => {
  let pool: Pool;
  let adminPublicId: string;

  async function limpar(): Promise<void> {
    await pool.execute(
      `DELETE FROM import_batch_items WHERE batch_public_id IN
         (SELECT public_id FROM import_batches WHERE mapping_rules_version = ?)`,
      [WIZARD_MAPPING_RULES_VERSION]
    );
    await pool.execute(`DELETE FROM import_batches WHERE mapping_rules_version = ?`, [
      WIZARD_MAPPING_RULES_VERSION
    ]);
    await pool.execute(`DELETE FROM application_accesses WHERE public_id = ?`, [ADMIN_ACESSO_PUBLIC_ID]);
    await pool.execute(`DELETE FROM application_accesses WHERE identity_public_id IN
       (SELECT public_id FROM identities WHERE email_normalized LIKE ?)`, [`%${SUFIXO_EMAIL}`]);
    await pool.execute(`DELETE FROM memberships WHERE identity_public_id IN
       (SELECT public_id FROM identities WHERE email_normalized LIKE ?)`, [`%${SUFIXO_EMAIL}`]);
    await pool.execute(`DELETE FROM identity_external_references WHERE legacy_id IN (?, ?, ?, ?)`, [
      EXTERNO_A.id,
      EXTERNO_B.id,
      INTERNO.id,
      NAO_SELECIONADO.id
    ]);
    await pool.execute(`DELETE FROM identities WHERE email_normalized LIKE ?`, [`%${SUFIXO_EMAIL}`]);
    await pool.execute(`DELETE FROM organization_external_references WHERE legacy_id = ? AND entity_type = 'clients'`, [
      CLIENTE_ID
    ]);
    await pool.execute(
      `DELETE FROM organization_relationships WHERE child_organization_public_id IN
         (SELECT public_id FROM organizations WHERE legal_name = ?)`,
      [RAZAO_SOCIAL]
    );
    await pool.execute(`DELETE FROM memberships WHERE organization_public_id IN
       (SELECT public_id FROM organizations WHERE legal_name = ?)`, [RAZAO_SOCIAL]);
    await pool.execute(`DELETE FROM organizations WHERE legal_name = ?`, [RAZAO_SOCIAL]);
  }

  async function criarAprovador(): Promise<string> {
    await pool.execute(
      `INSERT INTO identities
         (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', 0, 1, NOW(3), NOW(3))`,
      [ADMIN_PUBLIC_ID, "Aprovador Sintetico", ADMIN_EMAIL, ADMIN_EMAIL]
    );
    await pool.execute(
      `INSERT INTO application_accesses
         (public_id, identity_public_id, application_public_id, access_profile, status, granted_at, version, created_at, updated_at)
       SELECT ?, ?, public_id, 'ADMIN', 'GRANTED', NOW(3), 1, NOW(3), NOW(3)
         FROM applications WHERE code = 'PCTEC_INGRESSA'`,
      [ADMIN_ACESSO_PUBLIC_ID, ADMIN_PUBLIC_ID]
    );
    return ADMIN_PUBLIC_ID;
  }

  beforeEach(async () => {
    pool = createPool(DB_CONFIG);
    await limpar();
    adminPublicId = await criarAprovador();
  });

  afterEach(async () => {
    await limpar();
    await pool.end();
  });

  function montarServico(fonte: HelpdeskSourceReader = new FonteEmMemoria()): RunHelpdeskImportWizardService {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const itemRepository = new MariaDbImportBatchItemRepository(pool);
    return new RunHelpdeskImportWizardService({
      source: fonte,
      targetStateReader: new MariaDbWizardTargetStateReader(pool),
      startImportBatchService: new StartImportBatchService(unitOfWork, (c) => new MariaDbImportBatchRepository(c)),
      recordImportBatchItemService: new RecordImportBatchItemService(
        unitOfWork,
        (c) => new MariaDbImportBatchRepository(c),
        (c) => new MariaDbImportBatchItemRepository(c)
      ),
      finishImportBatchService: new FinishImportBatchService(unitOfWork, (c) => new MariaDbImportBatchRepository(c)),
      applyWriter: new MariaDbWizardApplyWriter(unitOfWork),
      batchActionCounter: (b) => itemRepository.countByAction(b),
      processedSourceKeysReader: (b) => itemRepository.findProcessedSourceKeys(b)
    });
  }

  function selecao(ids: readonly number[] = [EXTERNO_A.id, EXTERNO_B.id]): HelpdeskImportSelection {
    return HelpdeskImportSelection.create({ sourceClientId: CLIENTE_ID, selectedSourceUserIds: ids });
  }

  async function contar(sql: string, params: readonly unknown[] = []): Promise<number> {
    const [linhas] = await pool.execute(sql, params);
    return Number((linhas as { total: number | string }[])[0]?.total ?? 0);
  }

  /** Conta só as identidades IMPORTADAS — o aprovador é fixture, não resultado. */
  const identidadesSinteticas = () =>
    contar(`SELECT COUNT(*) AS total FROM identities WHERE email_normalized LIKE ? AND public_id <> ?`, [
      `%${SUFIXO_EMAIL}`,
      ADMIN_PUBLIC_ID
    ]);
  const organizacoesSinteticas = () =>
    contar(`SELECT COUNT(*) AS total FROM organizations WHERE legal_name = ?`, [RAZAO_SOCIAL]);

  it("DRY_RUN registra o lote e NÃO cria nenhuma entidade de domínio", async () => {
    const resultado = await montarServico().execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });

    expect(resultado.mode).toBe("DRY_RUN");
    expect(resultado.status).toBe("COMPLETED");
    expect(await identidadesSinteticas()).toBe(0);
    expect(await organizacoesSinteticas()).toBe(0);

    const itens = await contar(`SELECT COUNT(*) AS total FROM import_batch_items WHERE batch_public_id = ?`, [
      resultado.batchPublicId
    ]);
    // 2 da organização + 4 por usuário selecionado.
    expect(itens).toBe(2 + 2 * 4);
  });

  it("CONTROLE NEGATIVO: quem não foi selecionado fica AUSENTE da trilha", async () => {
    const resultado = await montarServico().execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });

    for (const forade of [INTERNO.id, NAO_SELECIONADO.id]) {
      const vestigios = await contar(
        `SELECT COUNT(*) AS total FROM import_batch_items WHERE batch_public_id = ? AND source_legacy_id = ?`,
        [resultado.batchPublicId, forade]
      );
      expect(vestigios, `usuário ${forade} não podia aparecer no lote`).toBe(0);
    }
  });

  it("APPLY cria organização, referência, identidades, memberships e acessos — e ATIVA as identidades", async () => {
    const servico = montarServico();
    const dryRun = await servico.execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });

    const apply = await servico.execute({
      mode: "APPLY",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId,
      dryRunBatchPublicId: dryRun.batchPublicId,
      confirmation: WIZARD_APPLY_CONFIRMATION
    });

    expect(apply.status).toBe("COMPLETED");
    expect(apply.organizationPublicId).not.toBeNull();
    expect(await organizacoesSinteticas()).toBe(1);
    expect(await identidadesSinteticas()).toBe(2);

    // Ativação federada: ACTIVE, e login_enabled continua 0.
    const ativas = await contar(
      `SELECT COUNT(*) AS total FROM identities
        WHERE email_normalized LIKE ? AND public_id <> ? AND status = 'ACTIVE' AND login_enabled = 0`,
      [`%${SUFIXO_EMAIL}`, ADMIN_PUBLIC_ID]
    );
    expect(ativas).toBe(2);
    for (const usuario of apply.users) {
      expect(usuario.identityStatus).toBe("ACTIVE");
      expect(usuario.activatedNow).toBe(true);
    }

    // Membership ORGANIZATION_ONLY na empresa criada, acesso USER.
    const memberships = await contar(
      `SELECT COUNT(*) AS total FROM memberships
        WHERE organization_public_id = ? AND status = 'ACTIVE' AND scope = 'ORGANIZATION_ONLY' AND profile = 'CUSTOMER'`,
      [apply.organizationPublicId]
    );
    expect(memberships).toBe(2);

    const acessos = await contar(
      `SELECT COUNT(*) AS total FROM application_accesses aa
         JOIN applications a ON a.public_id = aa.application_public_id
         JOIN identities i ON i.public_id = aa.identity_public_id
        WHERE a.code = 'PCTEC_HELPDESK' AND aa.access_profile = 'USER' AND aa.status = 'GRANTED'
          AND i.email_normalized LIKE ? AND i.public_id <> ?`,
      [`%${SUFIXO_EMAIL}`, ADMIN_PUBLIC_ID]
    );
    expect(acessos).toBe(2);
  });

  it("NENHUMA Credential é criada — usuário federado não autentica aqui", async () => {
    const servico = montarServico();
    const dryRun = await servico.execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });
    await servico.execute({
      mode: "APPLY",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId,
      dryRunBatchPublicId: dryRun.batchPublicId,
      confirmation: WIZARD_APPLY_CONFIRMATION
    });

    const credenciais = await contar(
      `SELECT COUNT(*) AS total FROM credentials WHERE identity_public_id IN
         (SELECT public_id FROM identities WHERE email_normalized LIKE ?)`,
      [`%${SUFIXO_EMAIL}`]
    );
    // Inclui o aprovador de propósito: nem ele ganha credencial por
    // este caminho.
    expect(credenciais).toBe(0);
  });

  it("nenhum snapshot gravado carrega campo de autenticação", async () => {
    const resultado = await montarServico().execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });

    const [linhas] = await pool.execute(
      `SELECT after_snapshot, before_snapshot FROM import_batch_items WHERE batch_public_id = ?`,
      [resultado.batchPublicId]
    );
    const texto = JSON.stringify(linhas).toLowerCase();
    for (const proibido of ["password", "senha", "hash", "token", "salt", "secret"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("SEGUNDA execução do assistente sobre a mesma empresa resulta em SKIP, nunca duplicação", async () => {
    const servico = montarServico();
    const primeiroDryRun = await servico.execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });
    await servico.execute({
      mode: "APPLY",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId,
      dryRunBatchPublicId: primeiroDryRun.batchPublicId,
      confirmation: WIZARD_APPLY_CONFIRMATION
    });

    // Novo dry-run sobre o mesmo escopo, agora com tudo já importado.
    const segundoDryRun = await servico.execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });

    expect(segundoDryRun.countsByAction["CREATE"] ?? 0).toBe(0);
    expect(segundoDryRun.countsByAction["SKIP"]).toBe(2 + 2 * 4);
    expect(segundoDryRun.organizationActions["ORGANIZATION"]).toBe("SKIP");

    const segundoApply = await servico.execute({
      mode: "APPLY",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId,
      dryRunBatchPublicId: segundoDryRun.batchPublicId,
      confirmation: WIZARD_APPLY_CONFIRMATION
    });

    expect(segundoApply.status).toBe("COMPLETED");
    expect(await identidadesSinteticas()).toBe(2);
    expect(await organizacoesSinteticas()).toBe(1);
  });

  it("FINGERPRINT DIVERGENTE: origem alterada entre o dry-run e o apply derruba o apply", async () => {
    const dryRun = await montarServico().execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });

    // O cadastro do usuário A mudou na origem depois da revisão.
    const fonteAlterada = new FonteEmMemoria([
      { ...EXTERNO_A, name: "Externo Sintetico A (Renomeado)" },
      EXTERNO_B,
      INTERNO,
      NAO_SELECIONADO
    ]);

    await expect(
      montarServico(fonteAlterada).execute({
        mode: "APPLY",
        selection: selecao(),
        actorIdentityPublicId: adminPublicId,
        dryRunBatchPublicId: dryRun.batchPublicId,
        confirmation: WIZARD_APPLY_CONFIRMATION
      })
    ).rejects.toBeInstanceOf(SourceChangedSinceDryRunError);

    expect(await identidadesSinteticas()).toBe(0);
  });

  it("SELEÇÃO alterada entre o dry-run e o apply também derruba o apply", async () => {
    const servico = montarServico();
    const dryRun = await servico.execute({
      mode: "DRY_RUN",
      selection: selecao([EXTERNO_A.id, EXTERNO_B.id]),
      actorIdentityPublicId: adminPublicId
    });

    await expect(
      servico.execute({
        mode: "APPLY",
        // Aprovaram dois; estão tentando aplicar um.
        selection: selecao([EXTERNO_A.id]),
        actorIdentityPublicId: adminPublicId,
        dryRunBatchPublicId: dryRun.batchPublicId,
        confirmation: WIZARD_APPLY_CONFIRMATION
      })
    ).rejects.toBeInstanceOf(SourceChangedSinceDryRunError);

    expect(await identidadesSinteticas()).toBe(0);
  });

  it("APPLY sem a confirmação literal não escreve nem abre lote", async () => {
    const servico = montarServico();
    const dryRun = await servico.execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });
    const lotesAntes = await contar(`SELECT COUNT(*) AS total FROM import_batches WHERE mapping_rules_version = ?`, [
      WIZARD_MAPPING_RULES_VERSION
    ]);

    await expect(
      servico.execute({
        mode: "APPLY",
        selection: selecao(),
        actorIdentityPublicId: adminPublicId,
        dryRunBatchPublicId: dryRun.batchPublicId,
        confirmation: "aplicar"
      })
    ).rejects.toThrow(/APLICAR/);

    expect(
      await contar(`SELECT COUNT(*) AS total FROM import_batches WHERE mapping_rules_version = ?`, [
        WIZARD_MAPPING_RULES_VERSION
      ])
    ).toBe(lotesAntes);
    expect(await identidadesSinteticas()).toBe(0);
  });

  it("o catálogo marca a empresa e os usuários já importados", async () => {
    const fonte = new FonteEmMemoria();
    const servico = montarServico(fonte);
    const dryRun = await servico.execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });
    await servico.execute({
      mode: "APPLY",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId,
      dryRunBatchPublicId: dryRun.batchPublicId,
      confirmation: WIZARD_APPLY_CONFIRMATION
    });

    const catalogo = new GetHelpdeskCatalogService(fonte, new MariaDbWizardTargetStateReader(pool));
    const empresas = await catalogo.listCompanies({});
    const usuarios = await catalogo.listUsers(CLIENTE_ID);

    expect(empresas.items[0]?.linkedOrganization?.legalName).toBe(RAZAO_SOCIAL);
    expect(usuarios.alreadyImportedTotal).toBe(2);
    // O interno aparece, marcado, e nunca ganhou membership.
    const interno = usuarios.items.find((u) => u.sourceUserId === INTERNO.id);
    expect(interno?.eligible).toBe(false);
    expect(interno?.linkedIdentity).toBeNull();
  });

  it("o lote guarda a versão de regras do assistente, distinta da do piloto", async () => {
    const resultado = await montarServico().execute({
      mode: "DRY_RUN",
      selection: selecao(),
      actorIdentityPublicId: adminPublicId
    });

    const [linhas] = await pool.execute(
      `SELECT mapping_rules_version, mode, status FROM import_batches WHERE public_id = ?`,
      [resultado.batchPublicId]
    );
    expect((linhas as Record<string, unknown>[])[0]).toMatchObject({
      mapping_rules_version: WIZARD_MAPPING_RULES_VERSION,
      mode: "DRY_RUN",
      status: "COMPLETED"
    });
  });
});
