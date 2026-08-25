import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api.js";

export function LoginPage({ onAutenticado }: { onAutenticado: () => Promise<void> }): JSX.Element {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.login(email, senha);
      // O backend decide se esta identidade é ADMIN; o frontend só
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
        <p className="subtitulo" style={{ margin: 0 }}>Administração da plataforma</p>
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
