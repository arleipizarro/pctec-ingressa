import { DomainError } from "../../../../shared/errors/DomainError.js";
import { PORTAL_REFERENCE_ENTITY_TYPE, PORTAL_REFERENCE_SYSTEM_CODE } from "../value-objects/PortalReferenceCodes.js";

/**
 * Erros do vínculo administrativo de uma COMPANY ao Portal
 * (`PCTEC_PORTAL`/`clientes`).
 *
 * Só nasce aqui o que a OPERAÇÃO ADMINISTRATIVA introduziu. A invariante
 * "no máximo uma referência ACTIVE por (systemCode, entityType,
 * legacyId)" continua sendo de
 * `OrganizationExternalReferenceAlreadyExistsError` (409), lançada pelo
 * serviço oficial de criação — nunca reimplementada, nunca reescrita
 * com outro código.
 */

/**
 * A organização existe, mas é um BUSINESS_GROUP.
 *
 * Não é um detalhe de validação de campo: é a regra estrutural do
 * modelo. Grupo não tem `clientes.id` próprio, e aceitar um aqui
 * criaria uma segunda fonte de verdade para o consolidado.
 */
export class PortalReferenceCompanyRequiredError extends DomainError {
  public readonly code = "PORTAL_REFERENCE_COMPANY_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "Somente uma COMPANY recebe referência do Portal. Um BUSINESS_GROUP é coberto pelas " +
        "referências das empresas filhas — vincule cada empresa individualmente."
    );
  }
}

/** Vincular uma organização INACTIVE registraria cobertura para algo que já saiu de operação. */
export class PortalReferenceOrganizationNotActiveError extends DomainError {
  public readonly code = "PORTAL_REFERENCE_ORGANIZATION_NOT_ACTIVE";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("A organização precisa estar ACTIVE para ser vinculada ao Portal.");
  }
}

/**
 * `legacyId` fora de "inteiro positivo".
 *
 * Distinto de `LEGACY_ID_INVALID` (o erro do Value Object) de propósito:
 * este é o contrato da ROTA administrativa, e a tela precisa de um
 * código estável que não mude no dia em que a validação do VO for
 * reaproveitada em outro fluxo.
 */
export class PortalReferenceLegacyIdInvalidError extends DomainError {
  public readonly code = "PORTAL_REFERENCE_LEGACY_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Informe o id do cliente no Portal como um número inteiro positivo.");
  }
}

/**
 * A COMPANY já tem uma referência `PCTEC_PORTAL`/`clientes` ACTIVE
 * apontando para OUTRO `legacyId`.
 *
 * Nunca sobrescrito. Trocar o vínculo mudaria, de uma requisição para a
 * outra, qual cliente legado todos os usuários Portal daquela empresa
 * enxergam — e o modelo atual não tem revogação, então a troca seria uma
 * perda de histórico disfarçada de correção. Revogar/trocar é operação
 * própria, com o seu próprio PR.
 */
export class PortalReferenceAlreadyLinkedDifferentError extends DomainError {
  public readonly code = "PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "Esta empresa já está vinculada ao Portal com outro id de cliente. " +
        "Trocar ou revogar o vínculo não é possível por esta tela."
    );
  }
}

/**
 * A organização não existe.
 *
 * Código próprio, e não o `ORGANIZATION_NOT_FOUND` genérico, porque
 * precisa de 404 (recurso inexistente) enquanto aquele é 422 pela
 * classificação. Reclassificar o código compartilhado mudaria o status
 * de fluxos que não têm nada a ver com o Portal.
 */
export class PortalReferenceOrganizationNotFoundError extends DomainError {
  public readonly code = "PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(organizationPublicId: string) {
    super(
      `Organização ${organizationPublicId} não encontrada para vincular a ` +
        `${PORTAL_REFERENCE_SYSTEM_CODE}/${PORTAL_REFERENCE_ENTITY_TYPE}.`
    );
  }
}

/**
 * A organização tem MAIS DE UMA referência `PCTEC_PORTAL`/`clientes`
 * ACTIVE.
 *
 * O estado não deveria existir, e mesmo assim é alcançável: o CLI
 * genérico continua podendo criar qualquer par (sistema, entidade,
 * legacyId), e a UNIQUE KEY da migration 0013 cobre
 * `(system_code, entity_type, legacy_id)` — nada nela impede duas
 * referências da MESMA organização apontando para `legacyId`
 * diferentes.
 *
 * **A resposta certa é recusar, não escolher.** `LIMIT 1` devolveria uma
 * delas e a ambiguidade sumiria da tela: o ADMIN leria um `legacyId`
 * como se fosse "o" vínculo da empresa, enquanto o Portal poderia
 * resolver pelo outro. Um usuário provisionado nesse estado enxergaria
 * o faturamento de um cliente legado que ninguém escolheu.
 *
 * Corrigir exige decidir qual referência vale e encerrar a outra — o que
 * hoje só o CLI faz, com registro. Por isso este erro é CONFLICT: não é
 * o pedido que está errado, é o cadastro.
 */
export class PortalReferenceAmbiguousError extends DomainError {
  public readonly code = "PORTAL_REFERENCE_AMBIGUOUS";
  public readonly classification = "CONFLICT" as const;

  public override readonly details: readonly unknown[];

  constructor(organizationPublicId: string, activeReferenceCount: number) {
    super(
      `Esta organização tem ${activeReferenceCount} referências ACTIVE de ` +
        `${PORTAL_REFERENCE_SYSTEM_CODE}/${PORTAL_REFERENCE_ENTITY_TYPE}. Enquanto houver mais de uma, ` +
        "nenhuma pode ser tratada como o vínculo da empresa."
    );
    // Contagem e identificador organizacional. Nenhum `legacyId` aqui:
    // qual deles citar já seria a escolha que este erro existe para não
    // fazer. A leitura administrativa lista todas, sem eleger nenhuma.
    this.details = [{ organizationPublicId, activeReferenceCount }];
  }
}
