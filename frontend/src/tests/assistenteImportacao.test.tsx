import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Testes do assistente de importação (v0.10.x).
 *
 * A tela é montada dentro do `App` real, com a sessão de ADMIN mockada
 * na API — assim as rotas, o layout e a navegação entre etapas são
 * exercitados de verdade, não simulados.
 *
 * TODAS as fixtures são sintéticas (`@example.invalid`, ids `9999xx`).
 * `semPiiNasFixtures.test.ts` reprova o contrário.
 */
/** A sessão da UI vem de `/api/v1/apps` (ver `auth.ts`), não de `whoami`. */
const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

function renderizar(rota = "/admin/importacoes/nova") {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN);
  vi.spyOn(api, "importBatches").mockResolvedValue(fixtures.PAGINA_LOTES);
  vi.spyOn(api, "organizations").mockResolvedValue(fixtures.PAGINA_ORGANIZACOES_COM_GRUPO);
  vi.spyOn(api, "helpdeskCompanies").mockResolvedValue(fixtures.PAGINA_EMPRESAS);
  vi.spyOn(api, "helpdeskCompanyUsers").mockResolvedValue(fixtures.USUARIOS_DE_ORIGEM);
  vi.spyOn(api, "helpdeskPreview").mockResolvedValue(fixtures.PREVIA);
  vi.spyOn(api, "helpdeskDryRun").mockResolvedValue(fixtures.LOTE_DRY_RUN);
  vi.spyOn(api, "helpdeskApply").mockResolvedValue(fixtures.LOTE_APLICADO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Percorre da etapa 1 até a etapa indicada. */
async function avancarAte(destino: "SELECAO" | "MAPEAMENTO" | "PREVIA" | "REVISAO"): Promise<void> {
  await userEvent.click((await screen.findAllByRole("button", { name: "Selecionar" }))[0]!);
  if (destino === "SELECAO") {
    return;
  }
  await screen.findByRole("heading", { name: "Organização e usuários encontrados" });
  await userEvent.click(screen.getByRole("button", { name: /Continuar com 2 usuário/ }));
  if (destino === "MAPEAMENTO") {
    return;
  }
  await screen.findByRole("heading", { name: "Mapeamento empresarial proposto" });
  await userEvent.click(screen.getByRole("button", { name: "Ver mapeamento proposto" }));
  await screen.findByRole("heading", { name: "Organização" });
  if (destino === "PREVIA") {
    return;
  }
  await userEvent.click(screen.getByRole("button", { name: "Executar DRY_RUN" }));
  await screen.findByRole("heading", { name: "Resumo do dry-run" });
}

describe("entrada do assistente", () => {
  it("a tela de Importações oferece o botão de nova importação", async () => {
    renderizar("/admin/importacoes");

    const link = await screen.findByRole("link", { name: "Nova importação do Helpdesk" });
    expect(link).toHaveAttribute("href", "/admin/importacoes/nova");
  });

  it("o link leva ao assistente, na primeira etapa", async () => {
    renderizar("/admin/importacoes");

    await userEvent.click(await screen.findByRole("link", { name: "Nova importação do Helpdesk" }));

    expect(await screen.findByRole("heading", { name: "Nova importação do Helpdesk" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Selecione a empresa de origem" })).toBeInTheDocument();
  });

  it("mostra as cinco etapas, com a atual marcada", async () => {
    renderizar();

    const passos = await screen.findByRole("list", { name: "Etapas do assistente" });
    expect(within(passos).getAllByRole("listitem")).toHaveLength(5);
    expect(within(passos).getByText("1. Origem")).toHaveAttribute("aria-current", "step");
  });
});

describe("etapa 1 — origem", () => {
  it("lista as empresas do Helpdesk e mostra quais já foram importadas", async () => {
    renderizar();

    expect(await screen.findByText(fixtures.EMPRESA_DE_ORIGEM.name)).toBeInTheDocument();
    expect(screen.getByText("Ainda não importada")).toBeInTheDocument();
    expect(screen.getByText(fixtures.EMPRESA_JA_IMPORTADA.linkedOrganization!.legalName)).toBeInTheDocument();
  });

  it("mostra o estado de carregamento antes dos dados", () => {
    vi.spyOn(api, "helpdeskCompanies").mockImplementation(() => new Promise(() => {}));
    renderizar();

    expect(screen.getAllByRole("status").some((e) => e.textContent?.includes("Carregando"))).toBe(true);
  });

  it("erro do catálogo aparece como alerta, sem detalhe interno", async () => {
    vi.spyOn(api, "helpdeskCompanies").mockRejectedValue(new ApiError(403, "X", "Você não tem permissão para esta operação."));
    renderizar();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/permissão/i);
    expect(alerta.textContent ?? "").not.toMatch(/stack|SQL|Error:/i);
  });

  it("a busca é repassada ao backend, nunca filtrada no navegador", async () => {
    renderizar();
    await screen.findByText(fixtures.EMPRESA_DE_ORIGEM.name);

    await userEvent.type(screen.getByLabelText("Buscar empresa"), "sintetica");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => {
      const ultima = vi.mocked(api.helpdeskCompanies).mock.calls.at(-1)?.[0];
      expect(ultima?.get("q")).toBe("sintetica");
    });
  });

  it("cancelar volta para a lista de importações sem chamar nada", async () => {
    renderizar();
    await screen.findByText(fixtures.EMPRESA_DE_ORIGEM.name);

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByRole("heading", { name: "Importações" })).toBeInTheDocument();
    expect(api.helpdeskDryRun).not.toHaveBeenCalled();
  });
});

describe("etapa 2 — seleção de usuários", () => {
  it("mostra os usuários encontrados e sugere os elegíveis já marcados", async () => {
    renderizar();
    await avancarAte("SELECAO");

    expect(await screen.findByRole("heading", { name: "Organização e usuários encontrados" })).toBeInTheDocument();
    expect(screen.getByLabelText(`Importar ${fixtures.USUARIO_ELEGIVEL.name}`)).toBeChecked();
    expect(screen.getByLabelText(`Importar ${fixtures.USUARIO_ELEGIVEL_DOIS.name}`)).toBeChecked();
  });

  it("o usuário INTERNO aparece, desmarcado e desabilitado, com o motivo à vista", async () => {
    renderizar();
    await avancarAte("SELECAO");

    const interno = await screen.findByLabelText(`Importar ${fixtures.USUARIO_INTERNO.name}`);
    expect(interno).not.toBeChecked();
    expect(interno).toBeDisabled();
    expect(screen.getByText("Usuário interno — não recebe vínculo com cliente.")).toBeInTheDocument();
  });

  it("desmarcar um usuário muda a contagem do botão de avançar", async () => {
    renderizar();
    await avancarAte("SELECAO");

    await userEvent.click(await screen.findByLabelText(`Importar ${fixtures.USUARIO_ELEGIVEL_DOIS.name}`));

    expect(screen.getByRole("button", { name: /Continuar com 1 usuário/ })).toBeEnabled();
  });

  it("sem nenhum usuário marcado, não é possível avançar", async () => {
    renderizar();
    await avancarAte("SELECAO");

    await userEvent.click(await screen.findByLabelText(`Importar ${fixtures.USUARIO_ELEGIVEL.name}`));
    await userEvent.click(screen.getByLabelText(`Importar ${fixtures.USUARIO_ELEGIVEL_DOIS.name}`));

    expect(screen.getByRole("button", { name: /Continuar com 0 usuário/ })).toBeDisabled();
  });

  it("voltar para a origem preserva a navegação", async () => {
    renderizar();
    await avancarAte("SELECAO");
    await screen.findByRole("heading", { name: "Organização e usuários encontrados" });

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(await screen.findByRole("heading", { name: "Selecione a empresa de origem" })).toBeInTheDocument();
  });
});

describe("etapa 3 — mapeamento proposto", () => {
  it("mostra a resolução da organização e os itens propostos", async () => {
    renderizar();
    await avancarAte("PREVIA");

    expect(screen.getByText("Cria uma organização nova para esta empresa.")).toBeInTheDocument();
    expect(screen.getAllByText("ORGANIZATION").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ORGANIZATION_EXTERNAL_REFERENCE").length).toBeGreaterThan(0);
  });

  it("a seleção enviada ao backend é só empresa e usuários — nenhuma decisão", async () => {
    renderizar();
    await avancarAte("PREVIA");

    const enviado = vi.mocked(api.helpdeskPreview).mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual([
      "parentBusinessGroupPublicId",
      "selectedSourceUserIds",
      "sourceClientId",
      "targetOrganizationPublicId"
    ]);
    expect(enviado["selectedSourceUserIds"]).toEqual([999911, 999912]);
    expect(JSON.stringify(enviado)).not.toMatch(/CREATE|ORGANIZATION_ONLY|CUSTOMER|USER/);
  });

  it("o grupo empresarial é escolhido entre organizações do INGRESSA, não da origem", async () => {
    renderizar();
    await avancarAte("MAPEAMENTO");

    const seletor = await screen.findByLabelText("Grupo empresarial");
    await waitFor(() => expect(within(seletor).getByText(fixtures.GRUPO.legal_name)).toBeInTheDocument());

    await userEvent.selectOptions(seletor, fixtures.GRUPO.public_id);
    await userEvent.click(screen.getByRole("button", { name: "Ver mapeamento proposto" }));

    await waitFor(() => {
      const enviado = vi.mocked(api.helpdeskPreview).mock.calls.at(-1)?.[0];
      expect(enviado?.parentBusinessGroupPublicId).toBe(fixtures.GRUPO.public_id);
    });
  });

  it("empresa já vinculada trava a troca de organização de destino", async () => {
    vi.spyOn(api, "helpdeskCompanies").mockResolvedValue({
      ...fixtures.PAGINA_EMPRESAS,
      items: [fixtures.EMPRESA_JA_IMPORTADA]
    });
    renderizar();
    await avancarAte("MAPEAMENTO");

    expect(await screen.findByLabelText("Organização de destino")).toBeDisabled();
    expect(screen.getByText(/decisão de quem concedeu/)).toBeInTheDocument();
  });

  it("mudar a seleção depois da prévia apaga o que deixou de valer", async () => {
    renderizar();
    await avancarAte("PREVIA");
    expect(screen.getByRole("button", { name: "Executar DRY_RUN" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await userEvent.click(await screen.findByLabelText(`Importar ${fixtures.USUARIO_ELEGIVEL_DOIS.name}`));
    await userEvent.click(screen.getByRole("button", { name: /Continuar com 1 usuário/ }));

    // Sem prévia recalculada, o dry-run fica indisponível: a tela nunca
    // executa sobre um plano que já não corresponde à seleção.
    expect(await screen.findByRole("button", { name: "Executar DRY_RUN" })).toBeDisabled();
  });

  it("erro no dry-run vira alerta e a etapa não avança", async () => {
    vi.spyOn(api, "helpdeskDryRun").mockRejectedValue(new ApiError(409, "X", "O registro mudou desde que a tela carregou. Recarregue e tente de novo."));
    renderizar();
    await avancarAte("PREVIA");

    await userEvent.click(screen.getByRole("button", { name: "Executar DRY_RUN" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/mudou desde que a tela carregou/);
    expect(screen.queryByRole("heading", { name: "Resumo do dry-run" })).not.toBeInTheDocument();
  });
});

describe("etapa 4 — revisão do dry-run", () => {
  it("mostra o resumo CREATE/SKIP/CONFLICT/QUARANTINE", async () => {
    renderizar();
    await avancarAte("REVISAO");

    // Os rótulos EXIBIDOS. O enum continua no payload — o teste de
    // "não vaza CREATE no corpo" acima é quem cuida disso.
    for (const acao of ["CRIAÇÃO", "IGNORADO", "CONFLITO", "QUARENTENA"]) {
      expect(screen.getAllByText(acao).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText(fixtures.LOTE_DRY_RUN_PUBLIC_ID)).toBeInTheDocument();
  });

  it("abre os detalhes de um usuário com o snapshot que iria para a trilha", async () => {
    renderizar();
    await avancarAte("REVISAO");

    const detalhes = screen.getAllByText(new RegExp(fixtures.USUARIO_ELEGIVEL.name))[0]!;
    await userEvent.click(detalhes);

    expect(screen.getAllByText(/full_name:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Será criado a partir da origem.").length).toBeGreaterThan(0);
  });

  it("conflitos e quarentenas aparecem com o motivo em português", async () => {
    vi.spyOn(api, "helpdeskPreview").mockResolvedValue(fixtures.PREVIA_COM_PROBLEMAS);
    vi.spyOn(api, "helpdeskDryRun").mockResolvedValue(fixtures.LOTE_DRY_RUN_COM_PROBLEMAS);
    renderizar();
    await avancarAte("REVISAO");

    await userEvent.click(screen.getAllByText(new RegExp(fixtures.USUARIO_ELEGIVEL.name))[0]!);

    expect(
      screen.getAllByText("O e-mail já pertence a outra identidade — associar exige confirmação humana.").length
    ).toBeGreaterThan(0);
  });

  it("organização bloqueada mostra alerta e impede a aprovação", async () => {
    vi.spyOn(api, "helpdeskPreview").mockResolvedValue(fixtures.PREVIA_ORGANIZACAO_BLOQUEADA);
    vi.spyOn(api, "helpdeskDryRun").mockResolvedValue(fixtures.LOTE_DRY_RUN_BLOQUEADO);
    renderizar();
    await avancarAte("REVISAO");

    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/contradiz o vínculo já existente/);
    expect(screen.getByRole("checkbox", { name: /aprovo este lote/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Executar APPLY" })).toBeDisabled();
  });

  it("lote sem nada a escrever não pode ser aplicado", async () => {
    vi.spyOn(api, "helpdeskPreview").mockResolvedValue(fixtures.PREVIA_SEM_ESCRITA);
    vi.spyOn(api, "helpdeskDryRun").mockResolvedValue(fixtures.LOTE_DRY_RUN_SEM_ESCRITA);
    renderizar();
    await avancarAte("REVISAO");

    expect(screen.getByText(/Nada a escrever/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executar APPLY" })).toBeDisabled();
  });

  it("sem aprovar o lote, o APPLY continua indisponível", async () => {
    renderizar();
    await avancarAte("REVISAO");

    expect(screen.getByRole("button", { name: "Executar APPLY" })).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: /aprovo este lote/ }));

    expect(screen.getByRole("button", { name: "Executar APPLY" })).toBeEnabled();
  });
});

describe("confirmação forte do APPLY", () => {
  async function abrirConfirmacao(): Promise<void> {
    await avancarAte("REVISAO");
    await userEvent.click(screen.getByRole("checkbox", { name: /aprovo este lote/ }));
    await userEvent.click(screen.getByRole("button", { name: "Executar APPLY" }));
    await screen.findByRole("dialog", { name: "Aplicar a importação" });
  }

  it("pede a palavra APLICAR, e o texto descreve a consequência", async () => {
    renderizar();
    await abrirConfirmacao();

    expect(screen.getByText(/Digite APLICAR para confirmar/)).toBeInTheDocument();
    expect(screen.getByText(/identidades, vínculos e acessos ao Helpdesk/)).toBeInTheDocument();
  });

  it("envia a palavra digitada ao backend — a validação é do servidor", async () => {
    renderizar();
    await abrirConfirmacao();

    await userEvent.type(screen.getByLabelText("Confirmação"), "APLICAR");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(api.helpdeskApply).toHaveBeenCalledWith(
        expect.objectContaining({ sourceClientId: fixtures.CLIENTE_DE_ORIGEM }),
        fixtures.LOTE_DRY_RUN_PUBLIC_ID,
        "APLICAR"
      )
    );
  });

  it("palavra errada é ENVIADA e recusada pelo servidor — a tela não decide", async () => {
    vi.spyOn(api, "helpdeskApply").mockRejectedValue(new ApiError(422, "IMPORT_WIZARD_APPLY_CONFIRMATION_MISMATCH", "Dados inválidos. Revise os campos."));
    renderizar();
    await abrirConfirmacao();

    await userEvent.type(screen.getByLabelText("Confirmação"), "aplicar");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(api.helpdeskApply).toHaveBeenCalledWith(expect.anything(), expect.anything(), "aplicar"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Dados inválidos/);
    expect(screen.queryByText(/Importação aplicada/)).not.toBeInTheDocument();
  });

  it("cancelar a confirmação não aplica nada", async () => {
    renderizar();
    await abrirConfirmacao();

    // Escopo no diálogo de propósito: a etapa de revisão atrás dele tem
    // o seu próprio "Cancelar", e um seletor global pegaria o errado.
    const dialogo = screen.getByRole("dialog", { name: "Aplicar a importação" });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.helpdeskApply).not.toHaveBeenCalled();
    // A revisão continua na tela, com a aprovação preservada.
    expect(screen.getByRole("heading", { name: "Resumo do dry-run" })).toBeInTheDocument();
  });
});

describe("etapa 5 — resultado", () => {
  async function aplicar(): Promise<void> {
    await avancarAte("REVISAO");
    await userEvent.click(screen.getByRole("checkbox", { name: /aprovo este lote/ }));
    await userEvent.click(screen.getByRole("button", { name: "Executar APPLY" }));
    await screen.findByRole("dialog", { name: "Aplicar a importação" });
    await userEvent.type(screen.getByLabelText("Confirmação"), "APLICAR");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText(/Importação aplicada/);
  }

  it("mostra o lote aplicado e os identificadores públicos criados", async () => {
    renderizar();
    await aplicar();

    expect(screen.getByText(fixtures.LOTE_APPLY_PUBLIC_ID)).toBeInTheDocument();
    expect(screen.getByText(fixtures.NOVA_ORG_PUBLIC_ID)).toBeInTheDocument();
    expect(screen.getAllByText(fixtures.NOVA_IDENTIDADE_PUBLIC_ID).length).toBe(2);
    expect(screen.getAllByText(fixtures.NOVO_ACESSO_PUBLIC_ID).length).toBe(2);
  });

  it("informa que as identidades foram ativadas agora", async () => {
    renderizar();
    await aplicar();

    expect(screen.getAllByText("ativada agora")).toHaveLength(2);
    expect(screen.getAllByText("ATIVO").length).toBeGreaterThan(0);
  });

  it("oferece o caminho para a trilha completa do lote", async () => {
    renderizar();
    await aplicar();

    expect(screen.getByRole("link", { name: "Ver a trilha completa do lote" })).toHaveAttribute(
      "href",
      `/admin/importacoes/${fixtures.LOTE_APPLY_PUBLIC_ID}`
    );
  });

  it("concluir volta para o relatório de importações, que recarrega a lista", async () => {
    renderizar();
    await aplicar();

    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));

    expect(await screen.findByRole("heading", { name: "Importações" })).toBeInTheDocument();
    // O relatório é BUSCADO no servidor ao voltar — a tela nunca costura
    // o lote recém-criado na lista a partir do que tem em memória.
    await waitFor(() => expect(api.importBatches).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Nova importação do Helpdesk" })).toBeInTheDocument();
  });
});

describe("o assistente nunca guarda nada no navegador", () => {
  it("não usa localStorage em nenhuma etapa", async () => {
    renderizar();
    await avancarAte("REVISAO");

    expect(localStorage.length).toBe(0);
  });
});
