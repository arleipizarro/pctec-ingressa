import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Provisionamento administrativo — organização e usuário.
 *
 * As invariantes que estes testes protegem:
 *
 * - escopo de vínculo segue o tipo da organização;
 * - só aplicação ACTIVE é oferecida, e ao menos uma é exigida;
 * - a tela nunca escolhe perfil de acesso — ADMIN não é alcançável aqui;
 * - "usuário criado" e "convite gerado" são fatos separados na tela;
 * - o link do convite aparece uma vez, com aviso de que não volta.
 */

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

const GRUPO_A = {
  public_id: "aaaa1111-1111-4111-8111-111111111111",
  type: "BUSINESS_GROUP",
  legal_name: "GRUPO ALFA",
  trade_name: "Alfa",
  status: "ACTIVE"
};

const NOVA_ORG = "cccc3333-3333-4333-8333-cccccccccccc";

function organizacao(overrides: Record<string, unknown> = {}) {
  return {
    ...fixtures.ORGANIZACAO_DETALHE,
    type: "COMPANY",
    status: "ACTIVE",
    legal_name: "EMPRESA SINTETICA LTDA",
    version: 2,
    parents: [],
    ...overrides
  } as never;
}

function provisionado(overrides: Record<string, unknown> = {}) {
  return {
    identityPublicId: fixtures.IDENTIDADE_PUBLIC_ID,
    fullName: "Pessoa Sintetica",
    email: "pessoa.sintetica@example.invalid",
    status: "ACTIVE",
    loginEnabled: false,
    membership: {
      publicId: fixtures.MEMBERSHIP_PUBLIC_ID,
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      status: "ACTIVE"
    },
    applicationAccesses: [{ applicationCode: "APP_SINTETICA", accessProfile: "USER" }],
    invitationRequested: true,
    invitation: {
      outcome: "CREATED",
      reasonCode: null,
      deliveryMode: "MANUAL_DEV",
      expiresAt: "2026-09-02T12:00:00.000Z",
      delivered: false,
      manualLink: "https://ingressa.example.invalid/convite#token-sintetico"
    },
    ...overrides
  } as never;
}

function renderizarLista() {
  return render(
    <MemoryRouter initialEntries={["/admin/organizacoes"]}>
      <App />
    </MemoryRouter>
  );
}

function renderizarDetalhe() {
  return render(
    <MemoryRouter initialEntries={[`/admin/organizacoes/${fixtures.ORG_PUBLIC_ID}`]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN as never);
  vi.spyOn(api, "organization").mockResolvedValue(organizacao());
  vi.spyOn(api, "organizations").mockResolvedValue({
    items: [GRUPO_A, fixtures.ORGANIZACAO],
    total: 2,
    limit: 200,
    offset: 0
  } as never);
  vi.spyOn(api, "applications").mockResolvedValue(fixtures.APLICACOES as never);
});

afterEach(() => vi.restoreAllMocks());

async function abrirNovaOrganizacao() {
  await userEvent.click(await screen.findByRole("button", { name: "Nova organização" }));
  return screen.findByRole("dialog", { name: "Nova organização" });
}

async function abrirNovoUsuario() {
  await userEvent.click(await screen.findByRole("button", { name: "Novo usuário" }));
  return screen.findByRole("dialog", { name: "Novo usuário" });
}

