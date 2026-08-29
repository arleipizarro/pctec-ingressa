import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Gestão administrativa de organizações.
 *
 * Duas invariantes: a correção de nomes nunca apaga o nome fantasia por
 * omissão, e a associação a grupo só é oferecida onde ela de fato
 * funciona — COMPANY ainda sem grupo.
 */

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

const GRUPO_A = { public_id: "aaaa1111-1111-4111-8111-111111111111", type: "BUSINESS_GROUP", legal_name: "GRUPO ALFA", trade_name: "Alfa", status: "ACTIVE" };
const GRUPO_B = { public_id: "bbbb2222-2222-4222-8222-222222222222", type: "BUSINESS_GROUP", legal_name: "GRUPO BETA", trade_name: "Beta", status: "ACTIVE" };

function organizacao(overrides: Record<string, unknown> = {}) {
  return {
    ...fixtures.ORGANIZACAO_DETALHE,
    type: "COMPANY",
    legal_name: "EMPRESA SINTETICA LTDA",
    trade_name: "Sintetica",
    version: 2,
    parents: [],
    ...overrides
  } as never;
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={[`/admin/organizacoes/${fixtures.ORG_PUBLIC_ID}`]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN as never);
  vi.spyOn(api, "organization").mockResolvedValue(organizacao());
  vi.spyOn(api, "organizations").mockResolvedValue({ items: [GRUPO_A, GRUPO_B], total: 2, limit: 200, offset: 0 } as never);
});

afterEach(() => vi.restoreAllMocks());

async function abrirEdicao() {
  await userEvent.click(await screen.findByRole("button", { name: "Editar organização" }));
  return screen.findByRole("dialog", { name: "Editar organização" });
}

