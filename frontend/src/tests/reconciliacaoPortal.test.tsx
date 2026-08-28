import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Reconciliação das organizações que já existem.
 *
 * As invariantes que estes testes protegem:
 *
 * - a tela abre num **dry-run**, que não escreve nada;
 * - só `EXACT_UNIQUE` é selecionável — os demais estados sequer têm
 *   caixa de seleção, porque oferecer o clique e recusar depois é pior
 *   que não oferecer;
 * - a execução exige a palavra literal E uma seleção;
 * - documento nenhum aparece inteiro: só a máscara do cliente do
 *   Portal, e a presença (não o valor) do CNPJ da empresa;
 * - fonte indisponível é dita como tal.
 */

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

const ORG_UNICA = "aaaaaaaa-1111-4111-8111-111111111111";
const ORG_AMBIGUA = "cccccccc-3333-4333-8333-333333333333";
const ORG_SEM_DOC = "dddddddd-4444-4444-8444-444444444444";
const ORG_VINCULADA = "eeeeeeee-5555-4555-8555-555555555555";

const ITENS = [
  {
    organizationPublicId: ORG_UNICA,
    legalName: "UNICA LTDA",
    tradeName: "Única",
    status: "EXACT_UNIQUE",
    hasDocument: true,
    candidateCount: 1,
    suggestedLegacyId: 71,
    suggestedClientName: "CLIENTE SINTETICO",
    suggestedClientDocumentMasked: "**.***.333/0001-81"
  },
  {
    organizationPublicId: ORG_AMBIGUA,
    legalName: "AMBIGUA LTDA",
    tradeName: null,
    status: "AMBIGUOUS",
    hasDocument: true,
    candidateCount: 2,
    suggestedLegacyId: null,
    suggestedClientName: null,
    suggestedClientDocumentMasked: null
  },
  {
    organizationPublicId: ORG_SEM_DOC,
    legalName: "SEM DOCUMENTO LTDA",
    tradeName: null,
    status: "DOCUMENT_MISSING_OR_INVALID",
    hasDocument: false,
    candidateCount: 0,
    suggestedLegacyId: null,
    suggestedClientName: null,
    suggestedClientDocumentMasked: null
  },
  {
    organizationPublicId: ORG_VINCULADA,
    legalName: "JA VINCULADA LTDA",
    tradeName: null,
    status: "ALREADY_LINKED",
    hasDocument: true,
    candidateCount: 1,
    suggestedLegacyId: null,
    suggestedClientName: null,
    suggestedClientDocumentMasked: null
  }
];

function dryRun(overrides: Record<string, unknown> = {}) {
  return {
    items: ITENS,
    counts: {
      EXACT_UNIQUE: 1,
      NOT_FOUND: 0,
      AMBIGUOUS: 1,
      DOCUMENT_MISSING_OR_INVALID: 1,
      ALREADY_LINKED: 1
    },
    total: 4,
    limit: 50,
    offset: 0,
    eligibleCount: 1,
    ...overrides
  } as never;
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={["/admin/organizacoes/reconciliacao-portal"]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN as never);
  vi.spyOn(api, "portalReconciliationDryRun").mockResolvedValue(dryRun());
});

afterEach(() => vi.restoreAllMocks());

describe("reconciliação — dry-run", () => {
  it("abre no dry-run e NÃO executa nada", async () => {
    const executar = vi.spyOn(api, "portalReconciliationExecute");
    renderizar();

    expect(await screen.findByText("UNICA LTDA")).toBeInTheDocument();
    expect(api.portalReconciliationDryRun).toHaveBeenCalled();
    expect(executar).not.toHaveBeenCalled();
  });

  it("mostra as contagens por estado", async () => {
    renderizar();

    expect(await screen.findByTestId("contagem-EXACT_UNIQUE")).toHaveTextContent("1");
    expect(screen.getByTestId("contagem-AMBIGUOUS")).toHaveTextContent("1");
    expect(screen.getByTestId("contagem-ALREADY_LINKED")).toHaveTextContent("1");
  });

  it("só EXACT_UNIQUE é selecionável", async () => {
    renderizar();
    await screen.findByText("UNICA LTDA");

    expect(screen.getByLabelText("Selecionar UNICA LTDA")).toBeInTheDocument();
    expect(screen.queryByLabelText("Selecionar AMBIGUA LTDA")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selecionar SEM DOCUMENTO LTDA")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selecionar JA VINCULADA LTDA")).not.toBeInTheDocument();
  });

  it("mostra a sugestão com CNPJ mascarado e nenhum documento inteiro", async () => {
    renderizar();
    await screen.findByText("UNICA LTDA");

    expect(screen.getByText("**.***.333/0001-81")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/\b\d{14}\b/);
  });

  it("empresa sem CNPJ é marcada pela ausência, nunca pelo valor", async () => {
    renderizar();
    await screen.findByText("SEM DOCUMENTO LTDA");
    expect(screen.getByText("sem CNPJ")).toBeInTheDocument();
  });

  it("fonte indisponível é dita como tal", async () => {
    vi.spyOn(api, "portalReconciliationDryRun").mockRejectedValue(
      new ApiError(503, "PORTAL_CATALOG_SOURCE_NOT_CONFIGURED", "indisponível")
    );
    renderizar();

    expect(await screen.findByTestId("reconciliacao-indisponivel")).toHaveTextContent(
      /configuração da fonte não está presente/i
    );
  });
});

