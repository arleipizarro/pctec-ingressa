import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, type AplicativoCard, type OrganizacaoDoUsuario } from "../api.js";
import type { Sessao } from "../auth.js";
import { CODIGO_INGRESSA, encerrarSessao } from "../auth.js";

const CODIGO_PORTAL = "PCTEC_PORTAL";
const CODIGO_HELPDESK = "PCTEC_HELPDESK";

/**
 * Textos e rótulo de ação por produto conhecido.
 *
 * Puramente de apresentação: NÃO decide quais cards aparecem nem se são
 * clicáveis. Um código desconhecido cai no texto genérico e continua
 * aparecendo — se o servidor autorizou, a tela mostra.
 */
const APRESENTACAO: Readonly<Record<string, { descricao: string; acao: string }>> = {
  [CODIGO_PORTAL]: {
    descricao: "Contratos, equipamentos e faturamento das empresas onde você tem vínculo.",
    acao: "Acessar Portal"
  },
  [CODIGO_HELPDESK]: {
    descricao: "Abertura e acompanhamento de chamados de suporte.",
    acao: "Acessar Helpdesk"
  },
  [CODIGO_INGRESSA]: {
    descricao: "Identidades, organizações, acessos e importações da plataforma.",
    acao: "Abrir administração"
  }
};

function apresentacao(card: AplicativoCard): { descricao: string; acao: string } {
  return APRESENTACAO[card.code] ?? { descricao: "Aplicativo do ecossistema PCTEC.", acao: "Acessar" };
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
 * Produto sem destino configurado aparece como **"Em breve"**, nunca com
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
          <span className="launcher-logo" aria-hidden="true">PC</span>
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
          <h2 id="titulo-aplicativos" className="launcher-secao">Aplicativos</h2>
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
  const { descricao, acao } = apresentacao(card);
  const indisponivel = card.launchUrl === null;

  return (
    <article className={`app-card${indisponivel ? " app-card-indisponivel" : ""}`}>
      <header>
        <span className="app-card-sigla" aria-hidden="true">{card.name.slice(0, 2).toUpperCase()}</span>
        <div>
          <strong>{card.name}</strong>
          <span className="app-card-perfil">{card.profile}</span>
        </div>
      </header>
      <p className="app-card-descricao">{descricao}</p>
      {indisponivel ? (
        // Sem destino configurado. O acesso EXISTE — por isso o card não
        // some; o que falta é um caminho de entrada pronto, e inventar
        // uma URL aqui seria oferecer uma porta que ninguém abriu.
        <span className="app-card-embreve">Em breve</span>
      ) : card.launchUrl.startsWith("/") ? (
        // Destino interno (a própria UI do Ingressa): navegação do router,
        // sem recarregar a aplicação inteira.
        <Link className="app-card-acao" to={card.launchUrl}>{acao}</Link>
      ) : (
        // Destino externo: navegação NATIVA, de propósito. O SSO começa
        // com um redirect do outro produto, e `fetch`/router não seguem
        // esse caminho.
        <a className="app-card-acao" href={card.launchUrl}>{acao}</a>
      )}
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
