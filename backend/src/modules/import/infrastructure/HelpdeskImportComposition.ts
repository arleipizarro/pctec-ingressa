import type { Pool } from "mysql2/promise";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbImportBatchRepository } from "./persistence/MariaDbImportBatchRepository.js";
import { MariaDbImportBatchItemRepository } from "./persistence/MariaDbImportBatchItemRepository.js";
import { MariaDbWizardTargetStateReader } from "./persistence/MariaDbWizardTargetStateReader.js";
import { MariaDbWizardApplyWriter } from "./persistence/MariaDbWizardApplyWriter.js";
import { MariaDbHelpdeskReadOnlySource } from "./source/MariaDbHelpdeskReadOnlySource.js";
import { loadHelpdeskSourceConfig } from "./source/HelpdeskSourceConfig.js";
import { StartImportBatchService } from "../application/StartImportBatchService.js";
import { RecordImportBatchItemService } from "../application/RecordImportBatchItemService.js";
import { FinishImportBatchService } from "../application/FinishImportBatchService.js";
import { RunHelpdeskImportWizardService } from "../application/RunHelpdeskImportWizardService.js";
import { GetHelpdeskCatalogService } from "../application/GetHelpdeskCatalogService.js";
import type { RunHelpdeskImportWizardDeps } from "../application/RunHelpdeskImportWizardService.js";

/** O contrato mínimo que o assistente precisa do vínculo automático. */
type PortalAutoLinkPort = NonNullable<RunHelpdeskImportWizardDeps["portalAutoLinkService"]>;

export interface HelpdeskImportComposition {
  readonly catalogService: GetHelpdeskCatalogService;
  readonly wizardService: RunHelpdeskImportWizardService;
  readonly sourcePool: Pool;
}

/**
 * Montagem do assistente sobre DOIS pools distintos.
 *
 * O pool da fonte é criado com as credenciais de
 * `/app/.config/pctec-ingressa/helpdesk-source.env` — um principal
 * read-only com SELECT de COLUNA em `users` do schema do Helpdesk e em
 * `clientes` do registro autoritativo, e nada mais. Ele nunca é
 * reaproveitado para escrever no Ingressa, e o pool do Ingressa nunca é
 * usado para ler a fonte: separar os dois é o que torna impossível uma
 * consulta escrever no lugar errado por engano de fiação.
 *
 * `createPool` não abre conexão — mysql2 conecta preguiçosamente, no
 * primeiro `execute`. Montar isto no boot não custa rede nem quebra
 * `npm test`/`typecheck`/`build`.
 */
export function composeHelpdeskImport(
  ingressaPool: Pool,
  /**
   * Vínculo automático com o Portal, executado DEPOIS do APPLY.
   *
   * Opcional e vindo de fora: a fonte do Portal tem configuração
   * própria, e o importador precisa funcionar sem ela. Recebê-lo pronto
   * — em vez de montá-lo aqui — garante que é o MESMO objeto da criação
   * manual e da reconciliação, com uma definição só de "corresponde".
   */
  portalAutoLinkService?: PortalAutoLinkPort | undefined
): HelpdeskImportComposition {
  const sourceConfig = loadHelpdeskSourceConfig();
  const sourcePool = createPool(sourceConfig);
  // Os DOIS nomes de schema vêm da configuração validada — nenhum é
  // constante no código. A conexão é a do Helpdesk (usuários) e o
  // cadastro de empresas mora em outro schema do mesmo servidor. Uma
  // conexão só para os dois: com dois pools não haveria como cruzá-los.
  const source = new MariaDbHelpdeskReadOnlySource(
    sourcePool,
    sourceConfig.registryDatabase,
    sourceConfig.database
  );
  const targetStateReader = new MariaDbWizardTargetStateReader(ingressaPool);
  const unitOfWork = new MariaDbUnitOfWork(ingressaPool);
  const itemRepository = new MariaDbImportBatchItemRepository(ingressaPool);

  const recordImportBatchItemService = new RecordImportBatchItemService(
    unitOfWork,
    (c) => new MariaDbImportBatchRepository(c),
    (c) => new MariaDbImportBatchItemRepository(c)
  );

  const wizardService = new RunHelpdeskImportWizardService({
    source,
    ...(portalAutoLinkService !== undefined ? { portalAutoLinkService } : {}),
    targetStateReader,
    startImportBatchService: new StartImportBatchService(
      unitOfWork,
      (c) => new MariaDbImportBatchRepository(c)
    ),
    recordImportBatchItemService,
    finishImportBatchService: new FinishImportBatchService(
      unitOfWork,
      (c) => new MariaDbImportBatchRepository(c)
    ),
    applyWriter: new MariaDbWizardApplyWriter(unitOfWork),
    batchActionCounter: (batchPublicId) => itemRepository.countByAction(batchPublicId),
    processedSourceKeysReader: (batchPublicId) => itemRepository.findProcessedSourceKeys(batchPublicId)
    // `linkKindResolver` deliberadamente ausente: a fonte atual só
    // produz vínculo de EMPRESA (`users.client_id`). O vínculo de grupo
    // existe no planner e é coberto por teste, mas não é legível daqui
    // — ver `HelpdeskCatalogPort`.
  });

  return {
    catalogService: new GetHelpdeskCatalogService(source, targetStateReader),
    wizardService,
    sourcePool
  };
}
