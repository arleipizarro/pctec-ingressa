import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import {
  rotulo,
  rotuloDeAcesso,
  rotuloDeAplicacao,
  rotuloDeIdentidades,
  rotuloDePerfil
} from "../apresentacao.js";
import * as fixtures from "./fixtures.js";

function renderizar(rota: string) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>
  );
}

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN as never);
  vi.spyOn(api, "summary").mockResolvedValue(fixtures.RESUMO);
  vi.spyOn(api, "identities").mockResolvedValue(fixtures.PAGINA_IDENTIDADES);
  vi.spyOn(api, "organizations").mockResolvedValue(fixtures.PAGINA_ORGANIZACOES);
});

afterEach(() => {
  vi.restoreAllMocks();
  // A trava de rolagem escreve em `document.body`; um teste que falhe no
  // meio não pode deixar o estilo sujo para o próximo.
  document.body.style.overflow = "";
});

/**
 * Abre a gaveta e devolve o botão "Menu", que é para onde o foco tem de
 * voltar em todo caminho de fechamento.
 */
async function abrirGaveta(): Promise<HTMLElement> {
  renderizar("/admin");
  await screen.findByRole("heading", { name: "Painel" });
  const menu = screen.getByRole("button", { name: "Menu" });
  await userEvent.click(menu);
  expect(menu).toHaveAttribute("aria-expanded", "true");
  return menu;
}

