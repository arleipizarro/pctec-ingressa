import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchPortalContext, type PortalOrganization } from "../api/endpoints.js";
import { ApiError, ApiNetworkError } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";

export type PortalContextState =
  | { readonly kind: "loading" }
  | { readonly kind: "access-denied" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly organizations: readonly PortalOrganization[];
      /** `undefined` até o usuário escolher (só relevante quando `organizations.length > 1`). */
      readonly selectedOrganizationPublicId: string | undefined;
    };

export interface PortalContextValue {
  readonly state: PortalContextState;
  /**
   * Define a Organization atual da UI. **Isto é contexto de navegação,
   * nunca prova de autorização** (task G4, "Organization": "seleção é
   * contexto de UI, nunca autorização") — qualquer operação comercial
   * futura precisa revalidar no backend (`requireOrganizationAccess`,
   * já implementado em G3, ainda não usado por nenhuma rota real).
   * Só aceita um `publicId` que já veio de `organizations` — nunca um
   * valor arbitrário.
   */
  readonly selectOrganization: (organizationPublicId: string) => void;
  readonly retry: () => void;
}

const PortalDataContext = createContext<PortalContextValue | undefined>(undefined);

/**
 * G4 (v0.7.x). Consome `GET /api/v1/portal/context` — nunca recalcula
 * `Membership`/`OrganizationRelationship`/`AND_DESCENDANTS` no
 * frontend (task G4, "Bootstrap": "Não recalcular Membership... Não
 * implementar AND_DESCENDANTS no frontend"). A deduplicação também já
 * vem pronta do backend (G3, `GetPortalContextService`) — o frontend
 * só exibe o array recebido, sem reprocessar.
 *
 * **Seleção NÃO é persistida** (localStorage/sessionStorage/cookie) —
 * decisão deliberada desta entrega: fica só em estado do React,
 * perdida ao recarregar a página (nesse caso, 1 Organization
 * re-seleciona automaticamente; 2+ pede escolha de novo). Justificativa:
 * minimalismo (task G4, "Evite persistência permanente sem
 * necessidade") e para não introduzir mais um lugar onde um
 * identificador de Organization poderia vazar/persistir sem
 * necessidade demonstrada.
 */
export function PortalContextProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const { status } = useAuth();
  const [state, setState] = useState<PortalContextState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status.kind !== "authenticated") {
      // Nunca busca /portal/context sem sessão confirmada — reflete o
      // pipeline real do backend (requireAuthenticatedSession sempre
      // antes de requireApplicationAccess).
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });

    fetchPortalContext()
      .then((result) => {
        if (cancelled) return;
        setState({
          kind: "ready",
          organizations: result.organizations,
          // 1 Organization -> seleção automática (task G4, "Organization").
          selectedOrganizationPublicId: result.organizations.length === 1 ? result.organizations[0]?.publicId : undefined
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === "APPLICATION_ACCESS_DENIED") {
          setState({ kind: "access-denied" });
          return;
        }
        if (error instanceof ApiNetworkError || error instanceof ApiError) {
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [status.kind, status.kind === "authenticated" ? status.identityPublicId : undefined, attempt]);

  const selectOrganization = useCallback((organizationPublicId: string) => {
    setState((current) => {
      if (current.kind !== "ready") {
        return current;
      }
      // Nunca aceita um publicId que não veio da lista real retornada
      // pelo backend — mesmo sendo só contexto de UI (não autorização),
      // não faz sentido a UI "selecionar" algo que ela não sabe que
      // existe.
      const exists = current.organizations.some((org) => org.publicId === organizationPublicId);
      if (!exists) {
        return current;
      }
      return { ...current, selectedOrganizationPublicId: organizationPublicId };
    });
  }, []);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<PortalContextValue>(
    () => ({ state, selectOrganization, retry }),
    [state, selectOrganization, retry]
  );

  return <PortalDataContext.Provider value={value}>{children}</PortalDataContext.Provider>;
}

export function usePortalContext(): PortalContextValue {
  const context = useContext(PortalDataContext);
  if (context === undefined) {
    throw new Error("usePortalContext precisa ser usado dentro de <PortalContextProvider>.");
  }
  return context;
}
