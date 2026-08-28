import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Organization } from "../../organization/domain/Organization.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import { OrganizationExternalReference } from "../../organization/domain/OrganizationExternalReference.js";
import type { OrganizationExternalReferenceRepository } from "../../organization/domain/OrganizationExternalReferenceRepository.js";
import type { PublicId } from "../../organization/domain/value-objects/PublicId.js";
import type { SystemCode } from "../../organization/domain/value-objects/SystemCode.js";
import type { EntityType } from "../../organization/domain/value-objects/EntityType.js";
import type { LegacyId } from "../../organization/domain/value-objects/LegacyId.js";
import type { DocumentNumber } from "../../organization/domain/value-objects/DocumentNumber.js";
import type { OrganizationType } from "../../organization/domain/value-objects/OrganizationType.js";
import type { LinkPortalOrganizationReferenceService } from "../../organization/application/LinkPortalOrganizationReferenceService.js";
import { PortalReferenceAmbiguousError } from "../../organization/domain/errors/PortalOrganizationReferenceErrors.js";
import { OrganizationExternalReferenceAlreadyExistsError } from "../../organization/domain/errors/OrganizationExternalReferenceErrors.js";
import type { OrganizationLockRepository } from "../../organization/domain/OrganizationLockRepository.js";
import { LinkPortalOrganizationReferenceService as LinkPortalOrganizationReferenceServiceReal } from "../../organization/application/LinkPortalOrganizationReferenceService.js";
import { CreateOrganizationExternalReferenceService } from "../../organization/application/CreateOrganizationExternalReferenceService.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import {
  AutoLinkPortalOrganizationReferenceService,
  PORTAL_AUTO_LINK_SOURCE_ERROR
} from "../application/AutoLinkPortalOrganizationReferenceService.js";
import { MatchPortalClientByDocumentService } from "../application/MatchPortalClientByDocumentService.js";
import type { PortalClientCatalogReader, PortalClientRecord } from "../domain/PortalClientCatalogPort.js";

const ATOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELACAO = "8f14e45f-ceea-467e-a1a3-000000000042";
const CNPJ = "11222333000181";

class FakeOrganizationRepository implements OrganizationRepository, OrganizationLockRepository {
  public readonly stored = new Map<string, Organization>();
  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async lockByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(_d: DocumentNumber, _t: OrganizationType): Promise<boolean> {
    return false;
  }
  public async insert(_o: Organization): Promise<void> {}
  public async update(_o: Organization, _v: number): Promise<void> {}
}

/**
 * Referências externas da organização, como o banco as tem.
 *
 * Duplo REAL, e não um stub que já devolve a resposta: o que estes
 * testes precisam provar é que o AutoLink CONSULTA o vínculo existente
 * antes de qualquer correspondência — e um stub do resultado provaria
 * apenas a tradução dele. `insert` fica registrado porque "não escreveu
 * nada" é uma afirmação separada de "respondeu ALREADY_LINKED".
 */
class FakeReferenceRepository implements OrganizationExternalReferenceRepository {
  public readonly stored: OrganizationExternalReference[] = [];
  public readonly inseridas: OrganizationExternalReference[] = [];
  public leituras = 0;

  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    _s: SystemCode,
    _e: EntityType,
    _l: LegacyId
  ): Promise<boolean> {
    return false;
  }
  public async findByPublicId(publicId: PublicId): Promise<OrganizationExternalReference | undefined> {
    return this.stored.find((r) => r.getPublicId().equals(publicId));
  }
  public async findActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<OrganizationExternalReference | undefined> {
    return (
      await this.findAllActiveByOrganizationSystemCodeAndEntityType(organizationPublicId, systemCode, entityType)
    )[0];
  }
  public async findAllActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<readonly OrganizationExternalReference[]> {
    this.leituras += 1;
    return this.stored.filter(
      (r) =>
        r.isActive() &&
        r.getOrganizationPublicId() === organizationPublicId.toString() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType)
    );
  }
  public async insert(reference: OrganizationExternalReference): Promise<void> {
    this.inseridas.push(reference);
    this.stored.push(reference);
  }
}