describe("criação de organização", () => {
  it("abre o formulário com tipo, razão social e nome fantasia", async () => {
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    expect(within(dialogo).getByLabelText("Tipo")).toHaveValue("COMPANY");
    expect(within(dialogo).getByLabelText("Razão social")).toHaveValue("");
    expect(within(dialogo).getByLabelText("Nome fantasia")).toHaveValue("");
  });

  it("avisa que nada é CRIADO no Helpdesk ou no Portal — e que o CNPJ é apenas consultado", async () => {
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();
    expect(within(dialogo).getByText(/Nenhum cadastro é criado no Helpdesk ou no Portal/i)).toBeInTheDocument();
    expect(within(dialogo).getByText(/nunca por semelhança de nome/i)).toBeInTheDocument();
  });

  it("o CNPJ é opcional, só aparece para COMPANY e explica o que ele habilita", async () => {
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    expect(within(dialogo).getByLabelText("CNPJ")).toHaveValue("");
    expect(within(dialogo).getByText(/vincular esta empresa ao Portal automaticamente/i)).toBeInTheDocument();

    // Grupo não recebe vínculo próprio, então não pede documento.
    await userEvent.selectOptions(within(dialogo).getByLabelText("Tipo"), "BUSINESS_GROUP");
    expect(within(dialogo).queryByLabelText("CNPJ")).not.toBeInTheDocument();
  });

  it("envia o CNPJ informado, com a pontuação que a pessoa digitou", async () => {
    const criar = vi.spyOn(api, "createOrganization").mockResolvedValue({
      publicId: NOVA_ORG, type: "COMPANY", status: "ACTIVE", version: 1, relationshipPublicId: null
    });
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "EMPRESA NOVA LTDA");
    await userEvent.type(within(dialogo).getByLabelText("CNPJ"), "11.222.333/0001-81");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar organização" }));

    // A normalização é do servidor — mandar dígitos daqui criaria uma
    // segunda regra de normalização, que divergiria da primeira.
    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith({
        type: "COMPANY",
        legalName: "EMPRESA NOVA LTDA",
        documentNumber: "11.222.333/0001-81"
      })
    );
  });

  it("CNPJ incompleto BLOQUEIA o envio — nunca cria a empresa sem o documento que a pessoa digitou", async () => {
    const criar = vi.spyOn(api, "createOrganization").mockResolvedValue({
      publicId: NOVA_ORG, type: "COMPANY", status: "ACTIVE", version: 1, relationshipPublicId: null
    });
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "EMPRESA NOVA LTDA");
    await userEvent.type(within(dialogo).getByLabelText("CNPJ"), "11.222.333");

    expect(within(dialogo).getByTestId("cnpj-incompleto")).toHaveTextContent(/CNPJ tem 14 dígitos/i);
    const botao = within(dialogo).getByRole("button", { name: "Criar organização" });
    expect(botao).toBeDisabled();

    await userEvent.click(botao);

    // Descartar o documento em silêncio criaria a empresa sem CNPJ
    // enquanto a pessoa acredita tê-lo informado — e o sintoma só
    // apareceria como um vínculo com o Portal que nunca acontece.
    expect(criar).not.toHaveBeenCalled();
  });

  it("completar o CNPJ desbloqueia o envio", async () => {
    const criar = vi.spyOn(api, "createOrganization").mockResolvedValue({
      publicId: NOVA_ORG, type: "COMPANY", status: "ACTIVE", version: 1, relationshipPublicId: null
    });
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "EMPRESA NOVA LTDA");
    await userEvent.type(within(dialogo).getByLabelText("CNPJ"), "11.222.333");
    expect(within(dialogo).getByRole("button", { name: "Criar organização" })).toBeDisabled();

    await userEvent.type(within(dialogo).getByLabelText("CNPJ"), "/0001-81");
    expect(within(dialogo).queryByTestId("cnpj-incompleto")).not.toBeInTheDocument();

    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar organização" }));
    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith({
        type: "COMPANY",
        legalName: "EMPRESA NOVA LTDA",
        documentNumber: "11.222.333/0001-81"
      })
    );
  });

  it("campo de CNPJ vazio continua criando normalmente", async () => {
    const criar = vi.spyOn(api, "createOrganization").mockResolvedValue({
      publicId: NOVA_ORG, type: "COMPANY", status: "ACTIVE", version: 1, relationshipPublicId: null
    });
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "EMPRESA NOVA LTDA");
    expect(within(dialogo).queryByTestId("cnpj-incompleto")).not.toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar organização" }));

    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith({ type: "COMPANY", legalName: "EMPRESA NOVA LTDA" })
    );
  });

  it("o texto do formulário não afirma que empresa e vínculo com o Portal são gravados juntos", async () => {
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    // A empresa e a associação ao GRUPO são uma transação só; o vínculo
    // com o Portal acontece depois e não desfaz a criação. Dizer o
    // contrário faria alguém interpretar "não vinculou" como "não criou".
    expect(within(dialogo).getByText(/associação ao grupo são gravadas na mesma transação/i)).toBeInTheDocument();
    expect(within(dialogo).getByText(/não desfaz a criação da empresa/i)).toBeInTheDocument();
    expect(dialogo.textContent ?? "").not.toContain("A empresa e o vínculo são gravados juntos");
  });

  it("o desfecho da correspondência viaja até a tela de destino", async () => {
    vi.spyOn(api, "createOrganization").mockResolvedValue({
      publicId: NOVA_ORG,
      type: "COMPANY",
      status: "ACTIVE",
      version: 1,
      relationshipPublicId: null,
      portalIntegration: {
        status: "AMBIGUOUS",
        legacyId: null,
        referencePublicId: null,
        candidateCount: 2,
        reasonCode: null
      }
    } as never);
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "EMPRESA NOVA LTDA");
    await userEvent.type(within(dialogo).getByLabelText("CNPJ"), "11.222.333/0001-81");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar organização" }));

    // Sem isto, a seção do Portal diria "não vinculada" e ninguém saberia
    // se ninguém tentou, se o CNPJ não bateu ou se o Portal estava fora.
    expect(await screen.findByTestId("aviso-da-criacao")).toHaveTextContent(
      /Mais de um cliente do Portal tem este CNPJ/i
    );
  });

  it("o grupo só é oferecido para COMPANY", async () => {
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();
    expect(within(dialogo).getByLabelText("Grupo empresarial")).toBeInTheDocument();

    // Grupo dentro de grupo não existe no modelo: o campo some, em vez
    // de oferecer um caminho que o servidor recusaria com 422.
    await userEvent.selectOptions(within(dialogo).getByLabelText("Tipo"), "BUSINESS_GROUP");
    expect(within(dialogo).queryByLabelText("Grupo empresarial")).not.toBeInTheDocument();
  });

  it("cria sem grupo e leva ao detalhe da organização criada", async () => {
    const criar = vi.spyOn(api, "createOrganization").mockResolvedValue({
      publicId: NOVA_ORG, type: "COMPANY", status: "ACTIVE", version: 1, relationshipPublicId: null
    });
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "EMPRESA NOVA LTDA");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar organização" }));

    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith({ type: "COMPANY", legalName: "EMPRESA NOVA LTDA" })
    );
  });

  it("envia o grupo escolhido junto da criação", async () => {
    const criar = vi.spyOn(api, "createOrganization").mockResolvedValue({
      publicId: NOVA_ORG, type: "COMPANY", status: "ACTIVE", version: 1, relationshipPublicId: "rel-1"
    });
    renderizarLista();
    const dialogo = await abrirNovaOrganizacao();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "EMPRESA FILHA LTDA");
    await userEvent.selectOptions(within(dialogo).getByLabelText("Grupo empresarial"), GRUPO_A.public_id);
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar organização" }));

    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith({
        type: "COMPANY",
        legalName: "EMPRESA FILHA LTDA",
        parentBusinessGroupPublicId: GRUPO_A.public_id
      })
    );
  });
});

