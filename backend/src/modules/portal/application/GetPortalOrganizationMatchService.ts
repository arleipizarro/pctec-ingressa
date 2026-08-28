import type { Queryable } from "../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import { PublicId } from "../../organization/domain/value-objects/PublicId.js";
import { PortalReferenceOrganizationNotFoundError } from "../../organization/domain/errors/PortalOrganizationReferenceErrors.js";
import type { MatchPortalClientByDocumentService } from "./MatchPortalClientByDocumentService.js";
import type { PortalClientMatchStatus } from "../domain/PortalClientMatch.js";
import { maskCnpj } from "../domain/value-objects/PortalDocument.js";

export interface PortalOrganizationMatchView {
  readonly organizationPublicId: string;
  readonly status: PortalClientMatchStatus | "NOT_A_COMPANY";
  /** Presença de CNPJ comparável na Organization — nunca o valor. */
  readonly hasDocument: boolean;
  readonly candidateCount: number;
  /** Só em `EXACT_UNIQUE`. É o que o botão de confirmar enviaria. */
  readonly suggestion: {
    readonly legacyId: number;
    readonly name: string;
    readonly tradeName: string | null;
    readonly documentMasked: string | null;
    readonly active: boolean;
  } | null;
}

/**
 * A sugestão que a tela mostra ANTES de o ADMIN confirmar.
 *
 * Leitura pura: consulta o CNPJ da organização, pergunta ao catálogo do
 * Portal e devolve o resultado. **Não escreve nada** — nem quando o
 * resultado é `EXACT_UNIQUE`.
 *
 * Que a sugestão automática exija um clique é a decisão, não uma etapa
 * a ser otimizada depois: o vínculo do Portal não tem desfazer nesta
 * tela, e uma correspondência exata por CNPJ ainda depende de os dois
 * cadastros estarem corretos. O servidor propõe; quem decide assina.
 *
 * Fica numa rota separada da leitura da organização de propósito. O
 * catálogo do Portal é um banco de fora e pode estar indisponível; se
 * esta consulta morasse dentro de `GET /admin/organizations/:publicId`,
 * uma queda do Portal derrubaria a tela inteira de detalhes da
 * organização, que não depende dele para nada.
 */
export class GetPortalOrganizationMatchService {
  public constructor(
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly connection: Queryable,
    private readonly matchService: MatchPortalClientByDocumentService
  ) {}

  public async execute(organizationPublicId: string): Promise<PortalOrganizationMatchView> {
    const publicId = PublicId.fromString(organizationPublicId);
    const organizacao = await this.organizationRepositoryFactory(this.connection).findByPublicId(publicId);
    if (organizacao === undefined) {
      throw new PortalReferenceOrganizationNotFoundError(publicId.toString());
    }

    const documento = organizacao.getDocumentNumber()?.normalized();
    const base = {
      organizationPublicId: publicId.toString(),
      hasDocument: documento !== undefined,
      suggestion: null
    };

    // Grupo não recebe vínculo próprio — e a fonte nem é consultada.
    if (organizacao.getType().isBusinessGroup()) {
      return { ...base, status: "NOT_A_COMPANY", candidateCount: 0 };
    }

    const correspondencia = await this.matchService.execute(documento);
    if (correspondencia.status !== "EXACT_UNIQUE" || correspondencia.client === undefined) {
      return { ...base, status: correspondencia.status, candidateCount: correspondencia.candidateCount };
    }

    const cliente = correspondencia.client;
    return {
      ...base,
      status: "EXACT_UNIQUE",
      candidateCount: 1,
      suggestion: {
        legacyId: cliente.id,
        name: cliente.nome,
        tradeName: cliente.nomeFantasia,
        documentMasked: maskCnpj(cliente.documentDigits),
        active: cliente.active
      }
    };
  }
}