/** Referência `PCTEC_PORTAL`/`clientes` ACTIVE já existente no banco. */
function vincularNoBanco(
  referencias: FakeReferenceRepository,
  organizationPublicId: string,
  legacyId: number
): OrganizationExternalReference {
  const referencia = OrganizationExternalReference.create({
    organizationPublicId,
    systemCode: "PCTEC_PORTAL",
    entityType: "clientes",
    legacyId,
    actorPublicId: ATOR,
    correlationId: CORRELACAO
  });
  referencias.stored.push(referencia);
  return referencia;
}

function organizacao(
  repositorio: FakeOrganizationRepository,
  props: {
    type?: "COMPANY" | "BUSINESS_GROUP";
    status?: "ACTIVE" | "INACTIVE";
    documentNumber?: string | undefined;
  } = {}
): string {
  const publicId = randomUUID();
  repositorio.stored.set(
    publicId,
    Organization.reconstitute({
      internalId: repositorio.stored.size + 1,
      publicId,
      type: props.type ?? "COMPANY",
      legalName: "ORGANIZACAO SINTETICA LTDA",
      status: props.status ?? "ACTIVE",
      ...(props.documentNumber !== undefined ? { documentNumber: props.documentNumber } : {}),
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  );
  return publicId;
}

function cliente(overrides: Partial<PortalClientRecord> = {}): PortalClientRecord {
  return { id: 71, nome: "CLIENTE SINTETICO", nomeFantasia: null, documentDigits: CNPJ, active: true, ...overrides };
}

function catalogo(candidatos: readonly PortalClientRecord[]): PortalClientCatalogReader {
  return {
    findByDocument: vi.fn(async () => candidatos),
    search: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
    findById: vi.fn(async () => undefined)
  };
}

function linkServiceFake(
  comportamento: (pedido: { organizationPublicId: string; legacyId: unknown }) => unknown = () => ({})
): { servico: LinkPortalOrganizationReferenceService; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async (pedido: { organizationPublicId: string; legacyId: unknown }) => {
    const resposta = comportamento(pedido);
    return {
      publicId: "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11",
      organizationPublicId: pedido.organizationPublicId,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: Number(pedido.legacyId),
      status: "ACTIVE",
      alreadyLinked: false,
      ...(resposta as Record<string, unknown>)
    };
  });
  return { servico: { execute } as unknown as LinkPortalOrganizationReferenceService, execute };
}

const CONEXAO = {} as Queryable;

function montar(
  repositorio: FakeOrganizationRepository,
  leitor: PortalClientCatalogReader,
  link: LinkPortalOrganizationReferenceService,
  referencias: FakeReferenceRepository = new FakeReferenceRepository()
): AutoLinkPortalOrganizationReferenceService {
  return new AutoLinkPortalOrganizationReferenceService(
    () => repositorio,
    CONEXAO,
    new MatchPortalClientByDocumentService(leitor),
    link,
    () => referencias
  );
}

describe("vínculo automático por CNPJ", () => {
  it("EXACT_UNIQUE escreve pelo LinkPortalOrganizationReferenceService — e por mais nada", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = linkServiceFake();

    const resultado = await montar(repositorio, catalogo([cliente()]), link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR,
      correlationId: "corr-1"
    });

    expect(resultado.status).toBe("LINKED");
    expect(resultado.legacyId).toBe(71);
    // A escrita é DELEGADA: com o `FOR UPDATE`, a idempotência e a
    // auditoria do serviço oficial. Este serviço só decide quando.
    expect(link.execute).toHaveBeenCalledTimes(1);
    expect(link.execute).toHaveBeenCalledWith({
      organizationPublicId: publicId,
      legacyId: 71,
      actorPublicId: ATOR,
      correlationId: "corr-1"
    });
  });

  it("devolve o documento do cliente MASCARADO, nunca inteiro", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });

    const resultado = await montar(repositorio, catalogo([cliente()]), linkServiceFake().servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.clientDocumentMasked).toBe("**.***.333/0001-81");
    expect(JSON.stringify(resultado)).not.toContain(CNPJ);
  });

  it("vínculo idêntico já existente é idempotente e não vira novidade", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = linkServiceFake(() => ({ alreadyLinked: true }));

    const resultado = await montar(repositorio, catalogo([cliente()]), link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("ALREADY_LINKED");
    expect(resultado.legacyId).toBe(71);
  });

  it.each([
    ["NOT_FOUND", [] as readonly PortalClientRecord[]],
    ["AMBIGUOUS", [cliente({ id: 71 }), cliente({ id: 72 })]]
  ])("%s NÃO chama o serviço de vínculo", async (esperado, candidatos) => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = linkServiceFake();

    const resultado = await montar(repositorio, catalogo(candidatos), link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe(esperado);
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("organização sem CNPJ fica DOCUMENT_MISSING_OR_INVALID, sem consultar a fonte e sem escrever", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio);
    const leitor = catalogo([cliente()]);
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("DOCUMENT_MISSING_OR_INVALID");
    expect(leitor.findByDocument).not.toHaveBeenCalled();
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("BUSINESS_GROUP nunca recebe vínculo — e a fonte nem é consultada", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { type: "BUSINESS_GROUP", documentNumber: CNPJ });
    const leitor = catalogo([cliente()]);
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("NOT_A_COMPANY");
    expect(leitor.findByDocument).not.toHaveBeenCalled();
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("recusa de domínio do vínculo vira FAILED com o código estável, sem lançar", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = {
      execute: vi.fn(async () => {
        throw new PortalReferenceAmbiguousError(publicId, 2);
      })
    } as unknown as LinkPortalOrganizationReferenceService;

    const resultado = await montar(repositorio, catalogo([cliente()]), link).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe("PORTAL_REFERENCE_AMBIGUOUS");
  });

  it("legacyId que já pertence a outra empresa vira FAILED — nunca sobrescreve", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = {
      execute: vi.fn(async () => {
        throw new OrganizationExternalReferenceAlreadyExistsError();
      })
    } as unknown as LinkPortalOrganizationReferenceService;

    const resultado = await montar(repositorio, catalogo([cliente()]), link).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe("ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS");
  });

  it("indisponibilidade da fonte vira FAILED genérico — sem mensagem de driver na resposta", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const leitor: PortalClientCatalogReader = {
      findByDocument: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.9:3306 user=portal_ro");
      }),
      search: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
      findById: vi.fn(async () => undefined)
    };
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe(PORTAL_AUTO_LINK_SOURCE_ERROR);
    // A organização segue existindo e nada foi inventado.
    expect(link.execute).not.toHaveBeenCalled();
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain("ECONNREFUSED");
    expect(serializado).not.toContain("portal_ro");
    expect(serializado).not.toContain("3306");
  });

  it("organização inexistente vira FAILED, e não uma exceção que apagaria a resposta da criação", async () => {
    const repositorio = new FakeOrganizationRepository();
    const resultado = await montar(repositorio, catalogo([cliente()]), linkServiceFake().servico).execute({
      organizationPublicId: randomUUID(),
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe("PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND");
  });
});