describe("provisionamento de usuário — formulário", () => {
  it("não é oferecido em organização INACTIVE", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(organizacao({ status: "INACTIVE" }));
    renderizarDetalhe();

    await screen.findByRole("button", { name: "Editar organização" });
    expect(screen.queryByRole("button", { name: "Novo usuário" })).not.toBeInTheDocument();
  });

  it("em COMPANY o escopo é apenas ORGANIZATION_ONLY", async () => {
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();

    const escopo = within(dialogo).getByLabelText("Escopo do vínculo");
    expect(escopo).toBeDisabled();
    expect(within(escopo as HTMLSelectElement).queryByText("ORGANIZATION_AND_DESCENDANTS")).not.toBeInTheDocument();
  });

  it("em BUSINESS_GROUP o escopo oferece as duas opções", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(organizacao({ type: "BUSINESS_GROUP" }));
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();

    const escopo = within(dialogo).getByLabelText("Escopo do vínculo");
    expect(escopo).not.toBeDisabled();
    expect(within(escopo as HTMLSelectElement).getByText("ORGANIZATION_AND_DESCENDANTS")).toBeInTheDocument();
  });

  it("lista só aplicações ACTIVE", async () => {
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();

    expect(within(dialogo).getByText("APP_SINTETICA")).toBeInTheDocument();
    // A INACTIVE seria recusada pelo servidor antes de escrever —
    // oferecê-la seria um caminho que termina em erro.
    expect(within(dialogo).queryByText("APP_DESATIVADA")).not.toBeInTheDocument();
  });

  it("não oferece escolha de perfil de acesso, e diz que ADMIN é ação separada", async () => {
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();

    expect(within(dialogo).queryByLabelText(/perfil de acesso/i)).not.toBeInTheDocument();
    expect(within(dialogo).getByText(/conceder ADMIN é uma ação/i)).toBeInTheDocument();
  });

  it("exige ao menos uma aplicação para habilitar o envio", async () => {
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();

    await userEvent.type(within(dialogo).getByLabelText("Nome completo"), "Pessoa Sintetica");
    await userEvent.type(within(dialogo).getByLabelText("E-mail"), "pessoa.sintetica@example.invalid");
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeDisabled();

    await userEvent.click(within(dialogo).getByRole("checkbox", { name: /APP_SINTETICA/ }));
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeEnabled();
  });

  it("envia a seleção sem qualquer perfil de acesso", async () => {
    const criar = vi.spyOn(api, "createOrganizationUser").mockResolvedValue(provisionado());
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();

    await userEvent.type(within(dialogo).getByLabelText("Nome completo"), "Pessoa Sintetica");
    await userEvent.type(within(dialogo).getByLabelText("E-mail"), "pessoa.sintetica@example.invalid");
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: /APP_SINTETICA/ }));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar usuário" }));

    await waitFor(() => expect(criar).toHaveBeenCalled());
    const [, payload] = criar.mock.calls[0]!;
    expect(payload).toEqual({
      fullName: "Pessoa Sintetica",
      email: "pessoa.sintetica@example.invalid",
      membershipProfile: "CUSTOMER",
      membershipScope: "ORGANIZATION_ONLY",
      applicationCodes: ["APP_SINTETICA"],
      sendInvitation: true
    });
    expect(JSON.stringify(payload)).not.toContain("ADMIN");
  });

  it("permite criar sem convite imediato", async () => {
    const criar = vi.spyOn(api, "createOrganizationUser").mockResolvedValue(
      provisionado({ invitationRequested: false, invitation: null })
    );
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();

    await userEvent.type(within(dialogo).getByLabelText("Nome completo"), "Pessoa Sintetica");
    await userEvent.type(within(dialogo).getByLabelText("E-mail"), "pessoa.sintetica@example.invalid");
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: /APP_SINTETICA/ }));
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: /Gerar o convite/ }));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar usuário" }));

    await waitFor(() => expect(criar).toHaveBeenCalled());
    expect(criar.mock.calls[0]![1]!.sendInvitation).toBe(false);
  });
});

