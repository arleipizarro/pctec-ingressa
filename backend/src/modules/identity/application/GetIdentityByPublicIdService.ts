import type { Identity } from "../domain/Identity.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { IdentityNotFoundError } from "../domain/errors/IdentityErrors.js";

/**
 * Caso de uso: consultar uma Identity existente pelo seu `publicId`.
 *
 * Operação de LEITURA — não exige `actor` (diferente de
 * `CreateIdentityService`, que sempre exige um `ActorPublicId` para
 * auditoria). Essa é uma decisão explícita desta fatia (v0.5.0 Slice 1):
 * consulta pública por identificador não é uma mutação, não produz
 * evento de domínio, não precisa de responsabilidade atribuída.
 *
 * Não importa Express nem qualquer detalhe HTTP — recebe e devolve tipos
 * de domínio/aplicação puros. A camada HTTP (`modules/identity/http/`) é
 * quem traduz `req.params.publicId` (string) para a chamada aqui, e o
 * resultado (`Identity`) para JSON público.
 */
export class GetIdentityByPublicIdService {
  public constructor(private readonly identityRepository: IdentityRepository) {}

  /**
   * @param rawPublicId Valor bruto vindo da URL — ainda não validado como UUID.
   * @throws {import("../domain/value-objects/PublicId.js").InvalidPublicIdError} `rawPublicId` não é um UUID sintaticamente válido (`IDENTITY_PUBLIC_ID_INVALID`).
   * @throws {IdentityNotFoundError} Nenhuma Identity existe com esse `publicId` (`IDENTITY_NOT_FOUND`).
   */
  public async execute(rawPublicId: string): Promise<Identity> {
    const publicId = PublicId.fromString(rawPublicId);
    const identity = await this.identityRepository.findByPublicId(publicId);
    if (identity === undefined) {
      throw new IdentityNotFoundError(rawPublicId);
    }
    return identity;
  }
}
