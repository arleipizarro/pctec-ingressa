import type { GetPortalContextService } from "./GetPortalContextService.js";
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
 * **G3 não monta nenhuma rota comercial usando este boundary** (task,
 * seção 22: "não inventar endpoint comercial falso") — implementado e
 * testado como peça reutilizável para quando rotas comerciais reais
 * existirem (G4+), não wireado em `createApp.ts` nesta entrega.
 */
export class RequireOrganizationAccessService {
  public constructor(private readonly getPortalContextService: GetPortalContextService) {}

  public async execute(identityPublicId: string, organizationPublicId: string): Promise<void> {
    const context = await this.getPortalContextService.execute(identityPublicId);
    const isAllowed = context.organizations.some((organization) => organization.publicId === organizationPublicId);
    if (!isAllowed) {
      throw new OrganizationAccessDeniedError();
    }
  }
}
