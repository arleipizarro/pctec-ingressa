import type { ServiceCredentialConsumer } from "../../portal/http/requireServiceCredential.js";
import {
  SERVICE_CREDENTIAL_HEADER_NAME
} from "../../portal/http/requireServiceCredential.js";
import {
  MEU_RH_CONSUMER_CODE,
  MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME
} from "../../identity/http/identityResolutionServiceConsumers.js";
import {
  PCTEC_MEU_RH_APPLICATION_CODE,
  PCTEC_PORTAL_APPLICATION_CODE
} from "../../application/domain/value-objects/ApplicationCodes.js";

/**
 * Consumidores autorizados a TROCAR um código de autorização por
 * identidade (`POST /api/v1/service/sso/token`).
 *
 * ## Por que deixou de ser a credencial do Portal
 *
 * Enquanto o Portal era o único cliente de SSO, esta fronteira reusava a
 * credencial e o header dele — decisão correta na época, e registrada
 * como tal: um canal novo significaria um segredo novo para distribuir,
 * rotacionar e vazar.
 *
 * Com um SEGUNDO cliente o raciocínio se inverte. Reusar a credencial do
 * Portal obrigaria a entregá-la ao Meu RH, e aí: vazar a de um dá acesso
 * ao que os dois veem, revogar a de um derruba os dois, e a auditoria
 * nunca diz quem chamou. É exatamente o problema que
 * `identityResolutionServiceConsumers` já resolve com uma LISTA, e a
 * solução aqui é a mesma — cada consumidor com header e segredo
 * próprios.
 *
 * O Portal continua usando EXATAMENTE o header e o segredo de sempre.
 * Nada muda do lado dele.
 *
 * ## Consumidor ≠ dono do código
 *
 * Autenticar não basta: o `client_id` da troca precisa pertencer a quem
 * se autenticou. Sem esse vínculo, a credencial do Portal abriria um
 * código emitido para o Meu RH — e os headers próprios teriam criado
 * isolamento no papel e não na prática.
 */
export const APPLICATION_CODE_POR_CONSUMIDOR: Readonly<Record<string, string>> = Object.freeze({
  [PCTEC_PORTAL_APPLICATION_CODE]: PCTEC_PORTAL_APPLICATION_CODE,
  [MEU_RH_CONSUMER_CODE]: PCTEC_MEU_RH_APPLICATION_CODE
});

export function buildSsoTokenServiceConsumers(credentials: {
  readonly portal: string;
  readonly meuRh: string;
}): readonly ServiceCredentialConsumer[] {
  return [
    {
      consumerCode: PCTEC_PORTAL_APPLICATION_CODE,
      headerName: SERVICE_CREDENTIAL_HEADER_NAME,
      credential: credentials.portal
    },
    {
      consumerCode: MEU_RH_CONSUMER_CODE,
      headerName: MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME,
      credential: credentials.meuRh
    }
  ];
}
