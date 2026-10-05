import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api.js";

/**
 * A mesma frase para todo pedido aceito — exista o e-mail ou não.
 *
 * Fixa no frontend, e não lida da resposta: a tela não pode mudar de
 * texto por nenhum motivo que dependa do e-mail digitado.
 */
export const MENSAGEM_PEDIDO_NEUTRO =
  "Se este e-mail estiver cadastrado, enviaremos instruções para redefinir sua senha.";

export const MENSAGEM_MUITOS_PEDIDOS =
  "Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.";

/**
 * "Esqueci minha senha" — tela PÚBLICA de pedido.
 *
 * Depois de enviar, o formulário some e fica só a frase neutra: um
 * segundo envio imediato não ajudaria ninguém (o link anterior seria
 * substituído) e só gastaria o limite de tentativas.
 */
export function EsqueciSenhaPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function solicitar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.solicitarRedefinicaoDeSenha(email);
      setEnviado(true);
    } catch (falha) {
      setErro(
        falha instanceof ApiError && falha.status === 429
          ? MENSAGEM_MUITOS_PEDIDOS
          : "Não foi possível enviar a solicitação agora. Tente novamente em instantes."
      );
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="login">
        <div className="login-cartao">
          <h1>Verifique seu e-mail</h1>
          <div className="aviso aviso-info" role="status">{MENSAGEM_PEDIDO_NEUTRO}</div>
          <p className="subtitulo">
            O link tem validade curta e só pode ser usado uma vez. Se não chegar, confira a caixa de spam
            antes de pedir de novo.
          </p>
          <p className="login-rodape"><Link to="/login">Voltar para o login</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form onSubmit={solicitar}>
        <h1>Esqueci minha senha</h1>
        <p className="subtitulo">
          Informe o e-mail que você usa para entrar no PCTEC Ingressa. Enviaremos um link para você escolher
          uma nova senha.
        </p>
        {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" className="primario" disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar link de redefinição"}
        </button>
        <p className="login-rodape"><Link to="/login">Voltar para o login</Link></p>
      </form>
    </div>
  );
}
