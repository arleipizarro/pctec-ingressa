import type { Membership } from "../domain/Membership.js";
import type { MembershipRepository } from "../domain/MembershipRepository.js";
import { PublicId } from "../../identity/domain/value-objects/PublicId.js";

/**
 * Caso de uso: listar todos os Memberships de uma Identity.
 *
 * Operação de LEITURA — não exige `actor` (mesmo princípio já adotado
 * por `GetIdentityByPublicIdService`/`GetOrganizationByPublicIdService`):
 * consulta não é uma mutação, não produz evento de domínio.
 *
 * **Não filtra por status nesta fatia** — retorna todos os Memberships
 * (ACTIVE e INACTIVE) da Identity, na ordem em que foram criados. G2 não
 * tem nenhum Membership INACTIVE possível de existir ainda (sem comando
 * de revogação implementado), mas o método já está preparado para
 * quando esse comando existir; filtrar por status fica a critério do
 * chamador (ex.: PortalContext, G3), não deste service.
 *
 * Não importa Express nem qualquer detalhe HTTP.
 */
export class GetMembershipsByIdentityService {
  public constructor(private readonly membershipRepository: MembershipRepository) {}

  /**
   * @param rawIdentityPublicId Valor bruto — ainda não validado como UUID.
   * @throws {import("../../identity/domain/value-objects/PublicId.js").InvalidPublicIdError} `rawIdentityPublicId` não é um UUID sintaticamente válido.
   */
  public async execute(rawIdentityPublicId: string): Promise<Membership[]> {
    const identityPublicId = PublicId.fromString(rawIdentityPublicId);
    return this.membershipRepository.findAllByIdentityPublicId(identityPublicId.toString());
  }
}
