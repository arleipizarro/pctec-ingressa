import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { SENHA_REDEFINIDA, type EstadoDoLogin } from "../auth.js";
import { capturarTokenDaRedefinicao, descartarTokenDaRedefinicao } from "../tokenDaRedefinicao.js";
import { MENSAGEM_MUITOS_PEDIDOS } from "./EsqueciSenhaPage.js";

/** Espelho de `MIN_PASSWORD_LENGTH` do backend — a regra real é a do servidor. */
const COMPRIMENTO_MINIMO = 12;

export const MENSAGEM_LINK_INDISPONIVEL =
  "Este link de redefinição é inválido, expirou ou já foi usado. Peça um novo link para continuar.";

const MENSAGEM_POLITICA =
  `A senha precisa ter pelo menos ${COMPRIMENTO_MINIMO} caracteres e não pode ser uma senha comum. ` +
  "Escolha outra e tente de novo.";

/**
 * Tela PÚBLICA de nova senha, aberta pelo link do e-mail.
 *
 * Fluxo: lê o token do fragmento → `POST /password-reset/preview`
 * (leitura pura, NÃO gasta o link) → pessoa escolhe a senha →
 * `POST /password-reset/confirm` → login, com aviso de sucesso.
 *
 * Expirado, já usado e inválido aparecem com a MESMA mensagem — o
 * servidor não diz qual foi, de propósito — e todos oferecem o mesmo
 * remédio: pedir um link novo.
 *
 * Nenhuma sessão nasce aqui; e as que existiam foram encerradas pela
 * troca. `aoConcluir` existe para a aba que estava logada largar a
 * sessão local — que o servidor acabou de revogar — junto com a ida ao
 * login.
 */
export function RedefinirSenhaPage({ aoConcluir }: { aoConcluir?: () => void }): JSX.Element {
  const navegar = useNavigate();
  // Inicializador de estado: roda antes de qualquer efeito, então o
  // fragmento sai da barra antes do primeiro request.
  const [token, setToken] = useState(capturarTokenDaRedefinicao);
  const [carregando, setCarregando] = useState(true);
  const [linkValido, setLinkValido] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function descartarToken(): void {
    descartarTokenDaRedefinicao();
    setToken("");
  }

  useEffect(() => {
    let cancelado = false;
    async function verificar(): Promise<void> {
      if (token.length === 0) {
        setCarregando(false);
        return;
      }
      try {
        await api.previewRedefinicaoDeSenha(token);
        if (!cancelado) {
          setLinkValido(true);
        }
      } catch (falha) {
        if (cancelado) {
          return;
        }
        if (falha instanceof ApiError && falha.status === 429) {
          // O link pode estar bom; quem barrou foi o limitador. Não
          // descarta o token — recarregar daqui a pouco deve funcionar.
          setErro(MENSAGEM_MUITOS_PEDIDOS);
        } else {
          descartarToken();
        }
      } finally {
        if (!cancelado) {
          setCarregando(false);
        }
      }
    }
    void verificar();
    return () => {
      cancelado = true;
    };
    // Carga única por montagem — mesmo motivo de `ConvitePage`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function redefinir(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro(null);
    // Validação local só para poupar uma ida ao servidor num engano
    // óbvio; a política que vale é a do backend.
    if (senha !== confirmacao) {
      setErro("A confirmação não confere com a nova senha.");
      return;
    }
    if (senha.length < COMPRIMENTO_MINIMO) {
      setErro(MENSAGEM_POLITICA);
      return;
    }
    setEnviando(true);
    try {
      await api.redefinirSenha(token, senha, confirmacao);
      descartarToken();
      setSenha("");
      setConfirmacao("");
      const estado: EstadoDoLogin = { motivo: SENHA_REDEFINIDA };
      navegar("/login", { replace: true, state: estado });
      // Na mesma passada da navegação (o React agrupa as duas
      // atualizações): a aba logada cai direto no login com o aviso, sem
      // passar pelo redirecionamento de `/login` para `/apps`.
      aoConcluir?.();
    } catch (falha) {
      const apiErro = falha instanceof ApiError ? falha : null;
      if (apiErro?.status === 422) {
        // Política de senha: o link CONTINUA válido.
        setErro(MENSAGEM_POLITICA);
      } else if (apiErro?.status === 429) {
        setErro(MENSAGEM_MUITOS_PEDIDOS);
      } else if (apiErro?.status === 401) {
        descartarToken();
        setLinkValido(false);
      } else {
        setErro("Não foi possível redefinir a senha agora. Tente novamente em instantes.");
      }
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return <div className="vazio" role="status">Verificando link…</div>;
  }

  if (!linkValido) {
    return (
      <div className="login">
        <div className="login-cartao">
          <h1>Link indisponível</h1>
          <div className="aviso aviso-erro" role="alert">{erro ?? MENSAGEM_LINK_INDISPONIVEL}</div>
          <Link to="/esqueci-senha" className="botao-link">Solicitar novo link</Link>
          <p className="login-rodape"><Link to="/login">Voltar para o login</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form onSubmit={redefinir}>
        <h1>Nova senha</h1>
        <p className="subtitulo">
          Escolha uma nova senha para o PCTEC Ingressa. Ao salvar, as sessões abertas com a senha antiga serão
          encerradas.
        </p>
        {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}
        <label htmlFor="senha">Nova senha</label>
        <input
          id="senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
        />
        <label htmlFor="confirmacao">Confirme a nova senha</label>
        <input
          id="confirmacao"
          type="password"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          required
        />
        <p className="subtitulo" style={{ marginTop: 0 }}>Mínimo de {COMPRIMENTO_MINIMO} caracteres.</p>
        <button type="submit" className="primario" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </div>
  );
}
