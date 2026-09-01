import type { ServiceCredentialConsumer } from "../../portal/http/requireServiceCredential.js";

/**
 * Consumidores autorizados do namespace genérico de resolução de
 * binding (`/api/v1/service/identity-external-references/...`).
 *
 * ## Por que uma LISTA, e não um segredo do namespace
 *
 * A rota é genérica de propósito: `systemCode` e `entityType` são
 * parâmetros, e nem ela nem o service sabem qual produto está
 * perguntando (D6/ADR-033). A CREDENCIAL, porém, não pode ser genérica.
 * Um único segredo para o namespace significaria que o primeiro
 * consumidor autorizado entrega a chave a todos os seguintes: vazar a de
 * um dá acesso ao que todos veem, revogar a de um derruba todos, e
 * nenhuma auditoria consegue dizer quem chamou. Portal e Helpdesk já têm
 * credencial e header próprios; esta fronteira segue o mesmo padrão, com
 * a diferença de que aqui pode haver mais de um consumidor ao mesmo
 * tempo — daí a lista.
 *
 * Acrescentar um consumidor é UMA entrada aqui mais uma variável de
 * ambiente. Nenhum banco de credenciais novo foi introduzido: a fonte do
 * segredo continua sendo o ambiente, como nos dois consumidores que já
 * existiam.
 *
 * ## Estado atual: nenhum consumidor configurado
 *
 * `PCTEC_MEU_RH` está declarado porque é o consumidor previsto, mas
 * `INGRESSA_MEU_RH_SERVICE_CREDENTIAL` **não** está configurada em
 * ambiente nenhum — e a Application `PCTEC_MEU_RH` sequer foi registrada
 * (D9). Enquanto for assim, o namespace inteiro responde 401: fundação
 * pronta e fechada, exatamente o estado que a revisão pediu. O segredo
 * será criado quando o Arquiteto autorizar o consumidor.
 */

/**
 * Header próprio do Meu RH. Nome derivado do consumidor, como
 * `x-portal-...` e `x-helpdesk-...` — nunca um header genérico do
 * namespace, que voltaria a acoplar os consumidores entre si.
 */
export const MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME = "x-meu-rh-service-credential";

/** Código do sistema consumidor, como ele aparece no catálogo de Applications. */
export const MEU_RH_CONSUMER_CODE = "PCTEC_MEU_RH";

/**
 * Monta a lista a partir dos segredos do ambiente. Consumidor com
 * segredo vazio não é aceito — quem filtra é
 * `createRequireOneOfServiceCredentials`, e o resultado é 401, nunca
 * "sem credencial configurada = aceita qualquer coisa".
 */
export function buildIdentityResolutionServiceConsumers(credentials: {
  readonly meuRh: string;
}): readonly ServiceCredentialConsumer[] {
  return [
    {
      consumerCode: MEU_RH_CONSUMER_CODE,
      headerName: MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME,
      credential: credentials.meuRh
    }
  ];
}
