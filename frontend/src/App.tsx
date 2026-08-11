import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { PortalContextProvider, usePortalContext } from "./portal/PortalContextProvider.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LoadingScreen, NetworkErrorScreen, UnauthorizedScreen } from "./pages/StateScreens.js";
import { Shell } from "./components/Shell.js";
import { OrganizationSwitcher } from "./components/OrganizationSwitcher.js";
import { EmptyOrganizationState } from "./components/EmptyOrganizationState.js";

/**
 * `AppGate` — decide entre login / estados de bootstrap / app
 * autenticado, com base exclusivamente em `useAuth().status` (nunca
 * "tem variável JS = logado" — task G4, "Login").
 */
function AppGate(): JSX.Element {
  const { status, retryBootstrap } = useAuth();

  if (status.kind === "loading") {
    return <LoadingScreen />;
  }
  if (status.kind === "bootstrap-error") {
    return <NetworkErrorScreen onRetry={retryBootstrap} />;
  }
  if (status.kind === "unauthenticated") {
    return <LoginPage />;
  }

  return (
    <PortalContextProvider>
      <PortalGate identityPublicId={status.identityPublicId} />
    </PortalContextProvider>
  );
}

/**
 * `PortalGate` — resolve o estado de `/portal/context` (task G4,
 * "Bootstrap"): 401 já foi tratado em `AppGate` (nunca chega aqui sem
 * `status.kind === "authenticated"`); aqui só restam 403
 * `APPLICATION_ACCESS_DENIED`, erro de rede/5xx, ou sucesso (0, 1 ou
 * 2+ Organizations).
 */
function PortalGate({ identityPublicId }: { readonly identityPublicId: string }): JSX.Element {
  const { state, selectOrganization, retry } = usePortalContext();

  if (state.kind === "loading") {
    return <LoadingScreen />;
  }
  if (state.kind === "access-denied") {
    return <UnauthorizedScreen />;
  }
  if (state.kind === "error") {
    return <NetworkErrorScreen onRetry={retry} />;
  }

  const { organizations, selectedOrganizationPublicId } = state;

  if (organizations.length === 0) {
    return (
      <Shell identityPublicId={identityPublicId} currentOrganizationName={undefined}>
        <EmptyOrganizationState />
      </Shell>
    );
  }

  if (selectedOrganizationPublicId === undefined) {
    return (
      <Shell identityPublicId={identityPublicId} currentOrganizationName={undefined}>
        <OrganizationSwitcher organizations={organizations} onSelect={selectOrganization} />
      </Shell>
    );
  }

  const selectedOrganization = organizations.find((org) => org.publicId === selectedOrganizationPublicId);
  if (selectedOrganization === undefined) {
    // Defesa em profundidade — nunca deveria acontecer (selectOrganization
    // só aceita publicIds já presentes em `organizations`), mas nunca
    // renderiza um Dashboard com dado inconsistente.
    return (
      <Shell identityPublicId={identityPublicId} currentOrganizationName={undefined}>
        <OrganizationSwitcher organizations={organizations} onSelect={selectOrganization} />
      </Shell>
    );
  }

  return (
    <Shell
      identityPublicId={identityPublicId}
      currentOrganizationName={selectedOrganization.tradeName ?? selectedOrganization.legalName}
    >
      <DashboardPage identityPublicId={identityPublicId} organization={selectedOrganization} />
    </Shell>
  );
}

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* G4: uma única experiência gated por status de auth/portal —
              não há múltiplas rotas de navegação reais ainda (task G4,
              "Navegação: somente itens que façam sentido com
              funcionalidades REALMENTE existentes"). React Router já
              está em uso real aqui, pronto para crescer em fases
              futuras sem reestruturação. */}
          <Route path="*" element={<AppGate />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