describe("edição da organização", () => {
  it("abre com os valores atuais e avisa que a origem não muda", async () => {
    renderizar();
    const dialogo = await abrirEdicao();

    expect(within(dialogo).getByLabelText("Razão social")).toHaveValue("EMPRESA SINTETICA LTDA");
    expect(within(dialogo).getByLabelText("Nome fantasia")).toHaveValue("Sintetica");
    expect(within(dialogo).getByText(/não é alterado/i)).toBeInTheDocument();
  });

  it("publicId e tipo aparecem como não editáveis", async () => {
    renderizar();
    const dialogo = await abrirEdicao();

    expect(within(dialogo).getAllByText(/não editável/i)).toHaveLength(2);
    expect(within(dialogo).queryByLabelText("Tipo")).not.toBeInTheDocument();
  });

  it("salva razão social e nome fantasia com a versão exibida", async () => {
    const renomear = vi.spyOn(api, "renameOrganization").mockResolvedValue({
      publicId: fixtures.ORG_PUBLIC_ID, legalName: "NOVA LTDA", tradeName: "Nova", version: 3, changed: true, changedFields: ["legalName", "tradeName"]
    });
    renderizar();
    const dialogo = await abrirEdicao();

    await userEvent.clear(within(dialogo).getByLabelText("Razão social"));
    await userEvent.type(within(dialogo).getByLabelText("Razão social"), "NOVA LTDA");
    await userEvent.clear(within(dialogo).getByLabelText("Nome fantasia"));
    await userEvent.type(within(dialogo).getByLabelText("Nome fantasia"), "Nova");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(renomear).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, {
        legalName: "NOVA LTDA", tradeName: "Nova", expectedVersion: 2
      })
    );
  });

  it("limpar o campo remove o nome fantasia", async () => {
    const renomear = vi.spyOn(api, "renameOrganization").mockResolvedValue({
      publicId: fixtures.ORG_PUBLIC_ID, legalName: "EMPRESA SINTETICA LTDA", tradeName: null, version: 3, changed: true, changedFields: ["tradeName"]
    });
    renderizar();
    const dialogo = await abrirEdicao();

    await userEvent.clear(within(dialogo).getByLabelText("Nome fantasia"));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(renomear.mock.calls[0]?.[1]).toMatchObject({ tradeName: "" }));
  });

  it("sem nenhuma mudança, salvar fica desabilitado", async () => {
    renderizar();
    const dialogo = await abrirEdicao();

    expect(within(dialogo).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("409 vira mensagem de recarregar e o formulário continua aberto", async () => {
    vi.spyOn(api, "renameOrganization").mockRejectedValue(
      new ApiError(409, "ORGANIZATION_VERSION_CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    renderizar();
    const dialogo = await abrirEdicao();
    await userEvent.type(within(dialogo).getByLabelText("Razão social"), " X");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/recarregue e tente de novo/i);
    expect(screen.getByRole("dialog", { name: "Editar organização" })).toBeInTheDocument();
  });

  it("403 vira mensagem de permissão, sem código interno", async () => {
    vi.spyOn(api, "renameOrganization").mockRejectedValue(
      new ApiError(403, "APPLICATION_ACCESS_DENIED", "Você não tem permissão para esta operação.")
    );
    renderizar();
    const dialogo = await abrirEdicao();
    await userEvent.type(within(dialogo).getByLabelText("Razão social"), " X");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/não tem permissão/i);
    expect(aviso.textContent ?? "").not.toContain("APPLICATION_ACCESS_DENIED");
  });

  it("422 chega legível", async () => {
    vi.spyOn(api, "renameOrganization").mockRejectedValue(
      new ApiError(422, "ORGANIZATION_LEGAL_NAME_INVALID", "Dados inválidos. Revise os campos.")
    );
    renderizar();
    const dialogo = await abrirEdicao();
    await userEvent.type(within(dialogo).getByLabelText("Razão social"), " X");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/dados inválidos/i);
  });

  it("sucesso fecha o modal e recarrega a tela", async () => {
    const detalhe = vi.spyOn(api, "organization").mockResolvedValue(organizacao());
    vi.spyOn(api, "renameOrganization").mockResolvedValue({
      publicId: fixtures.ORG_PUBLIC_ID, legalName: "NOVA LTDA", tradeName: "Sintetica", version: 3, changed: true, changedFields: ["legalName"]
    });
    renderizar();
    const dialogo = await abrirEdicao();
    await userEvent.type(within(dialogo).getByLabelText("Razão social"), " X");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/organização atualizada/i);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar organização" })).not.toBeInTheDocument());
    await waitFor(() => expect(detalhe.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("associação a grupo", () => {
  it("é oferecida para COMPANY sem grupo", async () => {
    renderizar();
    expect(await screen.findByRole("button", { name: "Associar a um grupo" })).toBeInTheDocument();
  });

  it("NÃO é oferecida para COMPANY que já tem grupo, e a tela explica por quê", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(organizacao({ parents: [GRUPO_A] }));
    renderizar();

    await screen.findByRole("heading", { name: "Hierarquia" });
    expect(screen.queryByRole("button", { name: "Associar a um grupo" })).not.toBeInTheDocument();
    expect(screen.getByText(/ainda não é possível/i)).toBeInTheDocument();
    expect(screen.getByText(/Grupo atual:/)).toBeInTheDocument();
  });

  it("NÃO é oferecida para BUSINESS_GROUP", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(organizacao({ type: "BUSINESS_GROUP" }));
    renderizar();

    await screen.findByRole("button", { name: "Editar organização" });
    expect(screen.queryByRole("button", { name: "Associar a um grupo" })).not.toBeInTheDocument();
  });

  it("a busca filtra os grupos e o aviso explica o impacto em AND_DESCENDANTS", async () => {
    renderizar();
    await userEvent.click(await screen.findByRole("button", { name: "Associar a um grupo" }));
    const dialogo = await screen.findByRole("dialog", { name: "Associar a um grupo" });

    expect(within(dialogo).getByText(/organização e descendentes/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/Nenhum vínculo é criado, encerrado ou ampliado/i)).toBeInTheDocument();

    await userEvent.type(within(dialogo).getByLabelText("Buscar grupo"), "beta");
    expect(within(dialogo).getByRole("option", { name: "Beta" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("option", { name: "Alfa" })).not.toBeInTheDocument();
  });

  it("associa usando o grupo escolhido", async () => {
    const associar = vi.spyOn(api, "associateParent").mockResolvedValue(undefined);
    renderizar();
    await userEvent.click(await screen.findByRole("button", { name: "Associar a um grupo" }));
    const dialogo = await screen.findByRole("dialog", { name: "Associar a um grupo" });

    await userEvent.selectOptions(within(dialogo).getByLabelText("Grupo empresarial"), GRUPO_B.public_id);
    await userEvent.click(within(dialogo).getByRole("button", { name: "Associar" }));

    await waitFor(() => expect(associar).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, GRUPO_B.public_id));
  });

  it("sem grupo escolhido, o botão fica desabilitado", async () => {
    renderizar();
    await userEvent.click(await screen.findByRole("button", { name: "Associar a um grupo" }));
    const dialogo = await screen.findByRole("dialog", { name: "Associar a um grupo" });

    expect(within(dialogo).getByRole("button", { name: "Associar" })).toBeDisabled();
  });

  it("conflito do servidor (já vinculada) chega legível", async () => {
    vi.spyOn(api, "associateParent").mockRejectedValue(
      new ApiError(409, "ORGANIZATION_RELATIONSHIP_CHILD_ALREADY_LINKED", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    renderizar();
    await userEvent.click(await screen.findByRole("button", { name: "Associar a um grupo" }));
    const dialogo = await screen.findByRole("dialog", { name: "Associar a um grupo" });
    await userEvent.selectOptions(within(dialogo).getByLabelText("Grupo empresarial"), GRUPO_A.public_id);
    await userEvent.click(within(dialogo).getByRole("button", { name: "Associar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/recarregue e tente de novo/i);
  });
});
