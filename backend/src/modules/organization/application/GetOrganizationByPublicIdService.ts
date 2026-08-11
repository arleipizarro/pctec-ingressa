import type { Organization } from "../domain/Organization.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { OrganizationNotFoundError } from "../domain/errors/OrganizationErrors.js";

/**
 * Caso de uso: consultar uma Organization existente pelo seu `publicId`.
 *
 * Operação de LEITURA — não exige `actor` (mesma decisão explícita já
 * adotada por `GetIdentityByPublicIdService`): consulta pública por
 * identificador não é uma mutação, não produz evento de domínio, não
 * precisa de responsabilidade atribuída.
 *
 * Não importa Express nem qualquer detalhe HTTP — recebe e devolve tipos
 * de domínio/aplicação puros.
 */
export class GetOrganizationByPublicIdService {
  public constructor(private readonly organizationRepository: OrganizationRepository) {}

  /**
   * @param rawPublicId Valor bruto — ainda não validado como UUID.
   * @throws {import("../domain/value-objects/PublicId.js").InvalidOrganizationPublicIdError} `rawPublicId` não é um UUID sintaticamente válido (`ORGANIZATION_PUBLIC_ID_INVALID`).
   * @throws {OrganizationNotFoundError} Nenhuma Organization existe com esse `publicId` (`ORGANIZATION_NOT_FOUND`).
   */
  public async execute(rawPublicId: string): Promise<Organization> {
    const publicId = PublicId.fromString(rawPublicId);
    const organization = await this.organizationRepository.findByPublicId(publicId);
    if (organization === undefined) {
      throw new OrganizationNotFoundError(rawPublicId);
    }
    return organization;
  }
}
