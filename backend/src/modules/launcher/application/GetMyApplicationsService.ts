import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";

export interface GrantedApplicationRow {
  readonly applicationCode: string;
  readonly applicationName: string;
  readonly accessProfile: string;
}

export interface GrantedApplicationReadRepository {
  /**
   * Acessos GRANTED da Identity para Applications ACTIVE — a projeção
   * inteira é resolvida no banco, com as duas condições no `WHERE`.
   * Trazer tudo e filtrar em memória deixaria a porta aberta para alguém,
   * um dia, esquecer um dos filtros num `map`.
   */
  listGrantedApplications(identityPublicId: string): Promise<readonly GrantedApplicationRow[]>;
}

export interface ApplicationCardView {
  readonly code: string;
  readonly name: string;
  readonly profile: string;
  /**
   * Para onde o card leva. Absoluta quando o destino é outro produto
   * (inicia o SSO no cliente); relativa quando é a própria UI do
   * Ingressa. `null` significa "há acesso, mas não há destino
   * configurado neste ambiente" — o card aparece desabilitado em vez de
   * sumir, porque sumir seria mentir sobre o acesso.
   */
  readonly launchUrl: string | null;
}

export interface MyApplicationsResult {
  readonly identity: { readonly publicId: string; readonly fullName: string };
  readonly applications: readonly ApplicationCardView[];
}

/**
 * Monta o painel "Meus aplicativos" de uma Identity JÁ AUTENTICADA.
 *
 * **Esta é a autoridade dos cards.** O frontend desenha o que vier e
 * nada além: um card só existe aqui se houver `ApplicationAccess`
 * GRANTED para uma `Application` ACTIVE. Não há filtro no cliente, não
 * há lista fixa no cliente, e esconder um card no cliente nunca seria
 * proteção — a proteção continua sendo o gate de cada rota do produto
 * de destino.
 *
 * O mapa de destinos (`launchUrlByApplicationCode`) é CONFIGURAÇÃO,
 * injetada por `createApp`: a URL que inicia o SSO pertence ao cliente,
 * não ao Ingressa, e muda por ambiente.
 */
export class GetMyApplicationsService {
  public constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly readRepository: GrantedApplicationReadRepository,
    private readonly launchUrlByApplicationCode: Readonly<Record<string, string>>
  ) {}

  public async execute(rawIdentityPublicId: string): Promise<MyApplicationsResult> {
    const identityPublicId = IdentityPublicId.fromString(rawIdentityPublicId);
    const identity = await this.identityRepository.findByPublicId(identityPublicId);
    const rows = await this.readRepository.listGrantedApplications(identityPublicId.toString());

    return {
      identity: {
        publicId: identityPublicId.toString(),
        fullName: identity === undefined ? "" : identity.getFullName().toString()
      },
      applications: rows.map((row) => ({
        code: row.applicationCode,
        name: row.applicationName,
        profile: row.accessProfile,
        launchUrl: this.launchUrlByApplicationCode[row.applicationCode] ?? null
      }))
    };
  }
}
