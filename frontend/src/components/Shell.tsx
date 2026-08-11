import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext.js";
import logo from "../assets/pctec-ingressa-logo.png";

export interface ShellProps {
  readonly identityPublicId: string;
  readonly currentOrganizationName: string | undefined;
  readonly children: ReactNode;
}

/**
 * Shell autenticado — G4 (v0.7.x). Continuação visual da marca da tela
 * de entrada (mesma arte oficial, mesmo azul-marinho estrutural),
 * conforme direção visual pedida. Logout REAL — consome
 * `DELETE /api/v1/sessions/current`, confirmado existente no backend
 * (nunca um endpoint inventado).
 */
export function Shell({ identityPublicId, currentOrganizationName, children }: ShellProps): JSX.Element {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <img src={logo} alt="PCTEC Ingressa" />
          <span>PCTEC Ingressa</span>
        </div>
        <div className="app-header-meta">
          {currentOrganizationName !== undefined && <span className="org-name">{currentOrganizationName}</span>}
          <span className="identity-id">{identityPublicId}</span>
          <button type="button" className="logout-button" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
