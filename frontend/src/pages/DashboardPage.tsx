import type { PortalOrganization } from "../api/endpoints.js";

export interface DashboardPageProps {
  readonly identityPublicId: string;
  readonly organization: PortalOrganization;
}

/**
 * Dashboard mínimo — G4 (v0.7.x). Mostra exclusivamente dados REAIS já
 * obtidos de `/me` e `/portal/context` — nenhum número, gráfico,
 * alerta ou métrica inventada (task G4, "Não inventar... dados
 * simulados"; "Prefiro uma tela pequena verdadeira a um dashboard
 * grande fake").
 */
export function DashboardPage({ identityPublicId, organization }: DashboardPageProps): JSX.Element {
  return (
    <div className="dashboard">
      <h1>Bem-vindo ao PCTEC Ingressa</h1>
      <div className="dashboard-facts">
        <div className="dashboard-fact">
          <span className="label">Organização atual</span>
          <span className="value">{organization.tradeName ?? organization.legalName}</span>
        </div>
        <div className="dashboard-fact">
          <span className="label">Tipo da organização</span>
          <span className="value">{organization.type}</span>
        </div>
        <div className="dashboard-fact">
          <span className="label">Identidade autenticada</span>
          <span className="value">{identityPublicId}</span>
        </div>
      </div>
    </div>
  );
}
