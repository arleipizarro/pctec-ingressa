/**
 * `/api/v1/service/meu-rh/*` — fronteira service-to-service da Etapa 1
 * do PCTEC Meu RH.
 *
 * O que estes testes provam, e que é o motivo de o namespace existir:
 *   1. credencial PRÓPRIA obrigatória, com isolamento das outras três;
 *   2. nenhum caminho para o NAVEGADOR (cookie de sessão não abre nada);
 *   3. idempotência — reexecutar não cria identidade, vínculo nem acesso
 *      em duplicidade, e "já existia" é sucesso, não erro;
 *   4. nenhuma resposta carrega id interno, credencial, hash ou token.
 */
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../../portal/application/GetPortalContextService.js";
import type { AuthorizeApplicationAccessService } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../../portal/application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import type { MeuRhDirectoryService } from "../../application/MeuRhDirectoryService.js";
import type { CreateIdentityInvitationService } from "../../../invitation/application/CreateIdentityInvitationService.js";
import { MeuRhOrganizationAmbiguousError } from "../../application/errors/MeuRhErrors.js";
import {
  SERVICE_CREDENTIAL_HEADER_NAME,
  HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME
} from "../../../portal/http/requireServiceCredential.js";
import { MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME } from "../../../identity/http/identityResolutionServiceConsumers.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";

const CREDENCIAL_MEU_RH = "segredo-de-teste-meu-rh";
const CREDENCIAL_PORTAL = "segredo-de-teste-portal";
const CREDENCIAL_HELPDESK = "segredo-de-teste-helpdesk";

const EMPRESA = "11111111-1111-4111-8111-000000000001";
const IDENTIDADE = "22222222-2222-4222-8222-000000000001";
const VINCULO = "33333333-3333-4333-8333-000000000001";

const IDENTIDADE_RESUMIDA = {
  publicId: IDENTIDADE,
  fullName: "Fulana de Teste",
  email: "fulana@exemplo.test",
  status: "PENDING",
  loginEnabled: false
};

/**
 * Duplo que CONTA as escritas em vez de simulá-las.
 *
 * A idempotência que interessa é a de quem chama: a segunda execução
 * precisa devolver `created: false` sem pedir criação nenhuma. Um duplo
 * que só devolvesse um objeto fixo passaria mesmo se a rota pedisse a
 * criação duas vezes.
 */
class FakeDiretorio {
  public organizacoesGarantidas: string[] = [];
  public colaboradoresGarantidos: Array<{ email: string; organizationPublicId: string }> = [];
  public situacoesDefinidas: Array<{ identityPublicId: string; status: string }> = [];
  public ambigua = false;

  private readonly empresasConhecidas = new Set<string>();
  private readonly identidadesConhecidas = new Set<string>();
  private readonly vinculosConhecidos = new Set<string>();
  private readonly acessosConhecidos = new Set<string>();

  public async garantirOrganizacao(entrada: { legalName: string }) {
    this.organizacoesGarantidas.push(entrada.legalName);
    if (this.ambigua) {
      throw new MeuRhOrganizationAmbiguousError(entrada.legalName, 2);
    }
    const jaExistia = this.empresasConhecidas.has(entrada.legalName.trim().toLowerCase());
    this.empresasConhecidas.add(entrada.legalName.trim().toLowerCase());
    return {
      organization: {
        publicId: EMPRESA,
        type: "COMPANY",
        legalName: entrada.legalName,
        tradeName: null,
        status: "ACTIVE"
      },
      created: !jaExistia
    };
  }

  public async identidadePorEmail(email: string) {
    return this.identidadesConhecidas.has(email.toLowerCase()) ? IDENTIDADE_RESUMIDA : null;
  }

  public async identidade() {
    return IDENTIDADE_RESUMIDA;
  }

  public async diretorio() {
    return [{ ...IDENTIDADE_RESUMIDA, membershipStatus: "ACTIVE" }];
  }

  public async perfilDeAcesso() {
    return this.acessosConhecidos.has(IDENTIDADE) ? "USER" : null;
  }

  public async garantirColaborador(entrada: { organizationPublicId: string; email: string }) {
    this.colaboradoresGarantidos.push({ email: entrada.email, organizationPublicId: entrada.organizationPublicId });
    const chave = entrada.email.toLowerCase();
    const identityCreated = !this.identidadesConhecidas.has(chave);
    this.identidadesConhecidas.add(chave);
    const membershipCreated = !this.vinculosConhecidos.has(chave);
    this.vinculosConhecidos.add(chave);
    const applicationAccessGranted = !this.acessosConhecidos.has(chave);
    this.acessosConhecidos.add(chave);
    return { identity: IDENTIDADE_RESUMIDA, identityCreated, membershipCreated, applicationAccessGranted };
  }

