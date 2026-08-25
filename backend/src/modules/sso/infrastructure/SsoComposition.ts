import { PCTEC_PORTAL_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";
import { SsoClientRegistry, type SsoClient } from "../domain/SsoClientRegistry.js";

export interface SsoCompositionInput {
  readonly portalRedirectUris: readonly string[];
  readonly portalLaunchUrl: string;
}

export interface SsoComposition {
  readonly registry: SsoClientRegistry;
  /**
   * Perfil de `ApplicationAccess` exigido por cliente. Fixo no código, e
   * não configurável: qual perfil basta para entrar num produto é regra
   * de autorização, não parâmetro de ambiente.
   */
  readonly requiredProfileByClientId: Readonly<Record<string, string>>;
}

/**
 * Monta o registro de clientes SSO a partir da configuração.
 *
 * **Um cliente sem `redirect_uri` configurado simplesmente NÃO é
 * registrado.** Consequência direta: `requireClientWithRedirectUri`
 * recusa qualquer tentativa para ele, e a rota `/sso/authorize`
 * responde 400 sem redirecionar. É o fail-closed correto — a alternativa
 * (registrar com lista vazia) daria o mesmo resultado por acidente, e a
 * ausência explícita diz a verdade sobre o ambiente.
 *
 * Não derruba o boot: o Ingressa continua servindo login, `/apps`,
 * administração e as rotas de serviço mesmo sem SSO configurado — do
 * mesmo modo que a ausência da credencial do Helpdesk só desliga as
 * rotas do Helpdesk.
 */
export function composeSso(input: SsoCompositionInput): SsoComposition {
  const clients: SsoClient[] = [];

  if (input.portalRedirectUris.length > 0) {
    clients.push({
      clientId: PCTEC_PORTAL_APPLICATION_CODE,
      redirectUris: [...input.portalRedirectUris],
      launchUrl: input.portalLaunchUrl
    });
  }

  return {
    registry: new SsoClientRegistry(clients),
    requiredProfileByClientId: Object.freeze({ [PCTEC_PORTAL_APPLICATION_CODE]: "USER" })
  };
}