/**
 * Precedência do vínculo EXISTENTE sobre a correspondência.
 *
 * Estes testes exercitam o `AutoLinkPortalOrganizationReferenceService`
 * de verdade, com um repositório de referências que guarda estado. Um
 * duplo do IMPORTADOR que já devolvesse `ALREADY_LINKED` provaria só
 * que o importador sabe traduzir a palavra — nunca que a decisão é
 * tomada aqui, e nunca o caso concreto que estava errado: empresa
 * vinculada e SEM CNPJ sendo reportada como `PENDING_DOCUMENT`.
 */
describe("vínculo automático — referência ACTIVE já existente tem precedência", () => {
  it("já vinculada e SEM documento devolve ALREADY_LINKED, sem consultar a fonte", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio);
    const referencias = new FakeReferenceRepository();
    const existente = vincularNoBanco(referencias, publicId, 71);
    const leitor = catalogo([cliente()]);
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico, referencias).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("ALREADY_LINKED");
    expect(resultado.legacyId).toBe(71);
    expect(resultado.referencePublicId).toBe(existente.getPublicId().toString());
    // O CNPJ deixou de ser pré-requisito para RECONHECER um vínculo que
    // já existe: era isto que produzia `DOCUMENT_MISSING_OR_INVALID`
    // numa empresa corretamente vinculada.
    expect(leitor.findByDocument).not.toHaveBeenCalled();
  });

  it("já vinculada e cliente INATIVO na fonte devolve ALREADY_LINKED", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const referencias = new FakeReferenceRepository();
    vincularNoBanco(referencias, publicId, 71);
    const leitor = catalogo([cliente({ active: false })]);

    const resultado = await montar(repositorio, leitor, linkServiceFake().servico, referencias).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("ALREADY_LINKED");
    expect(resultado.legacyId).toBe(71);
    expect(leitor.findByDocument).not.toHaveBeenCalled();
  });

  it("já vinculada e fonte sem o CNPJ (NOT_FOUND) devolve ALREADY_LINKED", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const referencias = new FakeReferenceRepository();
    vincularNoBanco(referencias, publicId, 71);
    const leitor = catalogo([]);

    const resultado = await montar(repositorio, leitor, linkServiceFake().servico, referencias).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("ALREADY_LINKED");
    expect(resultado.legacyId).toBe(71);
    expect(leitor.findByDocument).not.toHaveBeenCalled();
  });

  it("nos casos já vinculados NADA é escrito — nem pelo serviço de vínculo, nem no repositório", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio);
    const referencias = new FakeReferenceRepository();
    vincularNoBanco(referencias, publicId, 71);
    const link = linkServiceFake();

    await montar(repositorio, catalogo([cliente()]), link.servico, referencias).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(link.execute).not.toHaveBeenCalled();
    expect(referencias.inseridas).toHaveLength(0);
    expect(referencias.stored).toHaveLength(1);
  });

  it("DUAS referências ACTIVE recusam com PORTAL_REFERENCE_AMBIGUOUS — nunca escolhem uma", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const referencias = new FakeReferenceRepository();
    vincularNoBanco(referencias, publicId, 71);
    vincularNoBanco(referencias, publicId, 72);
    const link = linkServiceFake();

    const resultado = await montar(repositorio, catalogo([cliente()]), link.servico, referencias).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe("PORTAL_REFERENCE_AMBIGUOUS");
    // Nenhum `legacyId` sai daqui: citar um já seria a escolha que a
    // recusa existe para não fazer.
    expect(resultado.legacyId).toBeNull();
    expect(resultado.referencePublicId).toBeNull();
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("NENHUMA referência: o matching continua sendo executado normalmente", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const referencias = new FakeReferenceRepository();
    const leitor = catalogo([cliente()]);
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico, referencias).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR,
      correlationId: CORRELACAO
    });

    expect(referencias.leituras).toBe(1);
    expect(leitor.findByDocument).toHaveBeenCalledTimes(1);
    expect(resultado.status).toBe("LINKED");
    // A escrita continua exclusivamente do serviço oficial, que relê sob
    // o `SELECT ... FOR UPDATE`: a leitura acima é um atalho de decisão,
    // não uma segunda autoridade sobre o vínculo.
    expect(link.execute).toHaveBeenCalledWith({
      organizationPublicId: publicId,
      legacyId: 71,
      actorPublicId: ATOR,
      correlationId: CORRELACAO
    });
    expect(referencias.inseridas).toHaveLength(0);
  });

  it("BUSINESS_GROUP nem chega a consultar as referências", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { type: "BUSINESS_GROUP", documentNumber: CNPJ });
    const referencias = new FakeReferenceRepository();

    const resultado = await montar(repositorio, catalogo([cliente()]), linkServiceFake().servico, referencias).execute(
      { organizationPublicId: publicId, actorPublicId: ATOR }
    );

    expect(resultado.status).toBe("NOT_A_COMPANY");
    expect(referencias.leituras).toBe(0);
  });
});