describe("gaveta de navegação — fechamento", () => {
  it("o botão X fecha e devolve o foco ao botão Menu", async () => {
    const menu = await abrirGaveta();

    await userEvent.click(screen.getByRole("button", { name: "Fechar menu" }));

    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });

  it("clicar no fundo fecha e devolve o foco ao botão Menu", async () => {
    const menu = await abrirGaveta();

    // O fundo é `aria-hidden` de propósito — não é alvo de leitor de
    // tela, só de ponteiro —, então a busca é pela classe.
    const fundo = document.querySelector(".menu-fundo");
    expect(fundo).not.toBeNull();
    await userEvent.click(fundo as Element);

    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });

  it("Escape fecha e devolve o foco ao botão Menu", async () => {
    const menu = await abrirGaveta();

    await userEvent.keyboard("{Escape}");

    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });

  it("navegar por um item fecha a gaveta", async () => {
    const menu = await abrirGaveta();

    await userEvent.click(screen.getByRole("link", { name: "Usuários" }));

    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("o botão de fechar existe e é anunciado por aria-label", async () => {
    await abrirGaveta();

    const fechar = screen.getByRole("button", { name: "Fechar menu" });
    expect(fechar).toBeInTheDocument();
    expect(fechar).toHaveAttribute("aria-label", "Fechar menu");
  });
});

describe("gaveta de navegação — rolagem do fundo", () => {
  it("trava a rolagem do body enquanto aberta e restaura ao fechar", async () => {
    const menu = await abrirGaveta();
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.click(screen.getByRole("button", { name: "Fechar menu" }));
    expect(document.body.style.overflow).toBe("");
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("restaura o valor ANTERIOR de overflow, não um vazio fixo", async () => {
    // Se outra parte da aplicação já tiver travado a rolagem, fechar a
    // gaveta não pode destravá-la por conta própria.
    document.body.style.overflow = "clip";

    const menu = await abrirGaveta();
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("clip");
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });
});

describe("camada de apresentação", () => {
  it("traduz os valores técnicos exibidos ao usuário", () => {
    expect(rotulo("DRY_RUN")).toBe("SIMULAÇÃO");
    expect(rotulo("APPLY")).toBe("APLICAÇÃO");
    expect(rotulo("COMPLETED")).toBe("CONCLUÍDO");
    expect(rotulo("FAILED")).toBe("FALHOU");
    expect(rotulo("CONFLICT")).toBe("CONFLITO");
    expect(rotulo("QUARANTINE")).toBe("QUARENTENA");
    expect(rotulo("BUSINESS_GROUP")).toBe("GRUPO EMPRESARIAL");
    expect(rotulo("COMPANY")).toBe("EMPRESA");
  });

  it("compõe os rótulos do painel", () => {
    expect(rotuloDeIdentidades("ACTIVE")).toBe("Identidades ativas");
    expect(rotuloDeIdentidades("PENDING")).toBe("Identidades pendentes");
    expect(rotuloDeIdentidades("BLOCKED")).toBe("Identidades bloqueadas");
    expect(rotuloDeAplicacao("PCTEC_PORTAL")).toBe("PCTEC Portal");
    expect(rotuloDePerfil("USER")).toBe("Usuário");
    expect(rotuloDePerfil("ADMIN")).toBe("Administrador");
    expect(rotuloDeAcesso("PCTEC_PORTAL", "USER")).toBe("PCTEC Portal · Usuário");
    expect(rotuloDeAcesso("PCTEC_INGRESSA", "ADMIN")).toBe("PCTEC Ingressa · Administrador");
  });

  it("valor desconhecido continua visível, sem quebrar a tela", () => {
    // Um enum que o servidor passe a emitir amanhã aparece cru. Some ou
    // estoura seria pior: a tela mentiria sobre o que veio da API.
    expect(rotulo("ESTADO_QUE_NAO_EXISTE")).toBe("ESTADO_QUE_NAO_EXISTE");
    expect(rotulo("")).toBe("");
    expect(rotuloDeIdentidades("ARQUIVADA")).toBe("Identidades ARQUIVADA");
    expect(rotuloDePerfil("AUDITOR")).toBe("AUDITOR");
    // Aplicação fora do catálogo vira legível sem precisar de cadastro.
    expect(rotuloDeAplicacao("SISTEMA_NOVO")).toBe("SISTEMA NOVO");
  });

  it("o painel exibe os rótulos traduzidos, não os enums", async () => {
    renderizar("/admin");
    // O <h2>Painel</h2> fica fora do bloco de carregamento e aparece
    // antes dos dados: esperar por ele mediria a tela vazia.
    expect(await screen.findByText("Identidades ativas")).toBeInTheDocument();
    expect(screen.getByText("Identidades pendentes")).toBeInTheDocument();
    expect(screen.getByText("Vínculos ativos")).toBeInTheDocument();
    expect(screen.getByText("GRUPO EMPRESARIAL")).toBeInTheDocument();
    expect(screen.getByText("EMPRESA")).toBeInTheDocument();
    expect(screen.getByText("SIMULAÇÃO")).toBeInTheDocument();
    expect(screen.getByText("CONCLUÍDO")).toBeInTheDocument();

    // Nenhum dos termos técnicos correspondentes sobra na tela.
    for (const tecnico of ["Identidades ACTIVE", "Memberships ativos", "BUSINESS_GROUP", "COMPANY", "DRY_RUN", "COMPLETED"]) {
      expect(screen.queryByText(tecnico)).not.toBeInTheDocument();
    }
  });

  it("o selo classifica pelo valor do servidor, não pelo texto traduzido", async () => {
    renderizar("/admin");
    await screen.findByText("Identidades ativas");

    // COMPLETED é desfecho bom: continua no selo verde mesmo exibindo
    // "CONCLUÍDO". A cor vem do enum, não da tradução.
    expect(screen.getByText("CONCLUÍDO")).toHaveClass("badge", "badge-ok");
    expect(screen.getByText("SIMULAÇÃO")).toHaveClass("badge", "badge-alerta");
  });
});

describe("camada de apresentação — cobertura fora do painel", () => {
  it("ACTIVE aparece como ATIVO no selo, e o valor do servidor escolhe a cor", () => {
    expect(rotulo("ACTIVE")).toBe("ATIVO");
    expect(rotulo("INACTIVE")).toBe("INATIVO");
    expect(rotulo("PENDING")).toBe("PENDENTE");
    expect(rotulo("BLOCKED")).toBe("BLOQUEADO");
    expect(rotulo("EXPIRED")).toBe("EXPIRADO");
    expect(rotulo("GRANTED")).toBe("CONCEDIDO");
    expect(rotulo("REVOKED")).toBe("REVOGADO");
    expect(rotulo("CREATE")).toBe("CRIAÇÃO");
    expect(rotulo("SKIP")).toBe("IGNORADO");
  });

  it("a listagem de Organizações traduz o tipo na coluna", async () => {
    renderizar("/admin/organizacoes");

    expect(await screen.findByText("EMPRESA")).toBeInTheDocument();
    expect(screen.queryByText("COMPANY")).not.toBeInTheDocument();
    expect(screen.queryByText("BUSINESS_GROUP")).not.toBeInTheDocument();
  });

  /**
   * O ponto mais delicado da rodada: o filtro precisa MOSTRAR português
   * e ENVIAR o enum. Se o `value` escorregasse junto com o texto, o
   * parâmetro `type` iria para a API como "EMPRESA" e a busca voltaria
   * vazia — falha silenciosa, sem erro na tela.
   */
  it("o filtro de tipo traduz o texto da option e PRESERVA o value técnico", async () => {
    renderizar("/admin/organizacoes");
    await screen.findByText("EMPRESA");

    const filtro = screen.getByLabelText("Filtrar por tipo") as HTMLSelectElement;
    const porTexto = new Map(
      [...filtro.options].map((o) => [o.textContent, o.value])
    );

    expect(porTexto.get("EMPRESA")).toBe("COMPANY");
    expect(porTexto.get("GRUPO EMPRESARIAL")).toBe("BUSINESS_GROUP");
    // Nenhuma option exibe o enum cru.
    expect([...filtro.options].map((o) => o.textContent)).not.toContain("COMPANY");
  });

  it("selecionar no filtro traduzido envia o enum para a API", async () => {
    renderizar("/admin/organizacoes");
    await screen.findByText("EMPRESA");

    await userEvent.selectOptions(screen.getByLabelText("Filtrar por tipo"), "COMPANY");

    await waitFor(() => {
      const chamada = (api.organizations as unknown as { mock: { calls: URLSearchParams[][] } }).mock.calls.at(-1)?.[0];
      expect(chamada?.get("type")).toBe("COMPANY");
    });
  });
});

describe("painel — grade de KPIs", () => {
  it("mantém todos os cartões de contagem", async () => {
    renderizar("/admin");
    await screen.findByText("Identidades ativas");

    // Dois status de identidade + vínculos + um acesso concedido.
    const grade = document.querySelector(".cards");
    expect(grade).not.toBeNull();
    expect((grade as Element).querySelectorAll(".card")).toHaveLength(4);

    // Cada KPI segue rotulado. O valor não serve de âncora aqui: a
    // fixture tem duas contagens iguais a 3, e casar por número acharia
    // as duas.
    for (const kpi of ["Identidades ativas", "Identidades pendentes", "Vínculos ativos", "APP SINTETICA · Usuário"]) {
      expect(screen.getByText(kpi)).toBeInTheDocument();
    }
  });
});

describe("login", () => {
  it("não repete o nome do produto: a marca é a imagem, sem título duplicado", async () => {
    // ApiError DE VERDADE: `useSessao` distingue `ApiError` (cai no
    // login) de falha inesperada (deixa estourar). Um Error genérico
    // viraria rejeição não tratada e provaria o contrário do que se quer.
    vi.spyOn(api, "apps").mockRejectedValue(new ApiError(401, "X", "sem sessão"));
    renderizar("/login");

    const marca = await screen.findByAltText("PCTEC Ingressa");
    expect(marca.tagName).toBe("IMG");
    expect(screen.getByText("Acesso às aplicações PCTEC")).toBeInTheDocument();

    // O <h1> que repetia "PCTEC Ingressa" abaixo do logotipo saiu.
    expect(screen.queryByRole("heading", { name: "PCTEC Ingressa" })).not.toBeInTheDocument();
  });

  it("o formulário continua completo", async () => {
    // ApiError DE VERDADE: `useSessao` distingue `ApiError` (cai no
    // login) de falha inesperada (deixa estourar). Um Error genérico
    // viraria rejeição não tratada e provaria o contrário do que se quer.
    vi.spyOn(api, "apps").mockRejectedValue(new ApiError(401, "X", "sem sessão"));
    renderizar("/login");

    await waitFor(() => expect(screen.getByLabelText("E-mail")).toBeInTheDocument());
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });
});
