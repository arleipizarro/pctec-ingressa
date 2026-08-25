import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api.js";

export interface Sessao {
  readonly identityPublicId: string;
  readonly accessProfile: string;
  /** Nome de quem está logado, para o cabeçalho. Nunca vem do cliente. */
  readonly nomeExibido: string;
}

/**
 * Rótulo neutro quando o servidor não devolveu nome.
 *
 * Nunca cair para o publicId: um UUID truncado no cabeçalho não responde
 * "sou eu nesta sessão?" e ainda expõe identificador interno em tela.
 */
export const NOME_NEUTRO = "Administrador";

/**
 * A sessão é do SERVIDOR. O frontend não guarda token e não decide
 * autorização: ele pergunta `/admin/whoami` — rota que só responde 200
 * para Identity ACTIVE com ApplicationAccess ADMIN em PCTEC_INGRESSA.
 *
 * Consequência deliberada: qualquer bypass no cliente (editar estado,
 * forjar rota) não abre nada, porque toda chamada seguinte continua
 * passando pelo mesmo gate no backend.
 */
export function useSessao(): {
  sessao: Sessao | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
  encerrar: () => void;
} {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await api.whoami();
      const nome = (resposta.identity.fullName ?? "").trim();
      setSessao({
        identityPublicId: resposta.identity.publicId,
        accessProfile: resposta.access.profile,
        nomeExibido: nome.length > 0 ? nome : NOME_NEUTRO
      });
    } catch (erro) {
      // 401/403 significam "não autenticado como admin" — nunca é caso
      // de tela de erro: é caso de mandar para o login.
      if (!(erro instanceof ApiError)) {
        throw erro;
      }
      setSessao(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { sessao, carregando, recarregar, encerrar: () => setSessao(null) };
}