describe("provisionamento de usuário — resultado", () => {
  async function provisionar(resposta = provisionado()) {
    vi.spyOn(api, "createOrganizationUser").mockResolvedValue(resposta);
    renderizarDetalhe();
    const dialogo = await abrirNovoUsuario();
    await userEvent.type(within(dialogo).getByLabelText("Nome completo"), "Pessoa Sintetica");
    await userEvent.type(within(dialogo).getByLabelText("E-mail"), "pessoa.sintetica@example.invalid");
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: /APP_SINTETICA/ }));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar usuário" }));
    return screen.findByRole("dialog", { name: "Usuário criado" });
  }

  it("mostra a pessoa, o vínculo e os acessos concedidos", async () => {
    const painel = await provisionar();

    expect(within(painel).getByText(/Pessoa Sintetica/)).toBeInTheDocument();
    expect(within(painel).getByText(/CUSTOMER · ORGANIZATION_ONLY/)).toBeInTheDocument();
    expect(within(painel).getByText("APP_SINTETICA (USER)")).toBeInTheDocument();
  });

  it("deixa explícito que a pessoa ainda não tem login habilitado", async () => {
    const painel = await provisionar();
    expect(within(painel).getByText(/só após aceitar o convite/i)).toBeInTheDocument();
  });

  it("mostra o link do convite com aviso de exibição única e botão de copiar", async () => {
    const painel = await provisionar();

    expect(within(painel).getByLabelText("Link do convite")).toHaveValue(
      "https://ingressa.example.invalid/convite#token-sintetico"
    );
    expect(within(painel).getByText(/uma única vez/i)).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
  });

  it("declara que não há envio de e-mail neste ambiente", async () => {
    const painel = await provisionar();
    expect(within(painel).getByText(/transporte SMTP não está ligado/i)).toBeInTheDocument();
    expect(within(painel).queryByRole("button", { name: /Enviar convite/i })).not.toBeInTheDocument();
  });

  it("convite não pedido não vira erro — o usuário continua criado", async () => {
    const painel = await provisionar(provisionado({ invitationRequested: false, invitation: null }));

    expect(within(painel).getByText(/Usuário criado/)).toBeInTheDocument();
    expect(within(painel).getByText(/Não foi pedido agora/i)).toBeInTheDocument();
    expect(within(painel).queryByLabelText("Link do convite")).not.toBeInTheDocument();
  });

  it("falha do convite NÃO faz parecer que o usuário falhou", async () => {
    const painel = await provisionar(
      provisionado({
        invitation: {
          outcome: "FAILED",
          reasonCode: "INVITATION_DELIVERY_FAILED",
          deliveryMode: null,
          expiresAt: null,
          delivered: false,
          manualLink: null
        }
      })
    );

    // Os dois fatos aparecem separados: a pessoa existe, o convite não.
    expect(within(painel).getByText(/criado em ATIVO/i)).toBeInTheDocument();
    expect(within(painel).getByText(/Convite não emitido/i)).toBeInTheDocument();
    expect(within(painel).getByText(/continua criado e correto/i)).toBeInTheDocument();
  });
});
