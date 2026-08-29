import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, type AplicativoCard, type OrganizacaoDoUsuario } from "../api.js";
import type { Sessao } from "../auth.js";
import { CODIGO_INGRESSA, encerrarSessao } from "../auth.js";
import { rotuloDePerfil } from "../apresentacao.js";

const CODIGO_PORTAL = "PCTEC_PORTAL";
const CODIGO_HELPDESK = "PCTEC_HELPDESK";

type Icone = "portal" | "helpdesk" | "ingressa" | "generico";

/**
 * Nome, descrição e ícone por produto conhecido.
 *
 * Puramente de apresentação: NÃO decide quais cards aparecem, nem se são
 * clicáveis, nem qual é o destino. Um código desconhecido cai no texto
 * genérico e continua aparecendo — se o servidor autorizou, a tela
 * mostra. O `code` do servidor segue sendo a chave; o que muda aqui é
 * apenas como ele é lido por gente.
 */
const CATALOGO: Readonly<Record<string, { nome: string; descricao: string; icone: Icone }>> = {
  [CODIGO_PORTAL]: {
    nome: "Portal do Cliente",
    descricao: "Acompanhe contratos, equipamentos, informações financeiras e chamados.",
    icone: "portal"
  },
  [CODIGO_HELPDESK]: {
    nome: "PCTEC Helpdesk",
    descricao: "Registre e acompanhe solicitações, dúvidas e incidentes.",
    icone: "helpdesk"
  },
  [CODIGO_INGRESSA]: {
    nome: "PCTEC Ingressa",
    descricao: "Gerencie sua identidade e os acessos às aplicações PCTEC.",
    icone: "ingressa"
  }
};

/**
 * Produto fora do catálogo continua visível e legível.
 *
 * O nome cai para o `name` que o servidor mandou — nunca para o código
 * técnico. Uma aplicação nova entra no launcher sem precisar de deploy
 * do frontend.
 */
function apresentacao(card: AplicativoCard): { nome: string; descricao: string; icone: Icone } {
  return (
    CATALOGO[card.code] ?? {
      nome: card.name,
      descricao: "Aplicação do ecossistema PCTEC liberada para o seu perfil.",
      icone: "generico"
    }
  );
}

/**
 * Ícones desenhados inline: nenhuma biblioteca nova, nenhum request
 * extra, e a cor acompanha `currentColor` — o card controla o tom.
 * Decorativos por definição: o nome do produto está no `<h3>` ao lado,
 * então anunciá-los de novo seria repetição para quem usa leitor.
 */
function IconeDoApp({ tipo }: { tipo: Icone }): JSX.Element {
  const comum = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  if (tipo === "portal") {
    return (
      <svg {...comum}>
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9L20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z" />
        <path d="M14 4v6h6M8 14h8M8 17h5" />
      </svg>
    );
  }
  if (tipo === "helpdesk") {
    return (
      <svg {...comum}>
        <path d="M4 13a8 8 0 0 1 16 0" />
        <path d="M4 13v3a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2Zm16 0v3a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2Z" />
        <path d="M17 18v.5a2.5 2.5 0 0 1-2.5 2.5H12" />
      </svg>
    );
  }
  if (tipo === "ingressa") {
    return (
      <svg {...comum}>
        <path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6Z" />
        <circle cx="12" cy="10.5" r="2.2" />
        <path d="M8.5 16.5a3.8 3.8 0 0 1 7 0" />
      </svg>
    );
  }
  return (
    <svg {...comum}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </svg>
  );
}

