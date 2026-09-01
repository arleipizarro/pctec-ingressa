import { PCTEC_PORTAL_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";
import { SsoClientRegistry, type SsoClient } from "../domain/SsoClientRegistry.js";
import { SsoIssuancePolicyRegistry, type SsoIssuancePolicy } from "../domain/SsoIssuancePolicy.js";

export interface SsoCompositionInput {
  readonly portalRedirectUris: readonly string[];
  readonly portalLaunchUrl: string;
  /**
   * Exigências que o PRODUTO Portal declara para que uma sessão nele
   * faça sentido — hoje, contexto organizacional utilizável
   * (`RequirePortalOrganizationContextPolicy`).
   *
   * Obrigatório, e não opcional com default vazio: o default silencioso
   * seria exatamente o modo de o Portal perder o gate por esquecimento
   * numa refatoração futura. Quem registra o cliente declara o que ele
   * exige, mesmo que a resposta seja uma lista vazia.
   */
  readonly portalIssuancePolicies: readonly SsoIssuancePolicy[];
}

export interface SsoComposition {
  readonly registry: SsoClientRegistry;
  /**
   * Políticas de emissão por cliente. Construído em par com `registry`:
   * todo cliente registrado tem aqui uma entrada declarada, e nenhum
   * cliente não registrado aparece.
   */
  readonly issuancePolicyRegistry: SsoIssuancePolicyRegistry;
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
  const issuancePolicies: Record<string, readonly SsoIssuancePolicy[]> = {};

  if (input.portalRedirectUris.length > 0) {
    clients.push({
      clientId: PCTEC_PORTAL_APPLICATION_CODE,
      redirectUris: [...input.portalRedirectUris],
      launchUrl: input.portalLaunchUrl
    });
    // Declaração no MESMO bloco do registro do cliente, de propósito:
    // é impossível registrar o Portal e esquecer de declarar o que ele
    // exige sem que a omissão apareça aqui, lado a lado.
    issuancePolicies[PCTEC_PORTAL_APPLICATION_CODE] = input.portalIssuancePolicies;
  }

  return {
    registry: new SsoClientRegistry(clients),
    issuancePolicyRegistry: new SsoIssuancePolicyRegistry(issuancePolicies),
    requiredProfileByClientId: Object.freeze({ [PCTEC_PORTAL_APPLICATION_CODE]: "USER" })
  };
}
