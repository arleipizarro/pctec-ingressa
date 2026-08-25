import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { useSessao } from "./auth.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { UsuariosPage } from "./pages/UsuariosPage.js";
import { UsuarioDetalhePage } from "./pages/UsuarioDetalhePage.js";
import { OrganizacoesPage } from "./pages/OrganizacoesPage.js";
import { OrganizacaoDetalhePage } from "./pages/OrganizacaoDetalhePage.js";
import { ImportacoesPage } from "./pages/ImportacoesPage.js";
import { LoteDetalhePage } from "./pages/LoteDetalhePage.js";
import { NovaImportacaoPage } from "./pages/NovaImportacaoPage.js";

export function App(): JSX.Element {
  const { sessao, carregando, recarregar, encerrar } = useSessao();

  if (carregando) {
    return <div className="vazio" role="status">Carregando…</div>;
  }

  if (sessao === null) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onAutenticado={recarregar} />} />
        {/* Sem sessão, toda rota cai no login — a proteção real está no
            servidor, mas navegar para uma tela vazia seria confuso. */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout sessao={sessao} onSair={encerrar} />}>
        <Route index element={<DashboardPage />} />
        <Route path="usuarios" element={<UsuariosPage />} />
        <Route path="usuarios/:publicId" element={<UsuarioDetalhePage />} />
        <Route path="organizacoes" element={<OrganizacoesPage />} />
        <Route path="organizacoes/:publicId" element={<OrganizacaoDetalhePage />} />
        <Route path="importacoes" element={<ImportacoesPage />} />
        {/* Rota literal ANTES da paramétrica: `nova` não é um publicId. */}
        <Route path="importacoes/nova" element={<NovaImportacaoPage />} />
        <Route path="importacoes/:publicId" element={<LoteDetalhePage />} />
        <Route path="*" element={<div className="vazio">Página não encontrada.</div>} />
      </Route>
    </Routes>
  );
}
