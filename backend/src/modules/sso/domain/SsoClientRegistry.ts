import { SsoAuthorizationRequestInvalidError } from "./errors/SsoErrors.js";

export interface SsoClient {
  /** `client_id` do fluxo — igual ao `Application.code` do catálogo. */
  readonly clientId: string;
  /**
   * `redirect_uri`s permitidos, em forma ABSOLUTA e EXATA. Nunca
   * prefixos, nunca curingas, nunca padrões: a comparação na emissão e
   * na troca é igualdade de string.
   */
  readonly redirectUris: readonly string[];
  /**
   * URL que INICIA o fluxo, do lado do cliente (ex.:
   * `https://portal-dev.pctec.com.br/api/auth/ingressa/start`). É o que
   * o card do launcher aponta — o Ingressa nunca monta o
   * `code_challenge` do cliente por ele.
   */
  readonly launchUrl: string;
}

/**
 * Registro de clientes SSO — configuração, nunca dado de usuário e nunca
 * valor vindo do navegador.
 *
 * Existe para que `redirect_uri` seja sempre comparado contra uma lista
 * fechada e explícita. Um `redirect_uri` arbitrário é o vetor clássico
 * de open redirect neste fluxo: aceitar "qualquer URL sob o domínio X"
 * já é suficiente para exfiltrar código de autorização por uma rota
 * aberta do próprio cliente. Por isso a comparação é por igualdade
 * exata, e a lista é finita e configurada fora do código.
 */
export class SsoClientRegistry {
  private readonly clientsById: ReadonlyMap<string, SsoClient>;

  public constructor(clients: readonly SsoClient[]) {
    this.clientsById = new Map(clients.map((client) => [client.clientId, client]));
  }

  public list(): readonly SsoClient[] {
    return [...this.clientsById.values()];
  }

  public find(clientId: string): SsoClient | undefined {
    return this.clientsById.get(clientId);
  }

  /**
   * Resolve o cliente E valida o `redirect_uri` na MESMA operação —
   * deliberadamente não há um caminho de código que devolva o cliente
   * sem ter validado o redirect. Separar as duas coisas convidaria um
   * chamador futuro a usar só a primeira.
   */
  public requireClientWithRedirectUri(clientId: string, redirectUri: string): SsoClient {
    const client = this.clientsById.get(clientId);
    if (client === undefined) {
      throw new SsoAuthorizationRequestInvalidError("CLIENT_NOT_REGISTERED");
    }
    if (!client.redirectUris.includes(redirectUri)) {
      throw new SsoAuthorizationRequestInvalidError("REDIRECT_URI_NOT_REGISTERED");
    }
    return client;
  }
}
