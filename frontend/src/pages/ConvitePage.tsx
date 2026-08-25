import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { capturarTokenDoConvite, descartarTokenDoConvite } from "../tokenDoConvite.js";

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
  // Inicializador de estado: roda na PRIMEIRA renderização, antes de
  // qualquer efeito. Quando o formulário aparece na tela, o fragmento já
  // saiu da barra de endereço — e nenhuma chamada de API aconteceu ainda,
  // porque o `preview` mora num `useEffect`, que roda depois.
  const [token, setToken] = useState(capturarTokenDoConvite);
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
          // Erro TERMINAL: o servidor disse que este token não vale mais.
          // Guardá-lo seria manter uma credencial sem propósito.
          descartarToken();
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
    // Dependência VAZIA de propósito: esta é uma carga única por
    // montagem. Depender de `token` faria o efeito rodar de novo no
    // instante em que o descartamos — e a tela trocaria "convite
    // inválido" (a verdade) por "link incompleto" (que descreve outro
    // problema). O valor lido aqui é o capturado na inicialização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Apaga o token dos DOIS lugares em que ele existe: a memória do
   * módulo (que sobrevive a remontagens da tela) e o estado deste
   * componente. Sem os dois, o valor continuaria acessível a qualquer
   * código que rodasse na aba depois.
   */
  function descartarToken(): void {
    descartarTokenDoConvite();
    setToken("");
  }

  async function definir(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.definirSenhaPorConvite(token, senha, confirmacao);
      // Consumido com sucesso: o token não abre mais nada, e manter uma
      // credencial gasta em memória não serve a ninguém.
      descartarToken();
      // A senha digitada também sai da memória junto — ela já virou hash
      // no servidor, e o campo não será mostrado de novo.
      setSenha("");
      setConfirmacao("");
      setConcluido(true);
    } catch (falha) {
      const apiErro = falha instanceof ApiError ? falha : null;
      setErro(apiErro !== null ? apiErro.message : "Não foi possível definir a senha.");
      // 422 é a política de senha: o convite CONTINUA válido e a pessoa
      // vai corrigir e tentar de novo — apagar o token aqui transformaria
      // um erro de digitação em "peça um convite novo". Qualquer outro
      // status significa que o convite em si não vale mais.
      if (apiErro !== null && apiErro.status !== 422) {
        descartarToken();
      }
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
