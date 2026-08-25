import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConvitePage } from "../pages/ConvitePage.js";
import { api, ApiError } from "../api.js";
import { esquecerTokenDoConviteParaTeste } from "../tokenDoConvite.js";

/**
 * Token sintético. Nenhum valor real — o teste-guarda
 * `semPiiNasFixtures.test.ts` cobre o resto das fixtures.
 */
const TOKEN = "token-sintetico-de-convite-abc123";

function abrirConviteCom(fragmento: string): void {
  window.history.replaceState(null, "", `/convite${fragmento}`);
}

function renderizar() {
  return render(
    <MemoryRouter>
      <ConvitePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  // O módulo memoriza o token capturado; sem isto, um teste herdaria o
  // token do anterior e a asserção mediria a coisa errada.
  esquecerTokenDoConviteParaTeste();
  abrirConviteCom(`#${TOKEN}`);
  vi.spyOn(api, "previewConvite").mockResolvedValue({
    fullName: "Pessoa Convidada Sintetica",
    expiresAt: "2026-09-01T12:00:00.000Z"
  });
  vi.spyOn(api, "definirSenhaPorConvite").mockResolvedValue({
    identity: { publicId: "11111111-1111-4111-8111-111111111111" },
    loginEnabled: true
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  esquecerTokenDoConviteParaTeste();
  window.history.replaceState(null, "", "/");
});

describe("token do convite — remoção imediata do fragmento", () => {
  it("o fragmento sai da URL antes de qualquer chamada de API", async () => {
    // O momento exato importa: a captura precisa ter apagado o fragmento
    // ANTES da primeira ida ao servidor, não depois dela.
    let hashNoMomentoDaChamada: string | null = null;
    vi.spyOn(api, "previewConvite").mockImplementation(async (token: string) => {
      hashNoMomentoDaChamada = window.location.hash;
      expect(token).toBe(TOKEN);
      return { fullName: "Pessoa Convidada Sintetica", expiresAt: "2026-09-01T12:00:00.000Z" };
    });

    renderizar();

    await waitFor(() => expect(hashNoMomentoDaChamada).not.toBeNull());
    expect(hashNoMomentoDaChamada).toBe("");
  });

  it("quando o formulário aparece, a barra de endereço já está limpa", async () => {
    renderizar();

    expect(await screen.findByLabelText("Nova senha")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe("/convite");
  });

  it("a remoção acontece já na primeira renderização, antes do formulário existir", async () => {
    renderizar();

    // Asserção SÍNCRONA, antes de qualquer `await`: nada de assíncrono
    // rodou ainda — nem o `preview`, nem o formulário existe — e o
    // fragmento já saiu.
    expect(window.location.hash).toBe("");
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();

    // Deixa o efeito pendente terminar dentro do teste, para não vazar
    // atualização de estado para fora dele.
    await screen.findByLabelText("Nova senha");
  });

  it("usa `replaceState`: a URL com token não fica alcançável pelo botão voltar", async () => {
    const substituir = vi.spyOn(window.history, "replaceState");
    const empilhar = vi.spyOn(window.history, "pushState");

    renderizar();

    expect(substituir).toHaveBeenCalledTimes(1);
    expect(empilhar).not.toHaveBeenCalled();

    await screen.findByLabelText("Nova senha");
  });

  it("o token some da URL mas CONTINUA em memória — o resgate ainda funciona", async () => {
    const definir = vi.spyOn(api, "definirSenhaPorConvite");
    renderizar();

    const senha = await screen.findByLabelText("Nova senha");
    await userEvent.type(senha, "senha-sintetica-longa");
    await userEvent.type(screen.getByLabelText("Confirme a senha"), "senha-sintetica-longa");
    await userEvent.click(screen.getByRole("button", { name: "Definir senha" }));

    await waitFor(() =>
      expect(definir).toHaveBeenCalledWith(TOKEN, "senha-sintetica-longa", "senha-sintetica-longa")
    );
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("o token nunca aparece no texto da tela — nem no sucesso", async () => {
    renderizar();

    const senha = await screen.findByLabelText("Nova senha");
    await userEvent.type(senha, "senha-sintetica-longa");
    await userEvent.type(screen.getByLabelText("Confirme a senha"), "senha-sintetica-longa");
    await userEvent.click(screen.getByRole("button", { name: "Definir senha" }));

    expect(await screen.findByText("Senha definida")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("convite recusado: a mensagem de erro não carrega o token", async () => {
    vi.spyOn(api, "previewConvite").mockRejectedValue(new ApiError(401, "INVITATION_NOT_USABLE", "falhou"));

    renderizar();

    expect(await screen.findByText(/Convite inválido, expirado ou já utilizado/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("erro ao definir a senha também não vaza o token na tela", async () => {
    vi.spyOn(api, "definirSenhaPorConvite").mockRejectedValue(
      new ApiError(422, "CREDENTIAL_PASSWORD_POLICY_VIOLATION", "Dados inválidos. Revise os campos.")
    );

    renderizar();
    const senha = await screen.findByLabelText("Nova senha");
    await userEvent.type(senha, "senha-sintetica-longa");
    await userEvent.type(screen.getByLabelText("Confirme a senha"), "senha-sintetica-longa");
    await userEvent.click(screen.getByRole("button", { name: "Definir senha" }));

    expect(await screen.findByText("Dados inválidos. Revise os campos.")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(TOKEN);
  });

  it("sem fragmento, a tela pede um convite novo e nunca chama a API", async () => {
    esquecerTokenDoConviteParaTeste();
    abrirConviteCom("");
    const previa = vi.spyOn(api, "previewConvite");

    renderizar();

    expect(await screen.findByText(/Link de convite incompleto/)).toBeInTheDocument();
    expect(previa).not.toHaveBeenCalled();
  });
});
