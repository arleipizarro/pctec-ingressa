import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { ExistingConnectionUnitOfWork } from "../application/ExistingConnectionUnitOfWork.js";
import {
  MariaDbPilotApplyWriter,
  PilotActionNotApplicableError
} from "../infrastructure/persistence/MariaDbPilotApplyWriter.js";
import type { UserPlan } from "../domain/pilot/HelpdeskPilotPlanner.js";
import type { HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";

const USUARIO: HelpdeskUserRecord = {
  id: 35,
  name: "Piloto Um",
  email: "piloto.um@example.invalid",
  role: "cliente",
  active: true,
  clientId: 75
};

const PLANO_DE_CRIACAO: UserPlan = {
  sourceLegacyId: 35,
  emailNormalized: "piloto.um@example.invalid",
  writes: true,
  items: [
    {
      entityKind: "IDENTITY",
      sourceEntityType: "users",
      sourceLegacyId: 35,
      action: "CREATE",
      reasonCode: "CREATED_FROM_SOURCE",
      before: undefined,
      after: { full_name: "Piloto Um" },
      existingTargetPublicId: undefined
    }
  ]
};

/** UnitOfWork com semântica real de transação, sobre uma conexão falsa. */
class UnitOfWorkEspia implements UnitOfWork {
  public commits = 0;
  public rollbacks = 0;

  public constructor(private readonly connection: Queryable) {}

  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    try {
      const resultado = await work(this.connection);
      this.commits += 1;
      return resultado;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

class ConexaoQueFalha implements Queryable {
  public chamadas = 0;

  public async execute(): Promise<[unknown, unknown]> {
    this.chamadas += 1;
    throw new Error("ER_LOCK_DEADLOCK: falha simulada no meio da escrita");
  }
}

describe("escritor do APPLY — atomicidade por usuário", () => {
  it("falha no meio da escrita reverte a transação inteira e não grava trilha", async () => {
    const conexao = new ConexaoQueFalha();
    const unitOfWork = new UnitOfWorkEspia(conexao);
    const recordItems = vi.fn(async () => {});

    const writer = new MariaDbPilotApplyWriter(unitOfWork);

    await expect(
      writer.writeUser({
        user: USUARIO,
        plan: PLANO_DE_CRIACAO,
        organizationPublicId: "org-1",
        applicationCode: "PCTEC_HELPDESK",
        actorPublicId: "11111111-2222-3333-4444-555555555555",
        recordItems
      })
    ).rejects.toThrow(/falha simulada/);

    expect(unitOfWork.rollbacks).toBe(1);
    expect(unitOfWork.commits).toBe(0);
    // A trilha só é gravada depois de TODAS as escritas do usuário: uma
    // falha no meio não deixa item afirmando escrita que não aconteceu.
    expect(recordItems).not.toHaveBeenCalled();
  });

  it("abre exatamente uma transação por usuário", async () => {
    const conexao = new ConexaoQueFalha();
    const unitOfWork = new UnitOfWorkEspia(conexao);
    await expect(
      new MariaDbPilotApplyWriter(unitOfWork).writeUser({
        user: USUARIO,
        plan: PLANO_DE_CRIACAO,
        organizationPublicId: "org-1",
        applicationCode: "PCTEC_HELPDESK",
        actorPublicId: "11111111-2222-3333-4444-555555555555",
        recordItems: async () => {}
      })
    ).rejects.toThrow();

    expect(unitOfWork.rollbacks + unitOfWork.commits).toBe(1);
  });
});

describe("escritor do APPLY — ação não executável", () => {
  it("recusa item com ação UPDATE, ainda que venha de um plano antigo", async () => {
    const unitOfWork = new UnitOfWorkEspia(new ConexaoQueFalha());
    const planoComUpdate = {
      ...PLANO_DE_CRIACAO,
      items: [{ ...PLANO_DE_CRIACAO.items[0]!, action: "UPDATE" as unknown as "CREATE" }]
    };

    await expect(
      new MariaDbPilotApplyWriter(unitOfWork).writeUser({
        user: USUARIO,
        plan: planoComUpdate,
        organizationPublicId: "org-1",
        applicationCode: "PCTEC_HELPDESK",
        actorPublicId: "11111111-2222-3333-4444-555555555555",
        recordItems: async () => {}
      })
    ).rejects.toThrow(PilotActionNotApplicableError);

    expect(unitOfWork.rollbacks).toBe(1);
  });
});

describe("UnitOfWork participante", () => {
  it("executa sobre a conexão recebida, sem abrir transação nova", async () => {
    const conexao = { execute: vi.fn(async () => [[], undefined] as [unknown, unknown]) };
    const uow = new ExistingConnectionUnitOfWork(conexao);

    const recebida = await uow.runInTransaction(async (c) => c);
    expect(recebida).toBe(conexao);
  });

  it("propaga o erro sem engolir — quem abriu a transação decide o rollback", async () => {
    const uow = new ExistingConnectionUnitOfWork({ execute: async () => [[], undefined] });
    await expect(
      uow.runInTransaction(async () => {
        throw new Error("falha interna");
      })
    ).rejects.toThrow("falha interna");
  });
});