/** Iniciais para o avatar — nunca cai em "?" nem mostra identificador interno. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) {
    return "PC";
  }
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

type EstadoDasOrganizacoes =
  | { situacao: "carregando" }
  | { situacao: "ok"; itens: readonly OrganizacaoDoUsuario[] }
  | { situacao: "indisponivel" }
  | { situacao: "erro" };

/**
 * Página inicial de quem entra no Ingressa.
 *
 * **Esta tela não decide autorização.** Ela desenha `sessao.aplicativos`,
 * que é a resposta de `GET /api/v1/apps` — e essa resposta só contém
 * `ApplicationAccess` GRANTED para `Application` ACTIVE. Não há filtro,
 * lista fixa ou condição de perfil aqui: card ausente significa acesso
 * ausente, e esconder um card no cliente nunca seria proteção de
 * qualquer forma.
 *
 * O botão do Portal aponta para a URL que INICIA o SSO **no Portal** — é
 * lá que nascem `state` e `code_verifier`. O Ingressa não pode gerá-los
 * pelo cliente: um verifier que passou por aqui não prova mais nada.
 *
 * Produto sem destino configurado aparece como **"Indisponível no
 * momento"**, nunca com
 * um endereço inventado: enquanto não houver um caminho de entrada
 * seguro e pronto, oferecer um botão seria prometer o que não existe.
 */
