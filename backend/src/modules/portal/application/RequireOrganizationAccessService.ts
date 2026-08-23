import type { GetPortalContextService, PortalContextResult } from "./GetPortalContextService.js";
import { OrganizationAccessDeniedError } from "../domain/errors/PortalErrors.js";

/**
 * Boundary reutilizável (task G3, seção 14): dado um `AuthenticatedPrincipal`
 * (`identityPublicId`) já autenticado e já autorizado a usar
 * `PCTEC_PORTAL`, prova que um `organizationPublicId` solicitado
 * pertence ao `PortalContext` efetivo dessa Identity — nunca confia no
 * valor vindo do frontend sem revalidar (ORGANIZATION-MEMBERSHIP-DESIGN.md
 * §8, decisão já fechada na Fase G).
 *
 * Reaproveita `GetPortalContextService` em vez de duplicar a lógica de
 * expansão de escopo/deduplicação/defesa em profundidade — a mesma
 * fonte de verdade decide tanto "quais Organizations você vê" quanto
 * "você pode acessar esta Organization específica".
 *
 * Falha sempre com `OrganizationAccessDeniedError` (403,
 * `ORGANIZATION_ACCESS_DENIED`) — nunca 404, nunca uma mensagem
 * diferenciando "não existe" de "existe mas não é sua" (task G3, seção
 * 14).
 *
 * **Retorno (P1D, v0.7.x): o `PortalContextResult` que este service já
 * calculou para decidir.** Antes retornava `void`, e quem precisasse do
 * contexto logo depois teria de recalculá-lo — duas passagens pelo
 * mesmo `MembershipRepository`/`OrganizationRepository`, e, pior, duas
 * respostas potencialmente divergentes para a mesma pergunta. Devolver
 * o contexto elimina as duas coisas: o chamador que precisa saber
 * **quais** Organizations a Identity alcança (ex.: a rota
 * `tenant-scope`, que só pode consolidar as filhas autorizadas) usa
 * exatamente o mesmo resultado que autorizou a requisição.
 *
 * **Compatível com quem ignora o retorno**: `requireOrganizationAccess`
 * (middleware HTTP) e a rota de P1A.1 continuam com
 * `.then(() => ...)`, sem nenhuma alteração — um valor de retorno
 * adicional nunca quebra um chamador que não o lê.
 */
export class RequireOrganizationAccessService {
  public constructor(private readonly getPortalContextService: GetPortalContextService) {}

  /**
   * @returns O `PortalContext` efetivo da Identity — o MESMO usado para
   * autorizar. Nunca é um contexto recalculado depois da decisão.
   */
  public async execute(identityPublicId: string, organizationPublicId: string): Promise<PortalContextResult> {
    const context = await this.getPortalContextService.execute(identityPublicId);
    const isAllowed = context.organizations.some((organization) => organization.publicId === organizationPublicId);
    if (!isAllowed) {
      throw new OrganizationAccessDeniedError();
    }
    return context;
  }
}
