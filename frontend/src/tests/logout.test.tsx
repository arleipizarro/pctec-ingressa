import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Encerramento de sessão nas DUAS telas com botão "Sair".
 *
 * O bug que estes testes travam: `sair()` usava `try { await api.logout()
 * } finally { ... }`. `finally` limpa e **relança**, então um logout que
 * falha devolvia uma promise rejeitada ao `onClick` — rejeição não
 * capturada. A limpeza rodava, o que mascarava o problema: a tela parecia
 * funcionar, e só o gate de teste ficava vermelho.
 *
 * A rejeição não capturada é verificada de forma direta, ouvindo
 * `unhandledrejection`: asserção sobre a tela não a pegaria, porque a
 * tela já estava certa.
 */

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

/** Sem PCTEC_INGRESSA: cai no launcher, que tem o outro botão "Sair". */
const PAINEL_USUARIO = {
  identity: { publicId: fixtures.IDENTIDADE_PUBLIC_ID, fullName: "Pessoa Sintetica" },
  applications: [{ code: "PCTEC_PORTAL", name: "Portal", profile: "USER", launchUrl: "https://portal.example.invalid" }]
};

const AVISO = /o servidor não confirmou o encerramento da sessão/i;

function renderizar(rota: string) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>
  );
}

/** Captura rejeições não tratadas durante o bloco. */
function observarRejeicoes(): { rejeicoes: unknown[]; parar: () => void } {
  const rejeicoes: unknown[] = [];
  const ouvinte = (evento: PromiseRejectionEvent): void => {
    evento.preventDefault();
    rejeicoes.push(evento.reason);
  };
  window.addEventListener("unhandledrejection", ouvinte);
  return { rejeicoes, parar: () => window.removeEventListener("unhandledrejection", ouvinte) };
}

beforeEach(() => {
  vi.spyOn(api, "organizacoes").mockResolvedValue({ organizations: [] });
});

afterEach(() => vi.restoreAllMocks());

describe.each([
  ["painel administrativo", "/admin", PAINEL_ADMIN],
  ["launcher de aplicativos", "/apps", PAINEL_USUARIO]
])("logout — %s", (_nome, rota, painel) => {
  beforeEach(() => {
    vi.spyOn(api, "apps").mockResolvedValue(painel as never);
  });

  it("logout normal encerra a sessão e volta ao login, sem aviso", async () => {
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    renderizar(rota);

    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByLabelText("E-mail")).toBeInTheDocument();
    // Nada deu errado: avisar aqui seria alarme falso a cada saída.
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it("falha do servidor NÃO gera rejeição não tratada", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(new ApiError(500, "X", "Erro interno."));
    const observador = observarRejeicoes();
    renderizar(rota);

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Sair" }));
      await screen.findByLabelText("E-mail");
      // Uma volta pelo event loop para qualquer rejeição pendente aflorar.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(observador.rejeicoes).toEqual([]);
    } finally {
      observador.parar();
    }
  });

  it("falha do servidor ainda derruba a sessão local e volta ao login", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(new ApiError(500, "X", "Erro interno."));
    renderizar(rota);

    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));

    // A intenção original preservada: ninguém fica preso na tela.
    expect(await screen.findByLabelText("E-mail")).toBeInTheDocument();
  });

  it("falha do servidor avisa que a sessão pode continuar válida", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(new ApiError(500, "X", "Erro interno."));
    renderizar(rota);

    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));

    // O cookie é HttpOnly: o SPA não tem como apagá-lo. Sumir da tela
    // como se tivesse saído seria a versão confortável e errada.
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
  });

  it("erro de rede, e não da API, também é tratado", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(new TypeError("Failed to fetch"));
    const observador = observarRejeicoes();
    renderizar(rota);

    try {
      await userEvent.click(await screen.findByRole("button", { name: "Sair" }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(observador.rejeicoes).toEqual([]);
      expect(await screen.findByText(AVISO)).toBeInTheDocument();
    } finally {
      observador.parar();
    }
  });
});

describe("aviso de logout incompleto", () => {
  it("não aparece numa visita direta ao login", async () => {
    vi.spyOn(api, "apps").mockRejectedValue(new ApiError(401, "X", "Sem sessão."));
    renderizar("/login");

    await screen.findByLabelText("E-mail");
    // O aviso vem de estado de navegação, não de URL: ninguém o provoca
    // digitando um link.
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });
});
