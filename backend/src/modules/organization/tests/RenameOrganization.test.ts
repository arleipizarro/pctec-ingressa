import { describe, expect, it } from "vitest";
import { Organization } from "../domain/Organization.js";
import {
  OrganizationNotFoundError,
  OrganizationVersionConflictError
} from "../domain/errors/OrganizationErrors.js";
import { InvalidLegalNameError } from "../domain/value-objects/LegalName.js";
import { InvalidTradeNameError } from "../domain/value-objects/TradeName.js";
import { RenameOrganizationService } from "../application/RenameOrganizationService.js";

const ATOR = "11111111-1111-4111-8111-111111111111";

function criar(overrides: Record<string, unknown> = {}): Organization {
  return Organization.create({
    type: "COMPANY",
    legalName: "EMPRESA SINTETICA LTDA",
    actorPublicId: ATOR,
    correlationId: "22222222-2222-4222-8222-222222222222",
    ...overrides
  } as never);
}

function renomear(org: Organization, props: Record<string, unknown> = {}): void {
  org.rename({
    legalName: "EMPRESA SINTETICA CORRIGIDA LTDA",
    tradeName: undefined,
    expectedVersion: org.getVersion(),
    actorPublicId: ATOR,
    correlationId: "33333333-3333-4333-8333-333333333333",
    ...props
  } as never);
}

