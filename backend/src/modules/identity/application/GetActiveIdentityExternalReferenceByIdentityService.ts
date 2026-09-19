import type { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import {
  IdentityExternalReferenceBindingAmbiguousError,
  IdentityExternalReferenceBindingNotFoundError
} from "../domain/errors/IdentityExternalReferenceErrors.js";

/**
 * Caso de uso: dada uma Identity, descobrir QUAL registro ela representa
 * num sistema de origem — direção `Identity → (systemCode, entityType)`.
 *
 * **A direção que faltava.** O Ingressa já sabia responder
 * "qual Identity corresponde a este id legado?"
 * (`GetActiveIdentityExternalReferenceService`, usada pelo Portal e pelo
 * Helpdesk, que partem do id do próprio sistema). Um produto que parte da
 * SESSÃO — já sabe quem é a pessoa e precisa do id dela no sistema de
 * origem para buscar os dados de lá — faz a pergunta inversa, e não
 * havia como responder.
 *
 * **Genérico por decisão.** Recebe `systemCode` e `entityType` como
 * parâmetros; não existe aqui nenhum conhecimento sobre qual produto
 * consome a resposta, nem sobre o que `rh_colaboradores` significa. O
 * Ingressa é a fonte da identidade e do binding — o significado do
 * registro do outro lado pertence ao sistema de origem.
 *
 * **Só `ACTIVE`.** Referências `SUPERSEDED` são histórico e NUNCA são
 * devolvidas: uma referência superada é precisamente um binding que
 * deixou de valer, e devolvê-la seria apontar a pessoa para o registro
 * errado.
 *
 * **Recusa ambiguidade em vez de escolher.** Se o repositório souber
 * contar (`countActive...`) e houver mais de uma referência ACTIVE, o
 * resultado é `IDENTITY_EXTERNAL_REFERENCE_AMBIGUOUS` (409), nunca uma
 * das candidatas. A UNIQUE KEY da migration 0024 torna esse estado
 * impossível de criar; a checagem cobre o banco restaurado pela metade,
 * a escrita manual e o ambiente em que a migration ainda não correu.
 * Num binding que decide de quem é o holerite, "provavelmente esta" não
 * é uma resposta aceitável.
 *
 * **Não faz autorização.** Quando este service executa, a fronteira HTTP
 * já provou que quem chama é um serviço autorizado
 * (`requireServiceCredential`) — mesmo boundary estrito já praticado
 * pelo análogo da outra direção.
 */
export class GetActiveIdentityExternalReferenceByIdentityService {
  public constructor(private readonly repository: IdentityExternalReferenceRepository) {}

  /**
   * @param rawIdentityPublicId `Identity.publicId` — validado pelo VO,
   *   nunca por regex solta na rota.
   * @param rawSystemCode Ex.: `"PCTEC_HUB"`.
   * @param rawEntityType Ex.: `"rh_colaboradores"`.
   */
  public async execute(
    rawIdentityPublicId: string,
    rawSystemCode: string,
    rawEntityType: string
  ): Promise<IdentityExternalReference> {
    const identityPublicId = PublicId.fromString(rawIdentityPublicId).toString();
    const systemCode = SystemCode.create(rawSystemCode);
    const entityType = EntityType.create(rawEntityType);

    const contar = this.repository.countActiveByIdentityAndSystemCodeAndEntityType;
    if (contar !== undefined) {
      const total = await contar.call(this.repository, identityPublicId, systemCode, entityType);
      if (total > 1) {
        throw new IdentityExternalReferenceBindingAmbiguousError(
          identityPublicId,
          systemCode.toString(),
          entityType.toString()
        );
      }
    }

    const reference = await this.repository.findActiveByIdentityAndSystemCodeAndEntityType(
      identityPublicId,
      systemCode,
      entityType
    );
    if (reference === undefined) {
      throw new IdentityExternalReferenceBindingNotFoundError(
        identityPublicId,
        systemCode.toString(),
        entityType.toString()
      );
    }
    return reference;
  }
}
