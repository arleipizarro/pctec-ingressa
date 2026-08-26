import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, type EventoDeAuditoria } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Tela de auditoria administrativa.
 *
 * O que estes testes protegem: a ordem vem do servidor e a tela não a
 * refaz; o payload exibido é o REDIGIDO; o evento de convite nunca
 * mostra token; e cada linha aponta para a tela certa — pessoa ou
 * organização — sem inventar link quando não há destino.
 */

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

const IDENTITY_ALVO = "99999999-9999-4999-8999-999999999999";

function evento(overrides: Partial<EventoDeAuditoria> = {}): EventoDeAuditoria {
  return {
    event_public_id: "eeee1111-1111-4111-8111-111111111111",
    event_type: "identity.created",
    event_version: 1,
    aggregate_public_id: IDENTITY_ALVO,
    actor_public_id: fixtures.ADMIN_PUBLIC_ID,
    actor_full_name: "Administrador Sintetico",
    correlation_id: "cccc1111-1111-4111-8111-111111111111",
    causation_id: null,
    occurred_at: "2026-08-26T12:00:00.000Z",
    persisted_at: "2026-08-26T12:00:00.010Z",
    payload: { fields: { publicId: IDENTITY_ALVO, status: "PENDING" }, redactedFields: [] },
    ...overrides
  };
}

function pagina(items: readonly EventoDeAuditoria[]) {
  return { items, total: items.length, limit: 25, offset: 0 } as never;
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={["/admin/auditoria"]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN as never);
  vi.spyOn(api, "auditEventTypes").mockResolvedValue({
    items: ["identity.created", "identity-invitation.created", "organization.created"]
  });
  vi.spyOn(api, "auditEvents").mockResolvedValue(pagina([evento()]));
});

afterEach(() => vi.restoreAllMocks());

describe("navegação", () => {
  it("a auditoria está no menu administrativo", async () => {
    renderizar();
    expect(await screen.findByRole("link", { name: "Auditoria" })).toBeInTheDocument();
  });
});

describe("listagem", () => {
  it("mostra data/hora, tipo, ator, entidade e resumo", async () => {
    renderizar();

    const linha = (await screen.findByText("identity.created")).closest("tr")!;
    expect(within(linha).getByText("Administrador Sintetico")).toBeInTheDocument();
    expect(within(linha).getByText("Identidade criada")).toBeInTheDocument();
  });

  it("um tipo sem resumo mapeado ainda aparece, com o próprio identificador", async () => {
    vi.spyOn(api, "auditEvents").mockResolvedValue(pagina([evento({ event_type: "algo.novo-ainda-nao-mapeado" })]));
    renderizar();

    // Sumir de uma trilha de auditoria é pior que aparecer feio: sem
    // resumo mapeado, o identificador aparece nas duas colunas.
    expect(await screen.findAllByText("algo.novo-ainda-nao-mapeado")).toHaveLength(2);
  });

  it("ator sem Identity conhecida mostra o marcador, nunca um nome inventado", async () => {
    vi.spyOn(api, "auditEvents").mockResolvedValue(
      pagina([evento({ actor_public_id: "BOOTSTRAP", actor_full_name: null })])
    );
    renderizar();

    expect(await screen.findByText("BOOTSTRAP")).toBeInTheDocument();
  });

  it("não reordena o que o servidor mandou", async () => {
    const antigo = evento({
      event_public_id: "eeee2222-2222-4222-8222-222222222222",
      occurred_at: "2020-01-01T00:00:00.000Z",
      event_type: "organization.created"
    });
    vi.spyOn(api, "auditEvents").mockResolvedValue(pagina([evento(), antigo]));
    renderizar();

    await screen.findByText("identity.created");
    const tipos = screen.getAllByRole("row").slice(1).map((linha) => linha.querySelector("code")!.textContent);
    expect(tipos).toEqual(["identity.created", "organization.created"]);
  });
});

