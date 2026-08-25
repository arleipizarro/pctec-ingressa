import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";

/**
 * Prefixo do ÚNICO destino de retomada aceito.
 *
 * `next` chega pela URL, então é entrada não confiável por definição. A
 * regra é branca e estreita: só um caminho relativo que começa
 * exatamente com o endpoint de autorização do SSO. Isso exclui de uma
 * vez `https://…`, `//outro-host` e `/qualquer/outra/coisa` — não há
 * como transformar este parâmetro em um salto para fora do Ingressa.
 */
const RETOMADA_PERMITIDA = "/api/v1/sso/authorize?";

function destinoDeRetomada(next: string | null): string | null {
  return next !== null && next.startsWith(RETOMADA_PERMITIDA) ? next : null;
}

export function LoginPage({ onAutenticado }: { onAutenticado: () => Promise<void> }): JSX.Element {
  const [parametros] = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const retomada = destinoDeRetomada(parametros.get("next"));

  async function entrar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.login(email, senha);
      if (retomada !== null) {
        // Retomada do SSO: o destino é uma rota do BACKEND, que responde
        // com um 302 para o cliente — por isso `location.assign`, e não
        // navegação do router (que só troca a tela do SPA).
        window.location.assign(retomada);
        return;
      }
      // O backend decide o que esta identidade pode ver; o frontend só
      // pergunta de novo quem ele é.
      await onAutenticado();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível entrar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={entrar}>
        <h1>PCTEC Ingressa</h1>
        <p className="subtitulo" style={{ margin: 0 }}>Acesso às aplicações PCTEC</p>
        {retomada !== null && (
          <div className="aviso aviso-alerta" role="status">
            Entre para continuar até o aplicativo que você pediu.
          </div>
        )}
        {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="senha">Senha</label>
        <input id="senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        <button type="submit" className="primario" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
