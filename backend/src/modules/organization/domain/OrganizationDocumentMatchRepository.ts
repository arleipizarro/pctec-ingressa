import type { Organization } from "./Organization.js";
import type { DocumentNumber } from "./value-objects/DocumentNumber.js";
import type { OrganizationType } from "./value-objects/OrganizationType.js";

/**
 * Contrato de leitura **específico do processo de bootstrap/matching**
 * (`BootstrapOrganizationsService`, G2) — deliberadamente separado de
 * `OrganizationRepository`.
 *
 * **Por que não faz parte do `OrganizationRepository` canônico:**
 * `Organization.publicId` é o único identificador cross-system oficial
 * (ADR-031). `documentNumber` (CNPJ) é, por decisão explícita do design,
 * **evidência de correlação durante a migração — nunca um identificador
 * cross-system** (ADR-031 §9.1-bis). Um método de busca por
 * `documentNumber` que retorna múltiplas Organizations candidatas
 * (`findAllByDocumentNumberAndType`) é uma capacidade útil SOMENTE para
 * o processo de correlação em lote do bootstrap — nenhum dos services
 * canônicos do domínio (`CreateOrganizationService`,
 * `GetOrganizationByPublicIdService`,
 * `CreateOrganizationRelationshipService`, `CreateMembershipService`)
 * precisa dele, e nenhum deveria: se `OrganizationRepository` expusesse
 * essa busca amplamente, isso sinalizaria (incorretamente) que CNPJ é
 * um caminho de consulta legítimo do domínio, elevando-o de "evidência
 * de migração" para "chave de busca geral" — exatamente o que ADR-031
 * quer evitar. Manter esta capacidade isolada em seu próprio contrato,
 * usado apenas pelo bootstrap, torna essa fronteira explícita no código,
 * não só em comentário.
 *
 * Implementação MariaDB reaproveita a mesma tabela `organizations` —
 * não é um domínio de dados diferente, só um contrato de acesso
 * separado, com propósito e escopo de uso restritos.
 */
export interface OrganizationDocumentMatchRepository {
  /**
   * Retorna TODAS as Organizations candidatas para um
   * `documentNumber`+`type` (0, 1 ou mais) — nunca decide sozinho qual é
   * a correta; é o chamador (`BootstrapOrganizationsService`) quem
   * classifica MATCHED (1 candidata)/AMBIGUOUS (2+ candidatas)/UNMATCHED
   * (0 candidatas).
   */
  findAllByDocumentNumberAndType(documentNumber: DocumentNumber, type: OrganizationType): Promise<Organization[]>;
}
