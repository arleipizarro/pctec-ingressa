import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { Sessao } from "../auth.js";
import type { AplicativoCard } from "../api.js";

/**
 * Descrições dos produtos conhecidos. Puramente textual — NÃO decide
 * quais cards aparecem, nem em qual ordem. Um código desconhecido cai no
 * texto genérico e continua aparecendo: se o servidor autorizou, a tela
 * mostra, mesmo que este arquivo nunca tenha ouvido falar do produto.
 */
const DESCRICOES: Readonly<Record<string, string>> = {
  PCTEC_PORTAL: "Contratos, chamados e faturamento das empresas onde você tem vínculo.",
  PCTEC_HELPDESK: "Abertura e acompanhamento de chamados de suporte.",
  PCTEC_INGRESSA: "Identidades, organizações, acessos e importações da plataforma."
};

function descricao(card: AplicativoCard): string {
  return DESCRICOES[card.code] ?? "Aplicativo do ecossistema PCTEC.";
}

/**
 * Painel "Meus aplicativos" — a primeira tela de quem entra no Ingressa.
 *
 * **Esta tela não decide autorização.** Ela desenha `sessao.aplicativos`,
 * que é a resposta de `GET /api/v1/apps` — e essa resposta só contém
 * `ApplicationAccess` GRANTED para `Application` ACTIVE. Não há filtro,
 * lista fixa ou condição de perfil aqui: card ausente significa acesso
 * ausente, e esconder um card nunca seria proteção de qualquer forma.
 *
 * O clique no card do Portal navega para a URL que INICIA o SSO **no
 * Portal** — é lá que nascem `state` e `code_verifier`. O Ingressa não
 * pode gerá-los pelo cliente: o verifier precisa ficar guardado do lado
 * de quem vai trocar o código, e um verifier que passou pelo Ingressa
 * não prova mais nada.
 */
export function AplicativosPage({ sessao, onSair }: { sessao: Sessao; onSair: () => void }): JSX.Element {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const erroSso = parametros.get("sso_erro");
  const appDoErro = parametros.get("app");

  async function sair(): Promise<void> {
    try {
      await api.logout();
    } finally {
      onSair();
      navegar("/login");
    }
  }

  return (
    <div className="launcher">
      <header className="launcher-topo">
        <div>
          <h1>PCTEC Ingressa</h1>
          <p className="subtitulo" style={{ margin: 0 }}>Meus aplicativos</p>
        </div>
        <div className="launcher-usuario">
          <span>
            <strong>{sessao.nomeExibido}</strong>
          </span>
          <button type="button" onClick={sair}>Sair</button>
        </div>
      </header>

      {erroSso !== null && (
        <div className="aviso aviso-erro" role="alert">
          Não foi possível abrir {appDoErro ?? "o aplicativo"}. Seu acesso pode ter sido revogado ou você ainda não tem
          vínculo com nenhuma empresa. Fale com o administrador.
        </div>
      )}

      <main className="launcher-grade">
        {sessao.aplicativos.length === 0 && (
          <div className="vazio">
            Você ainda não tem acesso a nenhum aplicativo. Fale com o administrador da PCTEC.
          </div>
        )}
        {sessao.aplicativos.map((card) => (
          <CardDeAplicativo key={card.code} card={card} />
        ))}
      </main>
    </div>
  );
}

function CardDeAplicativo({ card }: { card: AplicativoCard }): JSX.Element {
  const indisponivel = card.launchUrl === null;
  return (
    <a
      className={`app-card${indisponivel ? " app-card-indisponivel" : ""}`}
      href={card.launchUrl ?? undefined}
      aria-disabled={indisponivel}
      onClick={(evento) => {
        if (indisponivel) {
          evento.preventDefault();
        }
      }}
    >
      <span className="app-card-perfil">{card.profile}</span>
      <strong>{card.name}</strong>
      <span className="app-card-descricao">{descricao(card)}</span>
      {indisponivel && (
        // O acesso existe; o destino é que não está configurado neste
        // ambiente. Sumir com o card faria a pessoa achar que perdeu o
        // acesso, e o administrador procurar no lugar errado.
        <span className="app-card-aviso">Destino não configurado neste ambiente.</span>
      )}
    </a>
  );
}