describe("Organization.rename — domínio", () => {
  it("corrige a razão social, sobe a versão e emite organization.updated", () => {
    const org = criar();
    org.pullDomainEvents();

    renomear(org);

    expect(org.getLegalName().toString()).toBe("EMPRESA SINTETICA CORRIGIDA LTDA");
    expect(org.getVersion()).toBe(2);
    const eventos = org.pullDomainEvents();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.eventType).toBe("organization.updated");
  });

  it("o evento carrega os NOMES dos campos alterados, nunca os valores", () => {
    const org = criar({ tradeName: "SINTETICA" });
    org.pullDomainEvents();

    renomear(org, { tradeName: "OUTRO FANTASIA" });
    const evento = org.pullDomainEvents()[0];

    expect(evento?.payload).toMatchObject({ changedFields: ["legal_name", "trade_name"], previousVersion: 1, version: 2 });
    // Um evento circula mais longe do que a linha da tabela: nome de
    // empresa é dado de cliente e não entra no payload.
    expect(JSON.stringify(evento?.payload)).not.toContain("SINTETICA");
    expect(JSON.stringify(evento?.payload)).not.toContain("CORRIGIDA");
  });

  it("preenche o nome fantasia que estava vazio", () => {
    const org = criar();
    renomear(org, { legalName: "EMPRESA SINTETICA LTDA", tradeName: "SINTETICA" });

    expect(org.getTradeName()?.toString()).toBe("SINTETICA");
    expect(org.pullDomainEvents().at(-1)?.payload).toMatchObject({ changedFields: ["trade_name"] });
  });

  it("string vazia LIMPA o nome fantasia; ausência MANTÉM", () => {
    const limpar = criar({ tradeName: "SINTETICA" });
    renomear(limpar, { legalName: "EMPRESA SINTETICA LTDA", tradeName: "" });
    expect(limpar.getTradeName()).toBeUndefined();

    const manter = criar({ tradeName: "SINTETICA" });
    renomear(manter, { legalName: "OUTRA RAZAO SOCIAL LTDA", tradeName: undefined });
    expect(manter.getTradeName()?.toString()).toBe("SINTETICA");
  });

  it("normaliza espaços das pontas", () => {
    const org = criar();
    renomear(org, { legalName: "   EMPRESA COM ESPACOS LTDA   ", tradeName: "  FANTASIA  " });

    expect(org.getLegalName().toString()).toBe("EMPRESA COM ESPACOS LTDA");
    expect(org.getTradeName()?.toString()).toBe("FANTASIA");
  });

  it.each([[""], ["   "], ["x".repeat(256)]])("recusa razão social inválida (%s)", (valor) => {
    const org = criar();
    expect(() => renomear(org, { legalName: valor })).toThrow(InvalidLegalNameError);
    expect(org.getVersion()).toBe(1);
  });

  it("recusa nome fantasia acima do limite da coluna", () => {
    const org = criar();
    expect(() => renomear(org, { tradeName: "x".repeat(256) })).toThrow(InvalidTradeNameError);
  });

  it("versão divergente é recusada ANTES de qualquer mutação", () => {
    const org = criar();
    expect(() => renomear(org, { expectedVersion: 99 })).toThrow(OrganizationVersionConflictError);
    expect(org.getLegalName().toString()).toBe("EMPRESA SINTETICA LTDA");
    expect(org.getVersion()).toBe(1);
  });

  it("texto idêntico não muda nada: sem versão nova, sem evento", () => {
    const org = criar({ tradeName: "SINTETICA" });
    org.pullDomainEvents();

    renomear(org, { legalName: "EMPRESA SINTETICA LTDA", tradeName: "SINTETICA" });

    expect(org.getVersion()).toBe(1);
    expect(org.pullDomainEvents()).toEqual([]);
  });

  it("não existe caminho para alterar type, status ou documento", () => {
    const org = criar({ documentNumber: "11222333000181" });
    const antes = {
      type: org.getType().toString(),
      status: org.getStatus(),
      documento: org.getDocumentNumber()?.toString()
    };

    renomear(org);

    expect({
      type: org.getType().toString(),
      status: org.getStatus(),
      documento: org.getDocumentNumber()?.toString()
    }).toEqual(antes);
    // A superfície pública do Aggregate continua sem comando para eles.
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(org));
    for (const proibido of ["activate", "inactivate", "setStatus", "changeType", "setDocumentNumber"]) {
      expect(metodos).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------

class RepositorioFake {
  public readonly stored = new Map<string, Organization>();
  public atualizacoes: { publicId: string; expectedVersion: number }[] = [];

  public async findByPublicId(publicId: { toString(): string }): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(): Promise<boolean> {
    return false;
  }
  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
  }
  public async update(organization: Organization, expectedVersion: number): Promise<void> {
    this.atualizacoes.push({ publicId: organization.getPublicId().toString(), expectedVersion });
    this.stored.set(organization.getPublicId().toString(), organization);
  }
}

class AuditoriaFake {
  public eventos: unknown[] = [];
  public async insertMany(eventos: readonly unknown[]): Promise<void> {
    this.eventos.push(...eventos);
  }
  public async insert(evento: unknown): Promise<void> {
    this.eventos.push(evento);
  }
}

function montar(): { servico: RenameOrganizationService; repo: RepositorioFake; auditoria: AuditoriaFake } {
  const repo = new RepositorioFake();
  const auditoria = new AuditoriaFake();
  const unitOfWork = { runInTransaction: async <T>(fn: (c: unknown) => Promise<T>) => fn({}) };
  const servico = new RenameOrganizationService(
    unitOfWork as never,
    () => repo as never,
    () => auditoria as never
  );
  return { servico, repo, auditoria };
}

describe("RenameOrganizationService", () => {
  it("persiste com a versão ORIGINAL na trava otimista e audita no mesmo commit", async () => {
    const { servico, repo, auditoria } = montar();
    const org = criar();
    await repo.insert(org);
    org.pullDomainEvents();

    const resultado = await servico.execute({
      organizationPublicId: org.getPublicId().toString(),
      legalName: "EMPRESA CORRIGIDA LTDA",
      tradeName: "CORRIGIDA",
      expectedVersion: 1,
      actorPublicId: ATOR
    });

    expect(resultado).toMatchObject({ changed: true, version: 2 });
    expect([...resultado.changedFields].sort()).toEqual(["legal_name", "trade_name"]);
    // Versão que vai para o WHERE é a lida, não a já incrementada.
    expect(repo.atualizacoes).toEqual([{ publicId: org.getPublicId().toString(), expectedVersion: 1 }]);
    expect(auditoria.eventos).toHaveLength(1);
  });

  it("organização inexistente vira NOT_FOUND, sem escrever nada", async () => {
    const { servico, repo, auditoria } = montar();

    await expect(
      servico.execute({
        organizationPublicId: "44444444-4444-4444-8444-444444444444",
        legalName: "X LTDA",
        tradeName: undefined,
        expectedVersion: 1,
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    expect(repo.atualizacoes).toEqual([]);
    expect(auditoria.eventos).toEqual([]);
  });

  it("conflito de versão não escreve nem audita", async () => {
    const { servico, repo, auditoria } = montar();
    const org = criar();
    await repo.insert(org);

    await expect(
      servico.execute({
        organizationPublicId: org.getPublicId().toString(),
        legalName: "X LTDA",
        tradeName: undefined,
        expectedVersion: 7,
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(OrganizationVersionConflictError);
    expect(repo.atualizacoes).toEqual([]);
    expect(auditoria.eventos).toEqual([]);
  });

  it("salvar o mesmo texto não gera UPDATE nem evento", async () => {
    const { servico, repo, auditoria } = montar();
    const org = criar({ tradeName: "SINTETICA" });
    await repo.insert(org);
    org.pullDomainEvents();

    const resultado = await servico.execute({
      organizationPublicId: org.getPublicId().toString(),
      legalName: "EMPRESA SINTETICA LTDA",
      tradeName: "SINTETICA",
      expectedVersion: 1,
      actorPublicId: ATOR
    });

    expect(resultado).toMatchObject({ changed: false, version: 1, changedFields: [] });
    expect(repo.atualizacoes).toEqual([]);
    expect(auditoria.eventos).toEqual([]);
  });

  it("o ator auditado é o recebido do controlador — que o tira da sessão", async () => {
    const { servico, repo, auditoria } = montar();
    const org = criar();
    await repo.insert(org);

    await servico.execute({
      organizationPublicId: org.getPublicId().toString(),
      legalName: "OUTRA RAZAO LTDA",
      tradeName: undefined,
      expectedVersion: 1,
      actorPublicId: ATOR
    });

    expect(JSON.stringify(auditoria.eventos[0])).toContain(ATOR);
  });
});
