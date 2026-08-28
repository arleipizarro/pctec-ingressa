import type { Pool } from "mysql2/promise";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { createPool } from "../../../shared/database/Pool.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import { MariaDbOrganizationRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import type { LinkPortalOrganizationReferenceService } from "../../organization/application/LinkPortalOrganizationReferenceService.js";
import { MariaDbPortalReadOnlySource } from "./source/MariaDbPortalReadOnlySource.js";
import { loadPortalSourceConfig } from "./source/PortalSourceConfig.js";
import { MariaDbPortalReconciliationReadRepository } from "./persistence/MariaDbPortalReconciliationReadRepository.js";
import { MatchPortalClientByDocumentService } from "../application/MatchPortalClientByDocumentService.js";
import { SearchPortalClientCatalogService } from "../application/SearchPortalClientCatalogService.js";
import { GetPortalOrganizationMatchService } from "../application/GetPortalOrganizationMatchService.js";
import { AutoLinkPortalOrganizationReferenceService } from "../application/AutoLinkPortalOrganizationReferenceService.js";
import { ReconcilePortalOrganizationReferencesService } from "../application/ReconcilePortalOrganizationReferencesService.js";
import { ConfirmPortalClientSelectionService } from "../application/ConfirmPortalClientSelectionService.js";

export interface PortalCatalogComposition {
  readonly catalogService: SearchPortalClientCatalogService;
  readonly matchService: GetPortalOrganizationMatchService;
  readonly autoLinkService: AutoLinkPortalOrganizationReferenceService;
  readonly reconciliationService: ReconcilePortalOrganizationReferencesService;
  readonly confirmSelectionService: ConfirmPortalClientSelectionService;
  readonly sourcePool: Pool;
}

/**
 * Montagem do catálogo do Portal sobre DOIS pools distintos.
 *
 * O pool da fonte nasce das credenciais de
 * `/app/.config/pctec-ingressa/portal-source.env` — somente leitura
 * sobre `pctecdb.clientes`. Ele nunca é usado para escrever no
 * Ingressa, e o pool do Ingressa nunca é usado para ler o Portal.
 * Separar os dois é o que torna impossível uma consulta escrever no
 * lugar errado por engano de fiação — e é também o que garante que o
 * vínculo, que é uma escrita no Ingressa, jamais vire uma dependência
 * de escrita cross-database.
 *
 * `createPool` não abre conexão — mysql2 conecta preguiçosamente, no
 * primeiro `execute`. Montar isto no boot não custa rede e não quebra
 * `npm test`, `typecheck` nem `build`.
 *
 * O `LinkPortalOrganizationReferenceService` vem de FORA, pronto: ele é
 * o mesmo objeto que a rota de vínculo manual usa. Construí-lo aqui
 * daria duas montagens da mesma escrita, e a segunda divergiria da
 * primeira no primeiro ajuste feito de um lado só.
 */
export function composePortalCatalog(
  ingressaPool: Pool,
  linkService: LinkPortalOrganizationReferenceService
): PortalCatalogComposition {
  const sourcePool = createPool(loadPortalSourceConfig());
  const source = new MariaDbPortalReadOnlySource(sourcePool);

  const matchByDocument = new MatchPortalClientByDocumentService(source);
  const organizationRepositoryFactory = (c: Queryable): OrganizationRepository =>
    new MariaDbOrganizationRepository(c);

  const autoLinkService = new AutoLinkPortalOrganizationReferenceService(
    organizationRepositoryFactory,
    ingressaPool,
    matchByDocument,
    linkService
  );

  return {
    catalogService: new SearchPortalClientCatalogService(source),
    matchService: new GetPortalOrganizationMatchService(
      organizationRepositoryFactory,
      ingressaPool,
      matchByDocument
    ),
    autoLinkService,
    reconciliationService: new ReconcilePortalOrganizationReferencesService(
      new MariaDbPortalReconciliationReadRepository(ingressaPool),
      matchByDocument,
      autoLinkService
    ),
    // Sobre a MESMA fonte e o MESMO serviço de vínculo: a releitura de
    // confirmação e a busca precisam enxergar o mesmo Portal, e a
    // escrita precisa ser a mesma do vínculo manual.
    confirmSelectionService: new ConfirmPortalClientSelectionService(source, linkService),
    sourcePool
  };
}