describe("reconciliação — execução", () => {
  it("exige seleção E confirmação literal antes de habilitar", async () => {
    renderizar();
    await screen.findByText("UNICA LTDA");

    const botao = screen.getByRole("button", { name: /Vincular 0 empresa/i });
    expect(botao).toBeDisabled();

    await userEvent.click(screen.getByLabelText("Selecionar UNICA LTDA"));
    expect(screen.getByRole("button", { name: /Vincular 1 empresa/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Digite/), "RECONCILIAR");
    expect(screen.getByRole("button", { name: /Vincular 1 empresa/i })).toBeEnabled();
  });

  it("palavra errada não habilita a execução", async () => {
    const executar = vi.spyOn(api, "portalReconciliationExecute");
    renderizar();
    await screen.findByText("UNICA LTDA");

    await userEvent.click(screen.getByLabelText("Selecionar UNICA LTDA"));
    await userEvent.type(screen.getByLabelText(/Digite/), "sim");

    expect(screen.getByRole("button", { name: /Vincular 1 empresa/i })).toBeDisabled();
    expect(executar).not.toHaveBeenCalled();
  });

  it("executa somente as selecionadas e mostra o resultado por organização", async () => {
    const executar = vi.spyOn(api, "portalReconciliationExecute").mockResolvedValue({
      items: [
        {
          organizationPublicId: ORG_UNICA,
          legalName: "UNICA LTDA",
          status: "LINKED",
          legacyId: 71,
          referencePublicId: "99999999-9999-4999-8999-999999999999",
          reasonCode: null
        }
      ],
      linked: 1,
      alreadyLinked: 0,
      skipped: 0,
      failed: 0
    });
    renderizar();
    await screen.findByText("UNICA LTDA");

    await userEvent.click(screen.getByLabelText("Selecionar UNICA LTDA"));
    await userEvent.type(screen.getByLabelText(/Digite/), "RECONCILIAR");
    await userEvent.click(screen.getByRole("button", { name: /Vincular 1 empresa/i }));

    await waitFor(() => expect(executar).toHaveBeenCalledWith([ORG_UNICA], "RECONCILIAR"));
    const resultado = await screen.findByTestId("resultado-da-execucao");
    expect(within(resultado).getByText("LINKED")).toBeInTheDocument();
    expect(within(resultado).getByText("71")).toBeInTheDocument();
  });

  it("recarrega o dry-run depois de executar — a lista deixa de convidar a repetir", async () => {
    vi.spyOn(api, "portalReconciliationExecute").mockResolvedValue({
      items: [], linked: 0, alreadyLinked: 0, skipped: 0, failed: 0
    });
    renderizar();
    await screen.findByText("UNICA LTDA");

    await userEvent.click(screen.getByLabelText("Selecionar UNICA LTDA"));
    await userEvent.type(screen.getByLabelText(/Digite/), "RECONCILIAR");
    await userEvent.click(screen.getByRole("button", { name: /Vincular 1 empresa/i }));

    await waitFor(() =>
      expect(vi.mocked(api.portalReconciliationDryRun).mock.calls.length).toBeGreaterThan(1)
    );
  });

  it("falha na execução vira frase, e a lista continua na tela", async () => {
    vi.spyOn(api, "portalReconciliationExecute").mockRejectedValue(
      new ApiError(422, "PORTAL_RECONCILIATION_SELECTION_INVALID", "Dados inválidos. Revise os campos.")
    );
    renderizar();
    await screen.findByText("UNICA LTDA");

    await userEvent.click(screen.getByLabelText("Selecionar UNICA LTDA"));
    await userEvent.type(screen.getByLabelText(/Digite/), "RECONCILIAR");
    await userEvent.click(screen.getByRole("button", { name: /Vincular 1 empresa/i }));

    expect(await screen.findByText("Dados inválidos. Revise os campos.")).toBeInTheDocument();
    expect(screen.getByText("UNICA LTDA")).toBeInTheDocument();
  });

  it("nada a executar quando a página não tem EXACT_UNIQUE", async () => {
    vi.spyOn(api, "portalReconciliationDryRun").mockResolvedValue(
      dryRun({
        items: ITENS.filter((i) => i.status !== "EXACT_UNIQUE"),
        counts: {
          EXACT_UNIQUE: 0,
          NOT_FOUND: 0,
          AMBIGUOUS: 1,
          DOCUMENT_MISSING_OR_INVALID: 1,
          ALREADY_LINKED: 1
        },
        eligibleCount: 0
      })
    );
    renderizar();

    expect(await screen.findByText("Nada a executar nesta página.")).toBeInTheDocument();
  });
});
