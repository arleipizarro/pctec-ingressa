import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

const SESSAO_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  access: { profile: "ADMIN" }
};

function renderizar() {
  return render(
    <MemoryRouter initialEntries={[`/organizacoes/${fixtures.ORG_PUBLIC_ID}`]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "whoami").mockResolvedValue(SESSAO_ADMIN);
  vi.spyOn(api, "organization").mockResolvedValue(fixtures.ORGANIZACAO_DETALHE);
  vi.spyOn(api, "renameOrganization").mockResolvedValue({
    publicId: fixtures.ORG_PUBLIC_ID,
    legalName: "EMPRESA CORRIGIDA LTDA",
    tradeName: "CORRIGIDA",
    version: 4,
    changed: true,
    changedFields: ["legal_name", "trade_name"]
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function abrirFormulario() {
  renderizar();
  await userEvent.click(await screen.findByRole("button", { name: "Editar organização" }));
  return screen.getByRole("dialog", { name: "Editar organização" });
}

describe("editar organização", () => {
  it("o detalhe oferece a ação de editar", async () => {
    renderizar();
    expect(await screen.findByRole("button", { name: "Editar organização" })).toBeInTheDocument();
  });

  it("o formulário abre preenchido com os nomes atuais", async () => {
    const dialogo = await abrirFormulario();

    expect(within(dialogo).getByLabelText("Razão social")).toHaveValue(fixtures.ORGANIZACAO.legal_name);
    expect(within(dialogo).getByLabelText("Nome fantasia")).toHaveValue(fixtures.ORGANIZACAO.trade_name);
  });

  it("só existem os dois campos de nome — tipo, situação e documento não são editáveis", async () => {
    const dialogo = await abrirFormulario();

    expect(within(dialogo).getAllByRole("textbox")).toHaveLength(2);
    for (const proibido of ["Tipo", "Situação", "Status", "Documento", "CNPJ"]) {
      expect(within(dialogo).queryByLabelText(new RegExp(proibido, "i"))).toBeNull();
    }
    expect(within(dialogo).getByText(/não são alterados por esta tela/)).toBeInTheDocument();
  });

  it("razão social vazia bloqueia o salvamento e explica o porquê", async () => {
    const dialogo = await abrirFormulario();

    await userEvent.clear(within(dialogo).getByLabelText("Razão social"));

    expect(within(dialogo).getByRole("alert")).toHaveTextContent(/não pode ficar vazia/);
    expect(within(dialogo).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(api.renameOrganization).not.toHaveBeenCalled();
  });

  it("sem nenhuma mudança, salvar fica indisponível", async () => {
    const dialogo = await abrirFormulario();
    expect(within(dialogo).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("envia nomes normalizados e a versão lida, e recarrega a tela", async () => {
    const dialogo = await abrirFormulario();
    const razao = within(dialogo).getByLabelText("Razão social");

    await userEvent.clear(razao);
    await userEvent.type(razao, "  EMPRESA CORRIGIDA LTDA  ");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(api.renameOrganization).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, {
        legalName: "EMPRESA CORRIGIDA LTDA",
        tradeName: fixtures.ORGANIZACAO.trade_name,
        expectedVersion: fixtures.ORGANIZACAO_DETALHE.version
      })
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/atualizada \(versão 4\)/);
    await waitFor(() => expect(vi.mocked(api.organization).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("limpar o nome fantasia envia string vazia", async () => {
    const dialogo = await abrirFormulario();

    await userEvent.clear(within(dialogo).getByLabelText("Nome fantasia"));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(api.renameOrganization).toHaveBeenCalledWith(
        fixtures.ORG_PUBLIC_ID,
        expect.objectContaining({ tradeName: "" })
      )
    );
  });

  it("cancelar fecha sem chamar a API", async () => {
    const dialogo = await abrirFormulario();

    await userEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.renameOrganization).not.toHaveBeenCalled();
  });

  it("409 fecha o formulário, avisa e recarrega — nunca sobrescreve quem chegou antes", async () => {
    vi.spyOn(api, "renameOrganization").mockRejectedValue(
      new ApiError(409, "ORGANIZATION_VERSION_CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    const dialogo = await abrirFormulario();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), " X");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/mudou desde que a tela carregou/);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(api.organization).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it.each([
    [403, /permissão/i],
    [422, /Dados inválidos/i]
  ])("erro %s vira alerta e o formulário continua aberto", async (status, esperado) => {
    vi.spyOn(api, "renameOrganization").mockRejectedValue(
      new ApiError(status, "X", status === 403 ? "Você não tem permissão para esta operação." : "Dados inválidos. Revise os campos.")
    );
    const dialogo = await abrirFormulario();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), " X");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(esperado);
    expect(screen.getByRole("dialog", { name: "Editar organização" })).toBeInTheDocument();
  });

  it("quando nada mudou no servidor, a tela diz isso em vez de fingir sucesso", async () => {
    vi.spyOn(api, "renameOrganization").mockResolvedValue({
      publicId: fixtures.ORG_PUBLIC_ID,
      legalName: fixtures.ORGANIZACAO.legal_name,
      tradeName: fixtures.ORGANIZACAO.trade_name,
      version: fixtures.ORGANIZACAO_DETALHE.version,
      changed: false,
      changedFields: []
    });
    const dialogo = await abrirFormulario();

    await userEvent.type(within(dialogo).getByLabelText("Razão social"), " X");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Nada mudou/);
  });
});
