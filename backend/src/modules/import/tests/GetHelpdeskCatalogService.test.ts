import { describe, expect, it } from "vitest";
import type { HelpdeskClientRecord, HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";
import type { HelpdeskCatalogPage, HelpdeskCatalogQuery, HelpdeskCatalogReader } from "../domain/wizard/HelpdeskCatalogPort.js";
import {
  GetHelpdeskCatalogService,
  normalizeCatalogPaging,
  type CatalogCompanyLink,
  type CatalogIdentityLink,
  type WizardCatalogTargetReader
} from "../application/GetHelpdeskCatalogService.js";
import { WIZARD_CATALOG_MAX_LIMIT } from "../domain/wizard/HelpdeskImportScope.js";
import { CLIENTE, CLIENTE_ID, IDENTIDADE_PUBLIC_ID, ORG_PUBLIC_ID, usuario } from "./wizardTestSupport.js";

class FonteDeCatalogo implements HelpdeskCatalogReader {
  public consultas: HelpdeskCatalogQuery[] = [];

  public constructor(
    private readonly clients: readonly HelpdeskClientRecord[] = [CLIENTE],
    private readonly users: readonly HelpdeskUserRecord[] = []
  ) {}

  public async readClients(query: HelpdeskCatalogQuery): Promise<HelpdeskCatalogPage<HelpdeskClientRecord>> {
    this.consultas.push(query);
    return { items: this.clients, total: this.clients.length, limit: query.limit, offset: query.offset };
  }

  public async readUsersByClientId(): Promise<readonly HelpdeskUserRecord[]> {
    return this.users;
  }
}

class DestinoFake implements WizardCatalogTargetReader {
  public constructor(
    private readonly orgs: ReadonlyMap<number, CatalogCompanyLink> = new Map(),
    private readonly identidades: ReadonlyMap<number, CatalogIdentityLink> = new Map()
  ) {}

  public async findOrganizationsBySourceClientIds(): Promise<ReadonlyMap<number, CatalogCompanyLink>> {
    return this.orgs;
  }

  public async findIdentitiesBySourceUserIds(): Promise<ReadonlyMap<number, CatalogIdentityLink>> {
    return this.identidades;
  }
}

describe("catálogo — paginação", () => {
  it("aplica limite padrão e nunca deixa passar do teto", () => {
    expect(normalizeCatalogPaging(undefined, undefined)).toEqual({ limit: 25, offset: 0 });
    expect(normalizeCatalogPaging(5000, 10)).toEqual({ limit: WIZARD_CATALOG_MAX_LIMIT, offset: 10 });
    expect(normalizeCatalogPaging(-1, -5)).toEqual({ limit: 25, offset: 0 });
    expect(normalizeCatalogPaging("abc", "xyz")).toEqual({ limit: 25, offset: 0 });
  });

  it("a tela nunca consegue pedir a base inteira numa página", async () => {
    const fonte = new FonteDeCatalogo();
    await new GetHelpdeskCatalogService(fonte, new DestinoFake()).listCompanies({ limit: 99999 });

    expect(fonte.consultas[0]?.limit).toBe(WIZARD_CATALOG_MAX_LIMIT);
  });
});

describe("catálogo — empresas", () => {
  it("marca a empresa já vinculada a uma Organization", async () => {
    const vinculo: CatalogCompanyLink = {
      organizationPublicId: ORG_PUBLIC_ID,
      legalName: CLIENTE.name,
      type: "COMPANY",
      status: "ACTIVE"
    };
    const servico = new GetHelpdeskCatalogService(
      new FonteDeCatalogo(),
      new DestinoFake(new Map([[CLIENTE_ID, vinculo]]))
    );

    const pagina = await servico.listCompanies({});

    expect(pagina.items[0]).toMatchObject({ sourceClientId: CLIENTE_ID, linkedOrganization: vinculo });
  });

  it("empresa sem vínculo devolve `null`, não um destino adivinhado", async () => {
    const pagina = await new GetHelpdeskCatalogService(new FonteDeCatalogo(), new DestinoFake()).listCompanies({});
    expect(pagina.items[0]?.linkedOrganization).toBeNull();
  });

  it("repassa a busca à fonte", async () => {
    const fonte = new FonteDeCatalogo();
    await new GetHelpdeskCatalogService(fonte, new DestinoFake()).listCompanies({ q: "sintetica" });
    expect(fonte.consultas[0]?.q).toBe("sintetica");
  });
});

describe("catálogo — usuários", () => {
  const EXTERNO = usuario({ id: 999911 });
  const INTERNO = usuario({ id: 999913, name: "Atendente Sintetico", role: "atendente", clientId: CLIENTE_ID });
  const INATIVO = usuario({ id: 999914, name: "Externo Inativo", active: false, email: "inativo.999901@example.invalid" });
  const SEM_EMAIL = usuario({ id: 999915, name: "Externo Sem Email", email: "" });

  function servico(users: readonly HelpdeskUserRecord[], identidades = new Map<number, CatalogIdentityLink>()) {
    return new GetHelpdeskCatalogService(new FonteDeCatalogo([CLIENTE], users), new DestinoFake(new Map(), identidades));
  }

  it("usuário externo ativo com e-mail é elegível e vem sugerido", async () => {
    const resultado = await servico([EXTERNO]).listUsers(CLIENTE_ID);

    expect(resultado.items[0]).toMatchObject({
      sourceUserId: 999911,
      eligible: true,
      ineligibilityReasons: [],
      suggestedSelected: true
    });
    expect(resultado.eligibleTotal).toBe(1);
  });

  it("o interno APARECE na lista, marcado como inelegível — a tela não mente por omissão", async () => {
    const resultado = await servico([EXTERNO, INTERNO]).listUsers(CLIENTE_ID);

    expect(resultado.total).toBe(2);
    const interno = resultado.items.find((i) => i.sourceUserId === 999913);
    expect(interno?.eligible).toBe(false);
    expect(interno?.ineligibilityReasons).toContain("SOURCE_USER_NOT_EXTERNAL_ROLE");
    expect(interno?.suggestedSelected).toBe(false);
  });

  it("inativo e sem e-mail válido também vêm marcados, com o motivo", async () => {
    const resultado = await servico([INATIVO, SEM_EMAIL]).listUsers(CLIENTE_ID);

    expect(resultado.items[0]?.ineligibilityReasons).toContain("SOURCE_USER_INACTIVE");
    expect(resultado.items[1]?.ineligibilityReasons).toContain("SOURCE_EMAIL_INVALID");
    expect(resultado.eligibleTotal).toBe(0);
  });

  it("acumula todos os motivos, não só o primeiro", async () => {
    const resultado = await servico([
      usuario({ id: 999916, role: "admin", active: false, clientId: null, email: "" })
    ]).listUsers(CLIENTE_ID);

    expect(resultado.items[0]?.ineligibilityReasons).toEqual([
      "SOURCE_USER_INACTIVE",
      "SOURCE_USER_NOT_EXTERNAL_ROLE",
      "SOURCE_USER_WITHOUT_CLIENT_LINK",
      "SOURCE_EMAIL_INVALID"
    ]);
  });

  it("já importado continua sugerido — reexecutar produz SKIP, que é a prova de que não duplicou", async () => {
    const identidades = new Map<number, CatalogIdentityLink>([
      [999911, { identityPublicId: IDENTIDADE_PUBLIC_ID, fullName: EXTERNO.name, status: "ACTIVE" }]
    ]);
    const resultado = await servico([EXTERNO], identidades).listUsers(CLIENTE_ID);

    expect(resultado.items[0]?.linkedIdentity?.identityPublicId).toBe(IDENTIDADE_PUBLIC_ID);
    expect(resultado.items[0]?.suggestedSelected).toBe(true);
    expect(resultado.alreadyImportedTotal).toBe(1);
  });

  it("o catálogo não devolve nenhum campo de autenticação da origem", async () => {
    const resultado = await servico([EXTERNO]).listUsers(CLIENTE_ID);
    const chaves = Object.keys(resultado.items[0] ?? {});

    for (const proibido of ["password", "hash", "token", "reset", "salt", "credential"]) {
      expect(chaves.some((c) => c.toLowerCase().includes(proibido))).toBe(false);
    }
  });
});
