import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError, ApiNetworkError } from "../api/client.js";
import logo from "../assets/pctec-ingressa-logo.png";

type SubmitState = { readonly kind: "idle" | "submitting" } | { readonly kind: "error"; readonly message: string };

/**
 * Tela de login — G4 (v0.7.x). Consome `POST /api/v1/sessions` (via
 * `useAuth().login`, que já confirma a sessão via `GET /me` antes de
 * marcar a UI como autenticada).
 *
 * **`password` nunca permanece em estado depois do submit concluído**
 * (task G4) — limpo tanto em caso de sucesso (o componente inteiro
 * desmonta, então o estado local desaparece) quanto em caso de erro
 * (limpo explicitamente aqui, para o usuário digitar de novo — nunca
 * fica retido em memória do React além do tempo da própria tentativa).
 */
export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const isSubmitting = submitState.kind === "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitState({ kind: "submitting" });

    try {
      await login(email, password);
      // Sucesso: este componente será desmontado pelo AppGate (status
      // vira "authenticated") — nada mais a fazer aqui.
    } catch (error) {
      setSubmitState({ kind: "error", message: describeLoginError(error) });
    } finally {
      // Nunca deixa a senha em estado depois que a tentativa de submit
      // termina, sucesso ou falha.
      setPassword("");
    }
  }

  return (
    <div className="login-screen">
      <div className="login-brand-panel">
        <img src={logo} alt="PCTEC Ingressa — gestão de identidades" />
      </div>
      <div className="login-form-panel">
        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <h1>Acessar o PCTEC Ingressa</h1>
          <p className="subtitle">Entre com suas credenciais corporativas.</p>

          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          {submitState.kind === "error" && <p className="form-error">{submitState.message}</p>}

          <button type="submit" className="submit-button" disabled={isSubmitting}>
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Nunca expõe `error.message` bruto do backend na UI (mensagens de
 * `DomainError` não são um contrato estável de apresentação) — mapeia
 * por `code`/tipo para uma mensagem fixa e genérica. Falha de
 * autenticação e falha de rede têm mensagens DIFERENTES — nunca
 * "senha inválida" para um problema de rede (task G4).
 */
function describeLoginError(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Não foi possível contatar o servidor. Verifique sua conexão e tente novamente.";
  }
  if (error instanceof ApiError) {
    if (error.code === "AUTHENTICATION_FAILED") {
      return "E-mail ou senha inválidos.";
    }
    return "Não foi possível entrar. Tente novamente em instantes.";
  }
  return "Não foi possível entrar. Tente novamente em instantes.";
}
