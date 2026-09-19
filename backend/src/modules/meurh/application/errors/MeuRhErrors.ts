import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros do namespace service-to-service do PCTEC Meu RH.
 *
 * O Meu RH é um produto CONSUMIDOR: ele não modela identidade, não
 * modela organização e não decide autorização de plataforma. Estes
 * erros cobrem apenas a fronteira — o que o Ingressa recusa a fazer
 * quando o Meu RH pede algo incoerente.
 */

/** A empresa pedida por nome não existe e a criação não foi autorizada na requisição. */
export class MeuRhOrganizationNotFoundError extends DomainError {
  public readonly code = "MEU_RH_ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(legalName: string) {
    super(`Nenhuma organização encontrada para o nome informado (${legalName}).`);
  }
}

/**
 * O nome pedido corresponde a MAIS DE UMA organização na forma
 * normalizada.
 *
 * Recusa explícita, e nunca "escolhe a primeira": vincular vinte pessoas
 * à empresa errada porque duas têm nomes equivalentes é um estrago que
 * ninguém percebe no mesmo dia. Quem opera precisa desfazer a
 * ambiguidade no Cadastro Mestre antes.
 */
export class MeuRhOrganizationAmbiguousError extends DomainError {
  public readonly code = "MEU_RH_ORGANIZATION_AMBIGUOUS";
  public readonly classification = "CONFLICT" as const;

  constructor(legalName: string, quantidade: number) {
    super(
      `O nome informado (${legalName}) corresponde a ${quantidade} organizações. ` +
        "Desfaça a ambiguidade no Cadastro Mestre antes de operar o Meu RH."
    );
  }
}

/** A organização existe, mas está INACTIVE — não se vincula ninguém a ela. */
export class MeuRhOrganizationNotActiveError extends DomainError {
  public readonly code = "MEU_RH_ORGANIZATION_NOT_ACTIVE";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("A organização está inativa e não aceita novos vínculos.");
  }
}

/** Identidade não encontrada para o publicId informado. */
export class MeuRhIdentityNotFoundError extends DomainError {
  public readonly code = "MEU_RH_IDENTITY_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Identidade não encontrada.");
  }
}

/** Vínculo inexistente entre a identidade e a organização informadas. */
export class MeuRhMembershipNotFoundError extends DomainError {
  public readonly code = "MEU_RH_MEMBERSHIP_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Vínculo não encontrado para esta identidade nesta organização.");
  }
}