  /** Estado das identidades no "Ingressa" do teste, e a ordem das chamadas. */
  public status = new Map<string, string>([[IDENTIDADE, "PENDING"]]);
  public chamadas: string[] = [];

  public async ativarParaPrimeiroAcesso(entrada: { identityPublicId: string; actorPublicId: string }) {
    this.chamadas.push(`ativar:${entrada.identityPublicId}`);
    const atual = this.status.get(entrada.identityPublicId);
    if (atual === undefined) return "NOT_FOUND";
    if (atual === "ACTIVE") return "ALREADY_ACTIVE";
    if (atual !== "PENDING") return "NOT_ACTIVATABLE";
    this.status.set(entrada.identityPublicId, "ACTIVE");
    return "ACTIVATED";
  }

  public async definirSituacaoDoVinculo(entrada: { identityPublicId: string; status: string }) {
    this.situacoesDefinidas.push({ identityPublicId: entrada.identityPublicId, status: entrada.status });
    return { membership: { publicId: VINCULO, status: entrada.status }, changed: true };
  }
}

/**
 * Convite com a MESMA elegibilidade do serviço real no ponto que importa
 * aqui: identidade que não está ACTIVE é `SKIPPED/IDENTITY_NOT_ACTIVE`.
 * Lê o status do diretório no momento da chamada — é isso que prova a
 * ORDEM (ativar antes de convidar), e não só que as duas coisas rodaram.
 */
class FakeConvites {
  public constructor(private readonly diretorio: FakeDiretorio) {}

  public async execute(entrada: { identityPublicIds: readonly string[]; invitedByPublicId: string }) {
    return {
      deliveryMode: "SMTP",
      results: entrada.identityPublicIds.map((identityPublicId) => {
        this.diretorio.chamadas.push(`convidar:${identityPublicId}`);
        const ativa = this.diretorio.status.get(identityPublicId) === "ACTIVE";
        return {
          identityPublicId,
          fullName: "Fulana de Teste",
          outcome: ativa ? "CREATED" : "SKIPPED",
          reasonCode: ativa ? null : "IDENTITY_NOT_ACTIVE",
          invitationPublicId: ativa ? "44444444-4444-4444-8444-000000000001" : null,
          expiresAt: null,
          deliveryMode: ativa ? "SMTP" : null,
          delivered: ativa,
          manualLink: ativa ? "https://ingressa.exemplo.test/convite#segredo-que-nao-pode-vazar" : null
        };
      })
    };
  }
}

