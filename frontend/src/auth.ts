import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AplicativoCard } from "./api.js";

export interface Sessao {
  readonly identityPublicId: string;
  /** Nome de quem está logado, para o cabeçalho. Nunca vem do cliente. */
  readonly nomeExibido: string;
  /** Cards autorizados — a lista é do servidor, inteira. */
  readonly aplicativos: readonly AplicativoCard[];
  /** Derivado da lista acima, nunca de um estado local editável. */
  readonly ehAdministrador: boolean;
  readonly perfilNoIngressa: string | null;
}

/** Código da própria plataforma como Application do catálogo. */
export const CODIGO_INGRESSA = "PCTEC_INGRESSA";

/**
 * Rótulo neutro quando o servidor não devolveu nome.
 *
 * Nunca cair para o publicId: um UUID truncado no cabeçalho não responde
 * "sou eu nesta sessão?" e ainda expõe identificador interno em tela.
 */
export const NOME_NEUTRO = "Usuário";

/**
 * A sessão é do SERVIDOR. O frontend não guarda token e não decide
 * autorização: ele pergunta `/apps`, rota que responde 200 para qualquer
 * sessão válida e devolve exatamente os aplicativos que aquela
 * identidade tem `ApplicationAccess` GRANTED para usar.
 *
 * **Mudou de `/admin/whoami` para `/apps` de propósito.** `whoami` só
 * responde 200 para ADMIN em PCTEC_INGRESSA — com o launcher, todo
 * usuário federado do Helpdesk passa por aqui, e ele cairia no login
 * como se a senha estivesse errada. `/apps` é a rota do usuário; a
 * administração continua atrás dos seus próprios gates.
 *
 * `ehAdministrador` é DERIVADO da resposta do servidor, não um estado
 * que a tela possa ligar sozinha — e mesmo se alguém o forçasse no
 * navegador, toda chamada administrativa seguinte continua passando pelo
 * gate de `/api/v1/admin`.
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
      const painel = await api.apps();
      const nome = (painel.identity.fullName ?? "").trim();
      const ingressa = painel.applications.find((app) => app.code === CODIGO_INGRESSA);
      setSessao({
        identityPublicId: painel.identity.publicId,
        nomeExibido: nome.length > 0 ? nome : NOME_NEUTRO,
        aplicativos: painel.applications,
        ehAdministrador: ingressa?.profile === "ADMIN",
        perfilNoIngressa: ingressa?.profile ?? null
      });
    } catch (erro) {
      // 401/403 significam "não autenticado" — nunca é caso de tela de
      // erro: é caso de mandar para o login.
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
