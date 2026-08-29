import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { encerrarSessao, type Sessao } from "../auth.js";

const ITENS = [
  { para: "/admin", rotulo: "Painel", fim: true },
  { para: "/admin/usuarios", rotulo: "Usuários", fim: false },
  { para: "/admin/organizacoes", rotulo: "Organizações", fim: false },
  { para: "/admin/convites", rotulo: "Convites", fim: false },
  { para: "/admin/importacoes", rotulo: "Importações", fim: false },
  { para: "/admin/auditoria", rotulo: "Auditoria", fim: false }
];

/** Largura a partir da qual o menu deixa de ser gaveta e volta a ser coluna fixa. */
const LARGURA_DESKTOP = "(min-width: 861px)";

export function Layout({ sessao, onSair }: { sessao: Sessao; onSair: () => void }): JSX.Element {
  const navegar = useNavigate();
  // Só tem efeito na largura estreita, onde o menu é uma gaveta. No
  // desktop o menu está sempre visível e este estado é ignorado pelo CSS.
  const [menuAberto, setMenuAberto] = useState(false);
  const botaoMenu = useRef<HTMLButtonElement>(null);

  // Fechar devolve o foco ao botão que abriu. Sem isso, quem navega por
  // teclado fecha a gaveta e o foco volta para o começo do documento —
  // perde o lugar e precisa tabular tudo de novo.
  const fechar = useCallback((): void => {
    setMenuAberto(false);
    botaoMenu.current?.focus();
  }, []);

  // Escape fecha. O listener só existe enquanto a gaveta está aberta,
  // então não há tecla capturada à toa no resto da aplicação.
  useEffect(() => {
    if (!menuAberto) return undefined;
    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === "Escape") fechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [menuAberto, fechar]);

  // Rolagem do fundo travada enquanto a gaveta está aberta: sem isso o
  // conteúdo desliza por baixo da sobreposição e a pessoa perde a
  // posição da página. O valor anterior é restaurado — sobrescrever com
  // "" apagaria um overflow que outra parte da aplicação tenha definido.
  useEffect(() => {
    if (!menuAberto) return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [menuAberto]);

  // Alargar a janela com a gaveta aberta deixaria o corpo travado e um
  // estado "aberto" sem sentido no desktop, onde o menu já é fixo.
  useEffect(() => {
    if (!menuAberto || typeof window.matchMedia !== "function") return undefined;
    const consulta = window.matchMedia(LARGURA_DESKTOP);
    if (consulta.matches) {
      setMenuAberto(false);
      return undefined;
    }
    const aoMudar = (): void => {
      if (consulta.matches) setMenuAberto(false);
    };
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, [menuAberto]);

  // Falha no logout do servidor não prende a pessoa na tela: a sessão
  // local cai de qualquer forma e ela volta ao login, avisada. Toda a
  // regra vive em `encerrarSessao`, que nunca rejeita — as duas telas
  // com botão "Sair" compartilham o mesmo comportamento.
  async function sair(): Promise<void> {
    await encerrarSessao(onSair, (estado) =>
      navegar("/login", estado === undefined ? undefined : { state: estado })
    );
  }

  return (
    <div className="layout">
      <aside className={`sidebar${menuAberto ? " aberto" : ""}`} id="menu-principal">
        <div className="sidebar-marca">
          {/* A marca é decorativa aqui: o nome do produto está no <h1>
              ao lado, então repeti-lo no alt only duplicaria a leitura. */}
          <img className="sidebar-simbolo" src="/marca/marca-ingressa.png" alt="" width={40} height={40} />
          <h1>PCTEC Ingressa<small>Administração</small></h1>
          {/* Só existe na gaveta: no desktop o menu não fecha, e um "X"
              ali seria um botão que não faz nada. */}
          <button type="button" className="menu-fechar" aria-label="Fechar menu" onClick={fechar}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav aria-label="Administração">
          {ITENS.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              end={item.fim}
              className={({ isActive }) => (isActive ? "ativo" : "")}
              onClick={fechar}
            >
              {item.rotulo}
            </NavLink>
          ))}
        </nav>
      </aside>
      {/* Fundo clicável: fechar a gaveta tocando fora é o gesto esperado
          no celular. Não recebe foco — o mesmo fechamento está no "X". */}
      {menuAberto && <div className="menu-fundo" onClick={fechar} aria-hidden="true" />}
      <div className="conteudo">
        <header className="topo">
          <button
            type="button"
            className="menu-alternar"
            ref={botaoMenu}
            aria-expanded={menuAberto}
            aria-controls="menu-principal"
            onClick={() => setMenuAberto((aberto) => !aberto)}
          >
            <span className="menu-alternar-barras" aria-hidden="true" />
            Menu
          </button>
          <span className="usuario">
            <strong>{sessao.nomeExibido}</strong> · perfil {sessao.perfilNoIngressa ?? "—"}
          </span>
          <span className="acoes-topo">
            {/* Volta ao launcher sem sair da sessão: administrar e usar os
                produtos são coisas diferentes, e sair para trocar de uma
                para a outra seria um caminho absurdo. */}
            <NavLink to="/apps">Meus aplicativos</NavLink>
            <button type="button" onClick={sair}>Sair</button>
          </span>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
