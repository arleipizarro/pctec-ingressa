import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchMe, login as loginRequest, logout as logoutRequest } from "../api/endpoints.js";
import { ApiError, ApiNetworkError } from "../api/client.js";

export type AuthStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "authenticated"; readonly identityPublicId: string }
  | { readonly kind: "bootstrap-error" };

export interface AuthContextValue {
  readonly status: AuthStatus;
  /** Lança `ApiError`/`ApiNetworkError` para o chamador tratar (ex.: LoginPage mostra a mensagem certa) — nunca engole o erro. */
  readonly login: (email: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
  /** Re-executa o bootstrap (GET /me) — usado pela tela de erro de rede ("tentar novamente"). */
  readonly retryBootstrap: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * G4 (v0.7.x) — Provider de autenticação.
 *
 * **Nunca "UI autenticada" só porque `POST /sessions` retornou 201** —
 * `login()` SEMPRE confirma via `GET /me` antes de marcar
 * `status.kind = "authenticated"` (task G4, "Login": "validar sessão
 * via /me antes de considerar a UI autenticada"). Isso prova que o
 * cookie HttpOnly foi de fato gravado e é reconhecido pelo backend —
 * não apenas que o `POST` teve suceso.
 *
 * **`bootstrap-error` é um estado DISTINTO de `unauthenticated`** — uma
 * falha de rede/5xx durante o `GET /me` inicial NUNCA deve ser
 * silenciosamente tratada como "sem sessão" (mandaria o usuário para
 * login quando o problema real é o backend estar fora do ar).
 *
 * Nenhum token/cookie é lido, gravado ou inspecionado aqui — só chama
 * `fetchMe()`/`loginRequest()`/`logoutRequest()`, que usam
 * `credentials:"include"` (client.ts). Nenhuma senha é armazenada
 * neste Context — `login()` recebe `password` só como parâmetro de
 * função, nunca grava em estado do React.
 */
export function AuthProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>({ kind: "loading" });
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });

    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setStatus({ kind: "authenticated", identityPublicId: me.identity.publicId });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError) {
          // Qualquer ApiError aqui (SESSION_INVALID é o esperado, mas
          // qualquer 4xx do /me vira "sem sessão reconhecida" — nunca
          // um 500 real, tratado abaixo) leva a "unauthenticated".
          if (error.status >= 500) {
            setStatus({ kind: "bootstrap-error" });
            return;
          }
          setStatus({ kind: "unauthenticated" });
          return;
        }
        if (error instanceof ApiNetworkError) {
          setStatus({ kind: "bootstrap-error" });
          return;
        }
        // Erro inesperado, não reconhecido pelo cliente HTTP — mesma
        // defesa em profundidade: nunca assume "sem sessão" para algo
        // que não sabemos classificar.
        setStatus({ kind: "bootstrap-error" });
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    await loginRequest(email, password);
    // Confirmação obrigatória via /me — nunca confia só no 201 do login.
    const me = await fetchMe();
    setStatus({ kind: "authenticated", identityPublicId: me.identity.publicId });
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutRequest();
    } finally {
      // Mesmo que a chamada de logout falhe (ex.: rede), a UI local
      // sempre volta para "unauthenticated" — o pior caso é o backend
      // ainda considerar a sessão válida (cookie expira sozinho pelo
      // TTL), nunca o inverso (usuário preso numa UI que diz estar
      // logado sem conseguir sair).
      setStatus({ kind: "unauthenticated" });
    }
  }, []);

  const retryBootstrap = useCallback(() => {
    setBootstrapAttempt((n) => n + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, login, logout, retryBootstrap }),
    [status, login, logout, retryBootstrap]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth precisa ser usado dentro de <AuthProvider>.");
  }
  return context;
}