export function AplicativosPage({ sessao, onSair }: { sessao: Sessao; onSair: () => void }): JSX.Element {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const [organizacoes, setOrganizacoes] = useState<EstadoDasOrganizacoes>({ situacao: "carregando" });
  const [saindo, setSaindo] = useState(false);

  const erroSso = parametros.get("sso_erro");
  const appDoErro = parametros.get("app");

  const carregarOrganizacoes = useCallback(async () => {
    setOrganizacoes({ situacao: "carregando" });
    try {
      const resposta = await api.organizacoes();
      setOrganizacoes({ situacao: "ok", itens: resposta.organizations });
    } catch (falha) {
      // 403 aqui NÃO é erro: é a rota de contexto do Portal recusando
      // quem não tem acesso ao Portal. Vínculo empresarial e acesso a
      // produto são eixos independentes — tratar como falha faria a tela
      // acusar um problema que não existe.
      if (falha instanceof ApiError && (falha.status === 403 || falha.status === 404)) {
        setOrganizacoes({ situacao: "indisponivel" });
        return;
      }
      setOrganizacoes({ situacao: "erro" });
    }
  }, []);

  useEffect(() => {
    void carregarOrganizacoes();
  }, [carregarOrganizacoes]);

  // Mesma regra do painel administrativo, no mesmo lugar: falha do
  // servidor não prende a pessoa na tela, e `encerrarSessao` nunca
  // rejeita — o `onClick` não recebe promise pendurada.
  async function sair(): Promise<void> {
    setSaindo(true);
    await encerrarSessao(onSair, (estado) =>
      navegar("/login", estado === undefined ? undefined : { state: estado })
    );
  }

  return (
    <div className="launcher">
      <header className="launcher-topo">
        <div className="launcher-marca">
          <img className="launcher-logo" src="/marca/marca-ingressa.png" alt="" width={44} height={44} />
          <div>
            <h1>PCTEC Ingressa</h1>
            <p>Meus aplicativos</p>
          </div>
        </div>
        <div className="launcher-usuario">
          <span className="launcher-avatar" aria-hidden="true">{iniciais(sessao.nomeExibido)}</span>
          <span className="launcher-identificacao">
            <strong>{sessao.nomeExibido}</strong>
            {sessao.ehAdministrador && <span className="launcher-selo">Administrador</span>}
          </span>
          <button type="button" onClick={sair} disabled={saindo}>
            {saindo ? "Saindo…" : "Sair"}
          </button>
        </div>
      </header>

      {erroSso !== null && (
        <div className="aviso aviso-erro" role="alert">
          Não foi possível abrir {appDoErro ?? "o aplicativo"}. Seu acesso pode ter sido revogado ou você ainda não tem
          vínculo com nenhuma empresa. Fale com o administrador.
        </div>
      )}

      <main>
        <section aria-labelledby="titulo-aplicativos">
          <h2 id="titulo-aplicativos" className="launcher-secao">Suas aplicações PCTEC</h2>
          {/* Diz de onde vem a lista: o que aparece é o que o servidor
              liberou para este perfil, não um catálogo de produtos. */}
          <p className="launcher-subtitulo">
            Aparecem aqui somente os sistemas liberados para o seu perfil.
          </p>
          {sessao.aplicativos.length === 0 ? (
            <div className="vazio">
              Você ainda não tem acesso a nenhum aplicativo. Fale com o administrador da PCTEC.
            </div>
          ) : (
            <div className="launcher-grade">
              {sessao.aplicativos.map((card) => (
                <CardDeAplicativo key={card.code} card={card} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="titulo-organizacoes" className="launcher-organizacoes">
          <h2 id="titulo-organizacoes" className="launcher-secao">Suas empresas</h2>
          <ResumoDeOrganizacoes estado={organizacoes} onTentarDeNovo={() => void carregarOrganizacoes()} />
        </section>
      </main>
    </div>
  );
}

function CardDeAplicativo({ card }: { card: AplicativoCard }): JSX.Element {
  const { nome, descricao, icone } = apresentacao(card);
  const indisponivel = card.launchUrl === null;
  // O rótulo visível é igual em todos os cards; o nome acessível não
  // pode ser — quem navega por leitor de tela ouviria "Acessar
  // aplicação" três vezes sem saber qual é qual.
  const nomeAcessivel = `Acessar ${nome}`;

  return (
    <article className={`app-card${indisponivel ? " app-card-indisponivel" : ""}`}>
      <header className="app-card-topo">
        <span className="app-card-icone" aria-hidden="true">
          <IconeDoApp tipo={icone} />
        </span>
        <span className={`app-card-estado${indisponivel ? " app-card-estado-off" : ""}`}>
          {indisponivel ? "Indisponível" : "Disponível"}
        </span>
      </header>

      <h3 className="app-card-nome">{nome}</h3>
      <p className="app-card-descricao">{descricao}</p>

      <p className="app-card-meta">
        <span className="app-card-perfil">Perfil · {rotuloDePerfil(card.profile)}</span>
        {/* O código técnico existe para suporte e conferência: fica
            visível, mas como informação secundária — nunca como título. */}
        <span className="app-card-codigo">{card.code}</span>
      </p>

      <div className="app-card-rodape">
        {indisponivel ? (
          // Sem destino configurado. O acesso EXISTE — por isso o card não
          // some; o que falta é um caminho de entrada pronto, e inventar
          // uma URL aqui seria oferecer uma porta que ninguém abriu.
          <span className="app-card-embreve">Indisponível no momento</span>
        ) : card.launchUrl.startsWith("/") ? (
          // Destino interno (a própria UI do Ingressa): navegação do router,
          // sem recarregar a aplicação inteira.
          <Link className="app-card-acao" to={card.launchUrl} aria-label={nomeAcessivel}>
            Acessar aplicação
          </Link>
        ) : (
          // Destino externo: navegação NATIVA, de propósito. O SSO começa
          // com um redirect do outro produto, e `fetch`/router não seguem
          // esse caminho. Mesma aba, como sempre foi.
          <a className="app-card-acao" href={card.launchUrl} aria-label={nomeAcessivel}>
            Acessar aplicação
          </a>
        )}
      </div>
    </article>
  );
}

function ResumoDeOrganizacoes({
  estado,
  onTentarDeNovo
}: {
  estado: EstadoDasOrganizacoes;
  onTentarDeNovo: () => void;
}): JSX.Element {
  if (estado.situacao === "carregando") {
    return <div className="vazio" role="status">Carregando suas empresas…</div>;
  }

  if (estado.situacao === "erro") {
    return (
      <div className="aviso aviso-erro" role="alert">
        Não foi possível carregar suas empresas.{" "}
        <button type="button" className="ligacao" onClick={onTentarDeNovo}>Tentar de novo</button>
      </div>
    );
  }

  if (estado.situacao === "indisponivel") {
    return (
      <div className="vazio">
        A lista de empresas fica disponível para quem tem acesso ao PCTEC Portal.
      </div>
    );
  }

  if (estado.itens.length === 0) {
    return <div className="vazio">Você ainda não está vinculado a nenhuma empresa.</div>;
  }

  return (
    <ul className="lista-organizacoes">
      {estado.itens.map((org) => (
        <li key={org.publicId}>
          <span className="organizacao-nome">{org.tradeName ?? org.legalName}</span>
          <span className="organizacao-tipo">{org.type === "BUSINESS_GROUP" ? "Grupo" : "Empresa"}</span>
        </li>
      ))}
    </ul>
  );
}
