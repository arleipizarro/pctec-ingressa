/**
 * Telas de estado cheio (loading/erro/acesso negado) — G4 (v0.7.x).
 * Deliberadamente sem dado inventado, sem card decorativo — só o
 * mínimo necessário para orientar o usuário.
 */

export function LoadingScreen(): JSX.Element {
  return (
    <div className="full-screen-state" role="status" aria-live="polite">
      <p>Carregando...</p>
    </div>
  );
}

export interface NetworkErrorScreenProps {
  readonly onRetry: () => void;
}

/** 5xx/falha de rede — nunca confundida com "senha inválida" ou "sem sessão" (task G4). */
export function NetworkErrorScreen({ onRetry }: NetworkErrorScreenProps): JSX.Element {
  return (
    <div className="full-screen-state">
      <h1>Não foi possível conectar ao PCTEC Ingressa</h1>
      <p>Verifique sua conexão ou tente novamente em instantes.</p>
      <button type="button" className="retry-button" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

/** 403 APPLICATION_ACCESS_DENIED — sessão válida, mas sem ApplicationAccess(PCTEC_PORTAL, USER). */
export function UnauthorizedScreen(): JSX.Element {
  return (
    <div className="full-screen-state">
      <h1>Acesso ao Portal não autorizado</h1>
      <p>
        Sua sessão é válida, mas seu usuário ainda não tem acesso liberado ao PCTEC Portal. Entre em contato com o
        administrador responsável.
      </p>
    </div>
  );
}