describe("links para a entidade afetada", () => {
  it("evento de identidade aponta para a tela da pessoa", async () => {
    renderizar();
    const linha = (await screen.findByText("identity.created")).closest("tr")!;
    expect(within(linha).getByRole("link", { name: "Identidade" })).toHaveAttribute(
      "href",
      `/admin/usuarios/${IDENTITY_ALVO}`
    );
  });

  it("evento de organização aponta para a tela da organização", async () => {
    vi.spyOn(api, "auditEvents").mockResolvedValue(
      pagina([evento({ event_type: "organization.created", aggregate_public_id: fixtures.ORG_PUBLIC_ID })])
    );
    renderizar();

    const linha = (await screen.findByText("organization.created")).closest("tr")!;
    expect(within(linha).getByRole("link", { name: "Organização" })).toHaveAttribute(
      "href",
      `/admin/organizacoes/${fixtures.ORG_PUBLIC_ID}`
    );
  });

  it("convite aponta para a PESSOA, não para o agregado do convite", async () => {
    vi.spyOn(api, "auditEvents").mockResolvedValue(
      pagina([
        evento({
          event_type: "identity-invitation.created",
          aggregate_public_id: "1111aaaa-1111-4111-8111-111111111111",
          payload: {
            fields: { invitationPublicId: "1111aaaa-1111-4111-8111-111111111111", identityPublicId: IDENTITY_ALVO },
            redactedFields: []
          }
        })
      ])
    );
    renderizar();

    // O agregado do evento é o convite, que não tem tela. O destino útil
    // é quem foi convidado.
    const linha = (await screen.findByText("identity-invitation.created")).closest("tr")!;
    expect(within(linha).getByRole("link", { name: "Identidade" })).toHaveAttribute(
      "href",
      `/admin/usuarios/${IDENTITY_ALVO}`
    );
  });

  it("sem destino honesto, mostra o identificador em vez de um link quebrado", async () => {
    vi.spyOn(api, "auditEvents").mockResolvedValue(
      pagina([evento({ event_type: "sso.authorization-code.issued", payload: { fields: {}, redactedFields: [] } })])
    );
    renderizar();

    const linha = (await screen.findByText("sso.authorization-code.issued")).closest("tr")!;
    expect(within(linha).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("detalhe do evento", () => {
  async function abrirDetalhe() {
    await userEvent.click((await screen.findAllByRole("button", { name: "Detalhe" }))[0]!);
    return screen.findByRole("dialog", { name: "Detalhe do evento" });
  }

  it("abre com os campos do evento", async () => {
    renderizar();
    const dialogo = await abrirDetalhe();

    expect(within(dialogo).getByText("identity.created", { exact: false })).toBeInTheDocument();
    expect(within(dialogo).getByText("PENDING")).toBeInTheDocument();
  });

  it("mostra os NOMES do que foi redigido, e nunca o valor", async () => {
    vi.spyOn(api, "auditEvents").mockResolvedValue(
      pagina([
        evento({
          payload: { fields: { deliveryMode: "MANUAL_DEV", token: "[REDIGIDO]" }, redactedFields: ["token"] }
        })
      ])
    );
    renderizar();
    const dialogo = await abrirDetalhe();

    expect(within(dialogo).getByText("[REDIGIDO]")).toBeInTheDocument();
    expect(within(dialogo).getByText(/Campos redigidos pela política de sigilo: token/)).toBeInTheDocument();
  });

  it("evento de convite não exibe token algum", async () => {
    vi.spyOn(api, "auditEvents").mockResolvedValue(
      pagina([
        evento({
          event_type: "identity-invitation.created",
          payload: {
            fields: { invitationPublicId: "1111aaaa-1111-4111-8111-111111111111", deliveryMode: "MANUAL_DEV" },
            redactedFields: []
          }
        })
      ])
    );
    renderizar();
    const dialogo = await abrirDetalhe();

    expect(within(dialogo).getByText("MANUAL_DEV")).toBeInTheDocument();
    expect(dialogo.textContent ?? "").not.toMatch(/token/i);
  });
});

describe("filtros", () => {
  it("período, evento, ator e entidade viram parâmetros da consulta", async () => {
    const consultar = vi.spyOn(api, "auditEvents").mockResolvedValue(pagina([evento()]));
    renderizar();
    await screen.findByText("identity.created");

    await userEvent.selectOptions(screen.getByLabelText("Filtrar por evento"), "organization.created");
    await userEvent.type(screen.getByLabelText("Filtrar por ator"), fixtures.ADMIN_PUBLIC_ID);
    await userEvent.type(screen.getByLabelText("Filtrar por entidade"), fixtures.ORG_PUBLIC_ID);

    await waitFor(() => {
      const ultima = consultar.mock.calls.at(-1)![0];
      expect(ultima.get("eventType")).toBe("organization.created");
      expect(ultima.get("actorPublicId")).toBe(fixtures.ADMIN_PUBLIC_ID);
      expect(ultima.get("aggregatePublicId")).toBe(fixtures.ORG_PUBLIC_ID);
    });
  });

  it("mudar de filtro volta para a primeira página", async () => {
    const consultar = vi.spyOn(api, "auditEvents").mockResolvedValue({
      items: [evento()], total: 200, limit: 25, offset: 25
    } as never);
    renderizar();
    await screen.findByText("identity.created");

    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(consultar.mock.calls.at(-1)![0].get("offset")).toBe("50"));

    // Filtrar sem voltar ao início mostraria a página 3 de um resultado
    // novo — quase sempre vazia, parecendo "não há nada".
    await userEvent.selectOptions(screen.getByLabelText("Filtrar por evento"), "organization.created");
    await waitFor(() => expect(consultar.mock.calls.at(-1)![0].get("offset")).toBe("0"));
  });
});