/**
 * A correlação percorre a cadeia INTEIRA — e a prova usa os serviços
 * REAIS, não duplos que já devolvem a resposta certa.
 *
 * `AutoLink` → `LinkPortalOrganizationReferenceService` →
 * `CreateOrganizationExternalReferenceService` → evento de auditoria.
 * É essa cadeia que faz "a empresa foi importada" e "a empresa foi
 * vinculada" serem a mesma requisição na trilha; um duplo do vínculo
 * provaria só que o campo foi repassado uma vez.
 */
describe("vínculo automático — a correlação chega ao vínculo real e à auditoria", () => {
  class RepositorioDeAuditoriaEmMemoria implements AuditEventRepository {
    public readonly events: AuditEvent[] = [];
    public async insert(event: AuditEvent): Promise<void> {
      this.events.push(event);
    }
    public async insertMany(events: readonly AuditEvent[]): Promise<void> {
      this.events.push(...events);
    }
  }

  /** O SQL real está na implementação MariaDB; aqui só o escopo importa. */
  class TransacaoEmMemoria implements UnitOfWork {
    public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
      return work({
        execute: async () => {
          throw new Error("Este teste não deveria executar SQL real.");
        }
      });
    }
  }

  it("o correlationId recebido pelo AutoLink é o do evento organization-external-reference.created", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const referencias = new FakeReferenceRepository();
    const auditoria = new RepositorioDeAuditoriaEmMemoria();
    const transacao = new TransacaoEmMemoria();

    const link = new LinkPortalOrganizationReferenceServiceReal(
      transacao,
      () => repositorio,
      () => referencias,
      (uow) =>
        new CreateOrganizationExternalReferenceService(
          uow,
          () => repositorio,
          () => referencias,
          () => auditoria
        )
    );

    const resultado = await montar(repositorio, catalogo([cliente()]), link, referencias).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR,
      correlationId: CORRELACAO
    });

    expect(resultado.status).toBe("LINKED");
    expect(resultado.legacyId).toBe(71);
    expect(auditoria.events).toHaveLength(1);
    expect(auditoria.events[0]?.eventType).toBe("organization-external-reference.created");
    expect(auditoria.events[0]?.correlationId).toBe(CORRELACAO);
    expect(auditoria.events[0]?.actorPublicId).toBe(ATOR);
  });

  it("reexecutado com a MESMA correlação, o vínculo já existente não gera segundo evento", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const referencias = new FakeReferenceRepository();
    const auditoria = new RepositorioDeAuditoriaEmMemoria();
    const transacao = new TransacaoEmMemoria();

    const link = new LinkPortalOrganizationReferenceServiceReal(
      transacao,
      () => repositorio,
      () => referencias,
      (uow) =>
        new CreateOrganizationExternalReferenceService(
          uow,
          () => repositorio,
          () => referencias,
          () => auditoria
        )
    );
    const servico = montar(repositorio, catalogo([cliente()]), link, referencias);
    const pedido = { organizationPublicId: publicId, actorPublicId: ATOR, correlationId: CORRELACAO };

    const primeira = await servico.execute(pedido);
    const segunda = await servico.execute(pedido);

    expect(primeira.status).toBe("LINKED");
    // A segunda passagem nem chega ao vínculo: o AutoLink enxerga a
    // referência ACTIVE que a primeira criou.
    expect(segunda.status).toBe("ALREADY_LINKED");
    expect(segunda.legacyId).toBe(71);
    expect(segunda.referencePublicId).toBe(primeira.referencePublicId);
    expect(auditoria.events).toHaveLength(1);
    expect(referencias.stored).toHaveLength(1);
  });
});
