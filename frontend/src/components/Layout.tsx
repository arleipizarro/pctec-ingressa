import { useState } from "react";
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

export function Layout({ sessao, onSair }: { sessao: Sessao; onSair: () => void }): JSX.Element {
  const navegar = useNavigate();
  // Só tem efeito na largura estreita, onde o menu é uma gaveta. No
  // desktop o menu está sempre visível e este estado é ignorado pelo CSS.
  const [menuAberto, setMenuAberto] = useState(false);

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
        </div>
        <nav aria-label="Administração">
          {ITENS.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              end={item.fim}
              className={({ isActive }) => (isActive ? "ativo" : "")}
              onClick={() => setMenuAberto(false)}
            >
              {item.rotulo}
            </NavLink>
          ))}
        </nav>
      </aside>
      {/* Fundo clicável: fechar a gaveta tocando fora é o gesto esperado
          no celular. Não recebe foco — o mesmo fechamento está no botão. */}
      {menuAberto && <div className="menu-fundo" onClick={() => setMenuAberto(false)} aria-hidden="true" />}
      <div className="conteudo">
        <header className="topo">
          <button
            type="button"
            className="menu-alternar"
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
