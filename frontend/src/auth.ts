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

/**
 * Motivo passado ao `/login` quando o logout do servidor falhou.
 *
 * O cookie de sessão é HttpOnly: se o servidor não confirmou a
 * revogação, o SPA **não tem como** apagá-lo, e a sessão do servidor
 * pode seguir válida até expirar. A pessoa precisa saber disso — some da
 * tela como se tivesse saído seria a versão confortável e errada.
 */
export const LOGOUT_INCOMPLETO = "LOGOUT_INCOMPLETO" as const;

export interface EstadoDoLogin {
  readonly motivo?: typeof LOGOUT_INCOMPLETO;
}

/**
 * Encerra a sessão da UI e volta ao login — com ou sem sucesso no
 * servidor.
 *
 * **Por que existe, em vez de um `try/finally` em cada tela.** As duas
 * telas com botão "Sair" tinham o MESMO `try { await api.logout() }
 * finally { ... }`. `finally` executa a limpeza e **relança** — então
 * um logout que falha (500, rede caída) devolvia uma promise rejeitada
 * ao `onClick`, que ninguém trata: rejeição não capturada, ruído no
 * console do navegador e gate de teste vermelho. A limpeza rodava, o
 * que mascarava o problema: a tela parecia funcionar.
 *
 * Aqui a falha é CAPTURADA, a sessão local cai de qualquer forma e a
 * pessoa volta ao login — a intenção original, agora sem relançar. A
 * diferença é o `motivo`, que faz a tela de login dizer o que de fato
 * aconteceu.
 *
 * Nunca rejeita. É o contrato do qual as duas telas dependem.
 */
export async function encerrarSessao(
  encerrarLocal: () => void,
  irParaLogin: (estado?: EstadoDoLogin) => void
): Promise<void> {
  let falhouNoServidor = false;
  try {
    await api.logout();
  } catch {
    // O motivo exato não muda o que a UI faz: sair localmente e avisar.
    falhouNoServidor = true;
  }
  encerrarLocal();
  irParaLogin(falhouNoServidor ? { motivo: LOGOUT_INCOMPLETO } : undefined);
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
