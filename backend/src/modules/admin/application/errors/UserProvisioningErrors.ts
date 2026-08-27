import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros do provisionamento administrativo de usuário.
 *
 * Só nasce aqui o que a COMPOSIÇÃO introduziu. E-mail duplicado,
 * organização inexistente, organização inativa e conflito de acesso já
 * têm erro próprio nos serviços reaproveitados
 * (`IDENTITY_EMAIL_ALREADY_EXISTS`, `ORGANIZATION_NOT_FOUND`,
 * `MEMBERSHIP_ORGANIZATION_NOT_ACTIVE`,
 * `APPLICATION_ACCESS_ACTIVE_GRANT_CONFLICT`) e continuam vindo de lá.
 */

/**
 * Provisionar sem nenhuma aplicação entregaria uma pessoa que consegue
 * definir senha e não consegue abrir nada — e o convite sequer seria
 * emitido, porque a elegibilidade exige ao menos um `ApplicationAccess`
 * GRANTED. Recusar na entrada é mais honesto que criar o beco sem saída.
 */
export class UserProvisioningApplicationsRequiredError extends DomainError {
  public readonly code = "USER_PROVISIONING_APPLICATIONS_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Selecione ao menos uma aplicação para conceder acesso.");
  }
}

/** Aplicação INACTIVE recusada ANTES de qualquer escrita. */
export class UserProvisioningApplicationNotActiveError extends DomainError {
  public readonly code = "USER_PROVISIONING_APPLICATION_NOT_ACTIVE";
  public readonly classification = "VALIDATION" as const;

  constructor(applicationCode: string) {
    super(`A aplicação ${applicationCode} não está ACTIVE.`);
  }
}

/**
 * `ORGANIZATION_AND_DESCENDANTS` numa COMPANY.
 *
 * O Value Object `MembershipScope` aceita a combinação e documenta que
 * ela "não amplia nada na prática" — COMPANY não tem descendentes. Isso
 * é verdade hoje e vira mentira no dia em que COMPANY passar a ter
 * filhos: o vínculo gravado com esse escopo ampliaria alcance
 * silenciosamente, sem ninguém ter decidido isso. Guardar um escopo que
 * só faz sentido para grupo é registrar uma intenção que não existe, e
 * por isso o provisionamento recusa em vez de aceitar e ignorar.
 */
export class UserProvisioningScopeNotAllowedForCompanyError extends DomainError {
  public readonly code = "USER_PROVISIONING_SCOPE_NOT_ALLOWED_FOR_COMPANY";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "Vínculo em COMPANY aceita apenas o escopo ORGANIZATION_ONLY. " +
        "ORGANIZATION_AND_DESCENDANTS existe para BUSINESS_GROUP."
    );
  }
}

/**
 * `PCTEC_PORTAL` pedido para uma COMPANY que ainda não tem a referência
 * `PCTEC_PORTAL`/`clientes` ACTIVE.
 *
 * Sem essa referência o Portal não resolve a empresa para
 * `pctecdb.clientes`: a pessoa entraria, e cada tela comercial
 * responderia 404. Criar assim mesmo produz um usuário que existe, tem
 * acesso concedido, recebe convite — e não consegue usar nada. Recusar
 * ANTES da transação é o que garante que nem a Identity nem o vínculo
 * nem o convite chegam a existir.
 */
export class PortalOrganizationReferenceRequiredError extends DomainError {
  public readonly code = "PORTAL_ORGANIZATION_REFERENCE_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  public override readonly details: readonly unknown[];

  constructor(organizationPublicId: string) {
    super(
      "Esta empresa ainda não está vinculada ao Portal. Conclua o vínculo em " +
        "“Integração com o Portal” antes de conceder acesso ao PCTEC_PORTAL."
    );
    this.details = [{ organizationPublicId }];
  }
}

/**
 * `PCTEC_PORTAL` pedido num BUSINESS_GROUP cuja cobertura está
 * incompleta — ou que não tem nenhuma empresa ativa.
 *
 * O consolidado de um grupo é a soma das empresas filhas, e o escopo
 * comercial do Portal é fail-closed: uma filha sem referência derruba a
 * leitura inteira. Provisionar sobre cobertura parcial entregaria um
 * usuário cujo dashboard falha por completo — não "quase completo".
 *
 * Grupo sem nenhuma empresa ativa cai no MESMO código: não há nada a
 * consolidar, e "coberto" seria uma resposta falsa sobre um conjunto
 * vazio.
 *
 * `details` carrega contagens e os `publicId` que faltam — nunca id
 * legado, documento ou dado pessoal. É o que transforma a recusa em
 * instrução: a tela consegue dizer QUAIS empresas vincular.
 */
export class PortalGroupReferenceIncompleteError extends DomainError {
  public readonly code = "PORTAL_GROUP_REFERENCE_INCOMPLETE";
  public readonly classification = "VALIDATION" as const;

  public override readonly details: readonly unknown[];

  constructor(cobertura: {
    readonly organizationPublicId: string;
    readonly totalActiveCompanies: number;
    readonly linkedCompanies: number;
    readonly missingCompaniesCount: number;
    readonly missingCompanyPublicIds: readonly string[];
  }) {
    super(
      cobertura.totalActiveCompanies === 0
        ? "Este grupo não tem nenhuma empresa ativa. Não há cobertura de Portal a consolidar."
        : `Cobertura do Portal incompleta: ${cobertura.linkedCompanies} de ` +
            `${cobertura.totalActiveCompanies} empresas vinculadas. Vincule as empresas que faltam antes de ` +
            "conceder acesso ao PCTEC_PORTAL."
    );
    this.details = [
      {
        organizationPublicId: cobertura.organizationPublicId,
        totalActiveCompanies: cobertura.totalActiveCompanies,
        linkedCompanies: cobertura.linkedCompanies,
        missingCompaniesCount: cobertura.missingCompaniesCount,
        missingCompanyPublicIds: cobertura.missingCompanyPublicIds
      }
    ];
  }
}
