import type { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";

/**
 * Caso de uso: consultar uma OrganizationExternalReference existente
 * pelo seu `publicId`.
 *
 * Operação de LEITURA — não exige `actor`, não produz evento de domínio,
 * mesmo princípio de todos os demais `Get*ByPublicIdService` deste
 * repositório.
 */
export class GetOrganizationExternalReferenceService {
  public constructor(private readonly repository: OrganizationExternalReferenceRepository) {}

  /**
   * @param rawPublicId Valor bruto — ainda não validado como UUID.
   * @returns `undefined` quando não encontrado — este service não lança
   * `NotFoundError`, ao contrário de `GetOrganizationByPublicIdService`;
   * é usado tipicamente por processos de correlação/matching que
   * precisam apenas checar existência, não tratar ausência como erro.
   */
  public async execute(rawPublicId: string): Promise<OrganizationExternalReference | undefined> {
    const publicId = PublicId.fromString(rawPublicId);
    return this.repository.findByPublicId(publicId);
  }
}
