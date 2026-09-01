import type { SsoIssuanceContext, SsoIssuancePolicy } from "../../sso/domain/SsoIssuancePolicy.js";
import { SsoAuthorizationDeniedError } from "../../sso/domain/errors/SsoErrors.js";
import type { GetPortalContextService } from "./GetPortalContextService.js";

/**
 * Exigência do **Portal**, declarada pelo Portal: uma sessão sem nenhuma
 * Organization utilizável não é uma sessão útil — é uma tela vazia com
 * um cookie válido. Recusar na emissão devolve a pessoa ao launcher com
 * uma negativa clara, em vez de empurrá-la para um produto onde nada
 * abre.
 *
 * **Esta regra já existia — o que mudou foi o lugar.** Antes vivia
 * dentro de `IssueAuthorizationCodeService`, e portanto valia para
 * qualquer cliente SSO presente ou futuro. Aqui ela é uma política do
 * cliente `PCTEC_PORTAL`, e o comportamento efetivo do Portal é o mesmo
 * de antes, na mesma etapa do fluxo, com o mesmo motivo interno
 * (`NO_USABLE_MEMBERSHIP`) e a mesma resposta externa genérica.
 *
 * Fica no módulo `portal` de propósito: `GetPortalContextService`,
 * `Membership` e a expansão de grupo são desse bounded context. O módulo
 * `sso` continua sem conhecer nenhum dos três — ele só conhece o port
 * `SsoIssuancePolicy`, que esta classe implementa.
 *
 * Não reimplementa nada: delega ao MESMO `GetPortalContextService` que
 * serve `GET /api/v1/portal/context` e a fronteira service-to-service.
 * Se um dia a definição de "Organization utilizável" mudar, muda em um
 * lugar só.
 */
export class RequirePortalOrganizationContextPolicy implements SsoIssuancePolicy {
  public readonly name = "portal.require-organization-context";

  public constructor(private readonly getPortalContextService: GetPortalContextService) {}

  public async evaluate(context: SsoIssuanceContext): Promise<void> {
    const portalContext = await this.getPortalContextService.execute(context.identityPublicId);
    if (portalContext.organizations.length === 0) {
      // Mesmo motivo interno de antes — o catálogo de negativas do SSO
      // não muda por causa da mudança de lugar da regra.
      throw new SsoAuthorizationDeniedError("NO_USABLE_MEMBERSHIP");
    }
  }
}