async function subirServidor(
  diretorio: FakeDiretorio,
  credencial: string = CREDENCIAL_MEU_RH,
  convites?: FakeConvites
) {
  const app = createApp({
    validateSessionService: {
      execute: async () => ({ identityPublicId: IDENTIDADE, sessionPublicId: "sessao" })
    } as unknown as ValidateSessionService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    authorizeApplicationAccessService: {} as unknown as AuthorizeApplicationAccessService,
    requireOrganizationAccessService: {} as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService: {} as unknown as GetActiveOrganizationExternalReferenceService,
    serviceCredential: CREDENCIAL_PORTAL,
    helpdeskServiceCredential: CREDENCIAL_HELPDESK,
    meuRhServiceCredential: credencial,
    meuRhDirectoryService: diretorio as unknown as MeuRhDirectoryService,
    ...(convites === undefined
      ? {}
      : { createIdentityInvitationService: convites as unknown as CreateIdentityInvitationService })
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

/** `res.json()` é `any`/`unknown` — o tipo declarado aqui é o CONTRATO que cada teste afirma. */
async function lerJson<T>(resposta: Response): Promise<T> {
  return (await resposta.json()) as T;
}

function comCredencial(corpo?: unknown): RequestInit {
  return {
    method: corpo === undefined ? "GET" : "POST",
    headers: {
      [MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_MEU_RH,
      ...(corpo === undefined ? {} : { "content-type": "application/json" })
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) })
  };
}

describe("namespace /api/v1/service/meu-rh — proteção da fronteira", () => {
  let server: Server;
  let baseUrl: string;
  let diretorio: FakeDiretorio;

  beforeEach(async () => {
    diretorio = new FakeDiretorio();
    ({ server, baseUrl } = await subirServidor(diretorio));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("sem credencial: 401 e o caso de uso NUNCA é alcançado", async () => {
    const res = await fetch(`${baseUrl}/api/v1/service/meu-rh/organizations/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ legalName: "PCTEC Outsourcing" })
    });

    expect(res.status).toBe(401);
    expect(diretorio.organizacoesGarantidas).toHaveLength(0);
  });

  it("a credencial do PORTAL não abre este namespace", async () => {
    const res = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/by-email/a%40b.test`, {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_PORTAL }
    });

    expect(res.status).toBe(401);
  });

  it("a credencial do HELPDESK não abre este namespace", async () => {
    const res = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/by-email/a%40b.test`, {
      headers: { [HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_HELPDESK }
    });

    expect(res.status).toBe(401);
  });

  it("o segredo certo no header ERRADO não serve — o header é parte do isolamento", async () => {
    const res = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/by-email/a%40b.test`, {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_MEU_RH }
    });

    expect(res.status).toBe(401);
  });

  it("NAVEGADOR não entra: cookie de sessão válido não substitui a credencial de máquina", async () => {
    const res = await fetch(`${baseUrl}/api/v1/service/meu-rh/organizations/${EMPRESA}/identities`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-sessao-valido` }
    });

    expect(res.status).toBe(401);
  });

  it("credencial vazia mantém o namespace INDISPONÍVEL, nunca aberto", async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    const semSegredo = new FakeDiretorio();
    ({ server, baseUrl } = await subirServidor(semSegredo, ""));

    const res = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/by-email/a%40b.test`, {
      headers: { [MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME]: "" }
    });

    expect(res.status).toBe(401);
  });
});

describe("namespace /api/v1/service/meu-rh — contrato e idempotência", () => {
  let server: Server;
  let baseUrl: string;
  let diretorio: FakeDiretorio;

  beforeEach(async () => {
    diretorio = new FakeDiretorio();
    ({ server, baseUrl } = await subirServidor(diretorio));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("organizations/ensure: cria na primeira chamada e reaproveita na segunda, sem duplicar", async () => {
    type Resposta = { created: boolean; organization: { publicId: string } };
    const primeira = await lerJson<Resposta>(
      await fetch(`${baseUrl}/api/v1/service/meu-rh/organizations/ensure`, comCredencial({ legalName: "PCTEC Outsourcing" }))
    );
    const segunda = await lerJson<Resposta>(
      await fetch(`${baseUrl}/api/v1/service/meu-rh/organizations/ensure`, comCredencial({ legalName: "PCTEC Outsourcing" }))
    );

    expect(primeira.created).toBe(true);
    expect(segunda.created).toBe(false);
    expect(primeira.organization.publicId).toBe(segunda.organization.publicId);
  });

  it("organizations/ensure: nome ambíguo é RECUSADO (409), nunca resolvido por chute", async () => {
    diretorio.ambigua = true;

    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/organizations/ensure`,
      comCredencial({ legalName: "PCTEC Outsourcing" })
    );

    expect(res.status).toBe(409);
    expect((await lerJson<{ error: { code: string } }>(res)).error.code).toBe("MEU_RH_ORGANIZATION_AMBIGUOUS");
  });

  it("collaborators/ensure: a segunda execução não cria identidade, vínculo nem acesso de novo", async () => {
    const corpo = { organizationPublicId: EMPRESA, fullName: "Fulana de Teste", email: "fulana@exemplo.test" };

    type Resposta = { identityCreated: boolean; membershipCreated: boolean; applicationAccessGranted: boolean };
    const primeira = await lerJson<Resposta>(
      await fetch(`${baseUrl}/api/v1/service/meu-rh/collaborators/ensure`, comCredencial(corpo))
    );
    const segunda = await lerJson<Resposta>(
      await fetch(`${baseUrl}/api/v1/service/meu-rh/collaborators/ensure`, comCredencial(corpo))
    );

    expect(primeira).toMatchObject({ identityCreated: true, membershipCreated: true, applicationAccessGranted: true });
    expect(segunda).toMatchObject({ identityCreated: false, membershipCreated: false, applicationAccessGranted: false });
    // A rota continua CHAMANDO o serviço nas duas vezes — é o serviço
    // que decide não escrever. O importador não precisa saber o estado
    // antes de agir, que é o ponto de "idempotente".
    expect(diretorio.colaboradoresGarantidos).toHaveLength(2);
  });

  it("identities/by-email devolve 200 com null quando não existe — 'não achei' é resposta, não erro", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/identities/by-email/${encodeURIComponent("ninguem@exemplo.test")}`,
      comCredencial()
    );

    expect(res.status).toBe(200);
    expect((await lerJson<{ identity: unknown }>(res)).identity).toBeNull();
  });

  it("memberships/status recusa situação fora do enum antes de tocar o serviço", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/memberships/status`,
      comCredencial({ identityPublicId: IDENTIDADE, organizationPublicId: EMPRESA, status: "EXCLUIDO" })
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(diretorio.situacoesDefinidas).toHaveLength(0);
  });

  it("memberships/status aceita ACTIVE e INACTIVE", async () => {
    for (const status of ["INACTIVE", "ACTIVE"]) {
      const res = await fetch(
        `${baseUrl}/api/v1/service/meu-rh/memberships/status`,
        comCredencial({ identityPublicId: IDENTIDADE, organizationPublicId: EMPRESA, status })
      );
      expect(res.status).toBe(200);
      expect((await lerJson<{ membership: { status: string } }>(res)).membership.status).toBe(status);
    }
    expect(diretorio.situacoesDefinidas.map((s) => s.status)).toEqual(["INACTIVE", "ACTIVE"]);
  });

  it("nenhuma resposta carrega id interno, hash, token ou credencial", async () => {
    const respostas = await Promise.all([
      fetch(`${baseUrl}/api/v1/service/meu-rh/organizations/ensure`, comCredencial({ legalName: "PCTEC Outsourcing" })),
      fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}`, comCredencial()),
      fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}/access-profile`, comCredencial()),
      fetch(`${baseUrl}/api/v1/service/meu-rh/organizations/${EMPRESA}/identities`, comCredencial())
    ]);

    for (const resposta of respostas) {
      const texto = await resposta.text();
      expect(texto.toLowerCase()).not.toContain("password");
      expect(texto.toLowerCase()).not.toContain("hash");
      expect(texto.toLowerCase()).not.toContain("token");
      expect(texto.toLowerCase()).not.toContain("credential");
      expect(texto).not.toContain(CREDENCIAL_MEU_RH);
      // `"id":` cru denunciaria a chave interna BIGINT vazando na
      // serialização — só `publicId` pode sair daqui (ADR-021).
      expect(texto).not.toMatch(/"id"\s*:/);
    }
  });
});

describe("POST /identities/activation — participante PENDING recebe acesso de verdade", () => {
  const ATOR = "22222222-2222-4222-8222-0000000000aa";
  let server: Server;
  let baseUrl: string;
  let diretorio: FakeDiretorio;

  beforeEach(async () => {
    diretorio = new FakeDiretorio();
    ({ server, baseUrl } = await subirServidor(diretorio, CREDENCIAL_MEU_RH, new FakeConvites(diretorio)));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("ativa ANTES de convidar: PENDING vira ACTIVE e o convite é CRIADO, não SKIPPED", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/identities/activation`,
      comCredencial({ identityPublicIds: [IDENTIDADE], actorPublicId: ATOR })
    );

    expect(res.status).toBe(200);
    const corpo = await lerJson<{ results: Array<Record<string, unknown>> }>(res);
    expect(corpo.results).toEqual([
      { identityPublicId: IDENTIDADE, activation: "ACTIVATED", outcome: "CREATED", reasonCode: null, delivered: true }
    ]);
    // A ordem é o defeito: convidar primeiro devolvia IDENTITY_NOT_ACTIVE.
    expect(diretorio.chamadas).toEqual([`ativar:${IDENTIDADE}`, `convidar:${IDENTIDADE}`]);
  });

  it("reexecutar não reativa: ALREADY_ACTIVE, e o convite segue o fluxo normal", async () => {
    diretorio.status.set(IDENTIDADE, "ACTIVE");
    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/identities/activation`,
      comCredencial({ identityPublicIds: [IDENTIDADE], actorPublicId: ATOR })
    );

    const corpo = await lerJson<{ results: Array<Record<string, unknown>> }>(res);
    expect(corpo.results[0]).toMatchObject({ activation: "ALREADY_ACTIVE", outcome: "CREATED" });
  });

  it("identidade BLOQUEADA não é ativada por este caminho — o convite continua recusando", async () => {
    diretorio.status.set(IDENTIDADE, "BLOCKED");
    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/identities/activation`,
      comCredencial({ identityPublicIds: [IDENTIDADE], actorPublicId: ATOR })
    );

    const corpo = await lerJson<{ results: Array<Record<string, unknown>> }>(res);
    expect(corpo.results[0]).toMatchObject({
      activation: "NOT_ACTIVATABLE",
      outcome: "SKIPPED",
      reasonCode: "IDENTITY_NOT_ACTIVE"
    });
    expect(diretorio.status.get(IDENTIDADE)).toBe("BLOCKED");
  });

  it("sem ator: recusa antes de ativar ou convidar qualquer pessoa", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/identities/activation`,
      comCredencial({ identityPublicIds: [IDENTIDADE] })
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(diretorio.chamadas).toEqual([]);
    expect(diretorio.status.get(IDENTIDADE)).toBe("PENDING");
  });

  it("o link do convite nunca volta ao consumidor", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/meu-rh/identities/activation`,
      comCredencial({ identityPublicIds: [IDENTIDADE], actorPublicId: ATOR })
    );

    const texto = await res.text();
    expect(texto).not.toContain("segredo-que-nao-pode-vazar");
    expect(texto).not.toContain("manualLink");
    expect(texto).not.toContain("invitationPublicId");
  });
});
