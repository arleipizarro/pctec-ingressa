/**
 * Candidata à reconciliação: uma COMPANY ACTIVE do Ingressa, com o
 * documento que ela tem hoje e quantas referências ACTIVE de
 * `PCTEC_PORTAL`/`clientes` já possui.
 *
 * `documentNumber` circula em memória porque é o insumo da
 * correspondência — e **não sai na resposta HTTP**: o que sai é
 * `publicId`, nomes e a máscara. Essa fronteira é do serviço de
 * reconciliação, não deste contrato.
 *
 * `activePortalReferences` responde "já está vinculada?" numa consulta
 * só, junto da listagem. Perguntar por organização, uma a uma, seria
 * N+1 numa tela que existe justamente para olhar a base inteira.
 */
export interface PortalReconciliationCandidate {
  readonly organizationPublicId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly documentNumber: string | null;
  readonly activePortalReferences: number;
}

export interface PortalReconciliationCandidatePage {
  readonly items: readonly PortalReconciliationCandidate[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface PortalReconciliationReader {
  /** COMPANY ACTIVE, paginadas. Grupos nunca entram: não recebem vínculo. */
  listCandidates(query: { readonly limit: number; readonly offset: number }): Promise<PortalReconciliationCandidatePage>;

  /** As candidatas de uma lista explícita de `publicId` — o caminho da execução. */
  findCandidates(organizationPublicIds: readonly string[]): Promise<readonly PortalReconciliationCandidate[]>;
}
