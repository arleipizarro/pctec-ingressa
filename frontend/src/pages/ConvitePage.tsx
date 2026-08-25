import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api.js";

/**
 * Lê o token do FRAGMENTO da URL (`/convite#<token>`).
 *
 * O fragmento nunca é enviado ao servidor: não entra em access log de
 * Nginx, não vai no cabeçalho `Referer` de nenhum recurso da página e
 * não aparece em log de proxy. Um token em query string apareceria nos
 * três — por isso o link do convite usa `#`, e por isso esta função
 * existe em vez de um `useParams`.
 */
function lerTokenDoFragmento(): string {
  const bruto = window.location.hash;
  return bruto.startsWith("#") ? decodeURIComponent(bruto.slice(1)) : "";
}

/**
 * Tela pública de definição de senha por convite.
 *
 * Fluxo: lê o token do fragmento → `POST /invitations/preview` (leitura
 * pura, NÃO gasta o convite) → pessoa escolhe a senha →
 * `POST /invitations/redeem`.
 *
 * O `preview` não consumir é o que permite recarregar a página sem
 * perder o acesso. O consumo acontece só quando a senha é definida — e é
 * atômico no servidor.
 *
 * Nenhuma sessão nasce aqui: definir a senha e entrar são dois atos, e o
 * segundo passa pelo login normal. Um link de convite que autenticasse
 * continuaria sendo uma credencial depois de usado.
 */
export function ConvitePage(): JSX.Element {
  const [token] = useState(lerTokenDoFragmento);
  const [nome, setNome] = useState<string | null>(null);
  const [validade, setValidade] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function carregar(): Promise<void> {
      if (token.length === 0) {
        setErro("Link de convite incompleto. Peça um novo convite ao administrador.");
        setCarregando(false);
        return;
      }
      try {
        const previa = await api.previewConvite(token);
        if (cancelado) {
          return;
        }
        setNome(previa.fullName);
        setValidade(new Date(previa.expiresAt).toLocaleString("pt-BR"));
      } catch (falha) {
        if (!cancelado) {
          setErro(
            falha instanceof ApiError
              ? "Convite inválido, expirado ou já utilizado. Peça um novo ao administrador."
              : "Não foi possível verificar o convite."
          );
        }
      } finally {
        if (!cancelado) {
          setCarregando(false);
        }
      }
    }
    void carregar();
    return () => {
      cancelado = true;
    };
  }, [token]);

  async function definir(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.definirSenhaPorConvite(token, senha, confirmacao);
      // Limpa o fragmento assim que o convite é consumido: manter o
      // token na barra de endereço depois de usado só cria chance de ele
      // ser copiado por engano.
      window.history.replaceState(null, "", "/convite");
      setConcluido(true);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível definir a senha.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return <div className="vazio" role="status">Verificando convite…</div>;
  }

  if (concluido) {
    return (
      <div className="login">
        <div>
          <h1>Senha definida</h1>
          <p className="subtitulo">Agora você já pode entrar no PCTEC Ingressa com o seu e-mail e a senha que acabou de criar.</p>
          <Link to="/login" className="botao-link">Ir para o login</Link>
        </div>
      </div>
    );
  }

  if (nome === null) {
    return (
      <div className="login">
        <div>
          <h1>Convite indisponível</h1>
          <div className="aviso aviso-erro" role="alert">{erro ?? "Convite inválido."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form onSubmit={definir}>
        <h1>Bem-vindo, {nome}</h1>
        <p className="subtitulo" style={{ margin: 0 }}>
          Defina sua senha de acesso ao PCTEC Ingressa. Este convite vale até {validade}.
        </p>
        {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}
        <label htmlFor="senha">Nova senha</label>
        <input
          id="senha"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
        />
        <label htmlFor="confirmacao">Confirme a senha</label>
        <input
          id="confirmacao"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          required
        />
        <p className="subtitulo" style={{ marginTop: 0 }}>Mínimo de 12 caracteres.</p>
        <button type="submit" className="primario" disabled={enviando}>
          {enviando ? "Definindo…" : "Definir senha"}
        </button>
      </form>
    </div>
  );
}
