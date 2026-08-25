import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import type { Sessao } from "../auth.js";

const ITENS = [
  { para: "/admin", rotulo: "Painel", fim: true },
  { para: "/admin/usuarios", rotulo: "Usuários", fim: false },
  { para: "/admin/organizacoes", rotulo: "Organizações", fim: false },
  { para: "/admin/convites", rotulo: "Convites", fim: false },
  { para: "/admin/importacoes", rotulo: "Importações", fim: false }
];

export function Layout({ sessao, onSair }: { sessao: Sessao; onSair: () => void }): JSX.Element {
  const navegar = useNavigate();

  async function sair(): Promise<void> {
    try {
      await api.logout();
    } finally {
      // Falha no logout do servidor não pode prender a pessoa na tela:
      // a sessão local cai de qualquer forma e ela volta ao login.
      onSair();
      navegar("/login");
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>PCTEC Ingressa<small>Administração</small></h1>
        <nav>
          {ITENS.map((item) => (
            <NavLink key={item.para} to={item.para} end={item.fim} className={({ isActive }) => (isActive ? "ativo" : "")}>
              {item.rotulo}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="conteudo">
        <header className="topo">
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
