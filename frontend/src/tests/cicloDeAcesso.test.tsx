import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Ciclo de acesso de uma Identity pela tela administrativa.
 *
 * O que estes testes protegem: **ação incompatível com o estado atual
 * não é oferecida**, toda mutação passa por confirmação, e o token do
 * convite aparece uma única vez e nunca volta.
 */

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

const LINK = "https://ingressa.example.invalid/convite#token-sintetico-abc";

const SESSAO = {
  public_id: "5555aaaa-1111-4111-8111-111111111111",
  status: "ACTIVE",
  created_at: "2026-08-25T10:00:00.000Z",
  last_seen_at: "2026-08-25T11:30:00.000Z",
  expires_at: "2026-08-25T18:00:00.000Z"
};

const CONVITE_PENDENTE = {
  public_id: "6666bbbb-1111-4111-8111-111111111111",
  status: "PENDING", delivery_mode: "MANUAL_DEV",
  created_at: "2026-08-25T10:00:00.000Z", expires_at: "2026-08-26T10:00:00.000Z",
  consumed_at: null, revoked_at: null, expired: 0
};

const CONVITE_EXPIRADO = { ...CONVITE_PENDENTE, public_id: "7777cccc-1111-4111-8111-111111111111", expired: 1 };

/** Identidade elegível a convite: ACTIVE, federada, ainda sem login. */
function identidade(overrides: Record<string, unknown> = {}) {
  return { ...fixtures.IDENTIDADE_DETALHE, status: "ACTIVE", login_enabled: 0, version: 3, ...overrides } as never;
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={[`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN as never);
  vi.spyOn(api, "identity").mockResolvedValue(identidade());
  vi.spyOn(api, "applications").mockResolvedValue(fixtures.APLICACOES);
  vi.spyOn(api, "organizations").mockResolvedValue(fixtures.PAGINA_ORGANIZACOES_COM_GRUPO);
  vi.spyOn(api, "sessions").mockResolvedValue({ items: [] });
  vi.spyOn(api, "invitations").mockResolvedValue({ items: [] });
});

afterEach(() => vi.restoreAllMocks());

async function confirmarDialogo(nome: string | RegExp) {
  await userEvent.click(await screen.findByRole("button", { name: nome }));
  const dialogo = await screen.findByRole("dialog");
  await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));
}

describe("convite de acesso", () => {
  it("oferece 'Criar convite' para ACTIVE sem login habilitado", async () => {
    renderizar();
    expect(await screen.findByRole("button", { name: "Criar convite" })).toBeInTheDocument();
  });

  it("esconde a ação quando o login já está habilitado", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ login_enabled: 1 }));
    renderizar();

    await screen.findByRole("heading", { name: "Login e convite" });
    expect(screen.queryByRole("button", { name: "Criar convite" })).not.toBeInTheDocument();
    expect(screen.getByText(/já define login por senha própria/i)).toBeInTheDocument();
  });

  it("exige confirmação e usa a API de convites existente", async () => {
    const convidar = vi.spyOn(api, "convidar").mockResolvedValue({
      deliveryMode: "MANUAL_DEV",
      results: [{ identityPublicId: fixtures.IDENTIDADE_PUBLIC_ID, fullName: "X", outcome: "CREATED", reasonCode: null, invitationPublicId: "i", expiresAt: null, deliveryMode: "MANUAL_DEV", delivered: false, manualLink: LINK }]
    });
    renderizar();

    await confirmarDialogo("Criar convite");

    await waitFor(() => expect(convidar).toHaveBeenCalledWith([fixtures.IDENTIDADE_PUBLIC_ID]));
  });

  it("mostra o link UMA vez, com botão Copiar", async () => {
    vi.spyOn(api, "convidar").mockResolvedValue({
      deliveryMode: "MANUAL_DEV",
      results: [{ identityPublicId: fixtures.IDENTIDADE_PUBLIC_ID, fullName: "X", outcome: "CREATED", reasonCode: null, invitationPublicId: "i", expiresAt: null, deliveryMode: "MANUAL_DEV", delivered: false, manualLink: LINK }]
    });
    renderizar();
    await confirmarDialogo("Criar convite");

    expect(await screen.findByText(LINK)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    // Aparece na mensagem de sucesso e na caixa do link — as duas dizem
    // a mesma coisa de propósito.
    expect(screen.getAllByText(/não é exibido de novo/i).length).toBeGreaterThan(0);
  });

  it("o token NÃO reaparece na listagem de convites", async () => {
    vi.spyOn(api, "invitations").mockResolvedValue({ items: [CONVITE_PENDENTE] });
    renderizar();

    await screen.findByRole("heading", { name: "Login e convite" });
    // A listagem mostra situação e validade — nunca o token.
    expect(document.body.textContent ?? "").not.toContain("token-sintetico-abc");
    expect(screen.getByText(/26\/08\/2026/)).toBeInTheDocument();
  });

  it("convite pulado pelo servidor vira mensagem com o motivo", async () => {
    vi.spyOn(api, "convidar").mockResolvedValue({
      deliveryMode: "MANUAL_DEV",
      results: [{ identityPublicId: fixtures.IDENTIDADE_PUBLIC_ID, fullName: "X", outcome: "SKIPPED", reasonCode: "CREDENTIAL_ALREADY_EXISTS", invitationPublicId: null, expiresAt: null, deliveryMode: null, delivered: false, manualLink: null }]
    });
    renderizar();
    await confirmarDialogo("Criar convite");

    expect(await screen.findByRole("alert")).toHaveTextContent(/CREDENTIAL_ALREADY_EXISTS/);
  });

  /** A linha do convite — "Revogar" também existe na seção de acessos. */
  const linhaDoConvite = (situacao: string) =>
    within(screen.getByText(situacao).closest("tr") as HTMLElement);

  it("pendente pode ser revogado", async () => {
    vi.spyOn(api, "invitations").mockResolvedValue({ items: [CONVITE_PENDENTE] });
    renderizar();
    await screen.findByText("PENDENTE");

    expect(linhaDoConvite("PENDENTE").getByRole("button", { name: "Revogar" })).toBeInTheDocument();
  });

  it("expirado NÃO oferece revogação — não mudaria nada e o servidor recusaria", async () => {
    vi.spyOn(api, "invitations").mockResolvedValue({ items: [CONVITE_EXPIRADO] });
    renderizar();
    await screen.findByText("EXPIRADO");

    expect(linhaDoConvite("EXPIRADO").queryByRole("button", { name: "Revogar" })).not.toBeInTheDocument();
  });

  it("revogar convite chama a API com o convite certo", async () => {
    vi.spyOn(api, "invitations").mockResolvedValue({ items: [CONVITE_PENDENTE] });
    const revogar = vi.spyOn(api, "revokeInvitation").mockResolvedValue(undefined);
    renderizar();
    await screen.findByText("PENDENTE");

    await userEvent.click(linhaDoConvite("PENDENTE").getByRole("button", { name: "Revogar" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/link deixa de valer imediatamente/i)).toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(revogar).toHaveBeenCalledWith(CONVITE_PENDENTE.public_id));
  });
});

describe("sessões", () => {
  it("sem sessões, informa e não oferece encerramento", async () => {
    renderizar();
    await screen.findByRole("heading", { name: "Sessões ativas" });

    expect(screen.getByText("Nenhuma sessão ativa.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Encerrar todas as sessões" })).not.toBeInTheDocument();
  });

  it("lista criação, última atividade e expiração — nunca token ou hash", async () => {
    vi.spyOn(api, "sessions").mockResolvedValue({ items: [SESSAO] });
    renderizar();

    await screen.findByRole("heading", { name: "Sessões ativas" });
    expect(screen.getByText("Criada")).toBeInTheDocument();
    expect(screen.getByText("Última atividade")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(SESSAO.public_id);
    expect(document.body.textContent ?? "").not.toMatch(/[0-9a-f]{64}/);
  });

  it("encerrar todas exige confirmação e atualiza a tela", async () => {
    vi.spyOn(api, "sessions").mockResolvedValue({ items: [SESSAO] });
    const encerrar = vi.spyOn(api, "revokeAllSessions").mockResolvedValue({ revoked: 1 });
    renderizar();

    await confirmarDialogo("Encerrar todas as sessões");

    await waitFor(() => expect(encerrar).toHaveBeenCalledWith(fixtures.IDENTIDADE_PUBLIC_ID));
    expect(await screen.findByRole("alert")).toHaveTextContent(/1 sessão\(ões\) encerrada/);
  });
});

describe("bloqueio", () => {
  it("oferece bloquear apenas para ACTIVE", async () => {
    renderizar();
    expect(await screen.findByRole("button", { name: "Bloquear usuário" })).toBeInTheDocument();
  });

  it("não oferece para quem já está bloqueado", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ status: "BLOCKED" }));
    renderizar();

    await screen.findByRole("heading", { name: "Login e convite" });
    expect(screen.queryByRole("button", { name: "Bloquear usuário" })).not.toBeInTheDocument();
  });

  it("a confirmação explica a consequência e envia a versão exibida", async () => {
    const bloquear = vi.spyOn(api, "blockIdentity").mockResolvedValue({ status: "BLOCKED", sessionsRevoked: 2 });
    renderizar();

    await userEvent.click(await screen.findByRole("button", { name: "Bloquear usuário" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/sessões ativas são encerradas na mesma operação/i)).toBeInTheDocument();
    expect(within(dialogo).getByText(/Memberships, acessos e referências são preservados/i)).toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    // `expectedVersion` sai da linha exibida — trava otimista real.
    await waitFor(() => expect(bloquear).toHaveBeenCalledWith(fixtures.IDENTIDADE_PUBLIC_ID, 3));
    expect(await screen.findByRole("alert")).toHaveTextContent(/2 sessão\(ões\) encerrada/);
  });

  it("409 do servidor vira mensagem de recarregar, não erro técnico", async () => {
    vi.spyOn(api, "blockIdentity").mockRejectedValue(
      new ApiError(409, "IDENTITY_VERSION_CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    renderizar();

    await confirmarDialogo("Bloquear usuário");

    expect(await screen.findByRole("alert")).toHaveTextContent(/recarregue e tente de novo/i);
  });

  it("403 vira mensagem de permissão, sem detalhe interno", async () => {
    vi.spyOn(api, "blockIdentity").mockRejectedValue(
      new ApiError(403, "APPLICATION_ACCESS_DENIED", "Você não tem permissão para esta operação.")
    );
    renderizar();

    await confirmarDialogo("Bloquear usuário");

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/não tem permissão/i);
    expect(aviso.textContent ?? "").not.toContain("APPLICATION_ACCESS_DENIED");
  });
});


describe("desbloqueio", () => {
  it("não é oferecido para Identity ACTIVE", async () => {
    renderizar();
    await screen.findByRole("button", { name: "Bloquear usuário" });

    expect(screen.queryByRole("button", { name: "Desbloquear usuário" })).not.toBeInTheDocument();
  });

  it("aparece apenas para Identity BLOCKED, e o bloquear some", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ status: "BLOCKED" }));
    renderizar();

    expect(await screen.findByRole("button", { name: "Desbloquear usuário" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bloquear usuário" })).not.toBeInTheDocument();
  });

  it("a confirmação diz o que NÃO volta, e envia a versão exibida", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ status: "BLOCKED" }));
    const desbloquear = vi.spyOn(api, "unblockIdentity").mockResolvedValue({ status: "ACTIVE", loginEnabled: false });
    renderizar();

    await userEvent.click(await screen.findByRole("button", { name: "Desbloquear usuário" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Sessões encerradas NÃO voltam/i)).toBeInTheDocument();
    expect(within(dialogo).getByText(/nenhum convite, membership ou acesso é recriado/i)).toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(desbloquear).toHaveBeenCalledWith(fixtures.IDENTIDADE_PUBLIC_ID, 3));
  });

  it("a mensagem informa que o login permanece como estava", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ status: "BLOCKED" }));
    vi.spyOn(api, "unblockIdentity").mockResolvedValue({ status: "ACTIVE", loginEnabled: false });
    renderizar();

    await confirmarDialogo("Desbloquear usuário");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Login segue desabilitado/i);
  });

  it("409 vira mensagem de recarregar", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ status: "BLOCKED" }));
    vi.spyOn(api, "unblockIdentity").mockRejectedValue(
      new ApiError(409, "IDENTITY_VERSION_CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    renderizar();

    await confirmarDialogo("Desbloquear usuário");

    expect(await screen.findByRole("alert")).toHaveTextContent(/recarregue e tente de novo/i);
  });

  it("403 vira mensagem de permissão, sem detalhe interno", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ status: "BLOCKED" }));
    vi.spyOn(api, "unblockIdentity").mockRejectedValue(
      new ApiError(403, "APPLICATION_ACCESS_DENIED", "Você não tem permissão para esta operação.")
    );
    renderizar();

    await confirmarDialogo("Desbloquear usuário");

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/não tem permissão/i);
    expect(aviso.textContent ?? "").not.toContain("APPLICATION_ACCESS_DENIED");
  });

  it("422 do domínio chega legível", async () => {
    vi.spyOn(api, "identity").mockResolvedValue(identidade({ status: "BLOCKED" }));
    vi.spyOn(api, "unblockIdentity").mockRejectedValue(
      new ApiError(422, "IDENTITY_STATUS_TRANSITION_INVALID", "Dados inválidos. Revise os campos.")
    );
    renderizar();

    await confirmarDialogo("Desbloquear usuário");

    expect(await screen.findByRole("alert")).toHaveTextContent(/dados inválidos/i);
  });
});
