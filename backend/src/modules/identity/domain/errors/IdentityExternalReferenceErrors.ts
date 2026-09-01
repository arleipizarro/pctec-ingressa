import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio de `IdentityExternalReference` — P1B.0, v0.7.x.
 *
 * Espelha a estrutura de `OrganizationExternalReferenceErrors.ts` (G2,
 * v0.6.x) com as adaptações necessárias para o bounded context identity.
 */

export class IdentityExternalReferenceIdentityNotFoundError extends DomainError {
  public readonly code = "IDENTITY_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identityPublicId: string) {
    super(`Identity não encontrada: ${identityPublicId}.`);
  }
}

/**
 * `existsActiveBySystemCodeEntityTypeAndLegacyId` já retornou `true` —
 * já existe uma referência **ACTIVE** para este (systemCode, entityType,
 * legacyId). Referências `SUPERSEDED` não contam (podem coexistir
 * livremente como histórico). Nunca resolvido silenciosamente — cabe a
 * quem chama decidir se isso é idempotência ou conflito.
 */
export class IdentityExternalReferenceAlreadyExistsError extends DomainError {
  public readonly code = "IDENTITY_EXTERNAL_REFERENCE_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe uma IdentityExternalReference ACTIVE para este (systemCode, entityType, legacyId).");
  }
}

/**
 * `GetActiveIdentityExternalReferenceService` não encontrou nenhuma
 * referência `ACTIVE` para `(systemCode, entityType, legacyId)`.
 *
 * Direção REVERSA (distinta do análogo em Organization): o Portal tem o
 * `legacyId` (portal_acesso.id) e precisa descobrir o `identityPublicId`
 * — não o contrário. Se não há referência ACTIVE para essa chave legada,
 * o mapeamento ainda não foi cadastrado (processo CLI, Fatia 3).
 *
 * Mapeado para HTTP 404 (mesmo padrão de `IDENTITY_NOT_FOUND` e
 * `ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND`).
 */
export class IdentityExternalReferenceNotFoundError extends DomainError {
  public readonly code = "IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(systemCode: string, entityType: string, legacyId: string) {
    super(
      `Nenhuma IdentityExternalReference ACTIVE encontrada para systemCode=${systemCode}, entityType=${entityType}, legacyId=${legacyId}.`
    );
  }
}

/**
 * Não há referência `ACTIVE` de uma Identity num dado
 * `(systemCode, entityType)` — direção **Identity → legado**, a que a
 * fundação do PCTEC Meu RH acrescentou.
 *
 * Distinto de `IdentityExternalReferenceNotFoundError` (direção
 * legado→Identity) porque a pergunta é outra e a ação corretiva também:
 * ali falta cadastrar o mapeamento de um id legado conhecido; aqui a
 * Identity existe e simplesmente ainda NÃO está vinculada àquele
 * sistema/entidade — o onboarding dela naquele produto não aconteceu.
 *
 * Compartilha o `code` `IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND` de
 * propósito: o contrato HTTP do consumidor é o mesmo (404, "não há
 * vínculo"), e criar um segundo código obrigaria todo cliente a tratar
 * duas formas da mesma resposta.
 */
export class IdentityExternalReferenceBindingNotFoundError extends DomainError {
  public readonly code = "IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identityPublicId: string, systemCode: string, entityType: string) {
    super(
      `Nenhuma IdentityExternalReference ACTIVE encontrada para identityPublicId=${identityPublicId}, systemCode=${systemCode}, entityType=${entityType}.`
    );
  }
}

/**
 * Existe MAIS DE UMA referência `ACTIVE` para
 * `(identityPublicId, systemCode, entityType)`.
 *
 * Estado que a UNIQUE KEY `uk_id_ext_ref_active_binding` (migration
 * 0024) torna impossível de criar. Este erro cobre o caminho ANORMAL —
 * restauração parcial de backup, escrita manual, banco onde a 0024
 * ainda não foi aplicada — e existe porque a alternativa é pior:
 * devolver "uma delas" faria o produto consumidor exibir dados
 * trabalhistas de OUTRA pessoa. Recusar é a única resposta segura.
 *
 * `CONFLICT` (409), e não 404: o vínculo existe; o que está quebrado é
 * a unicidade dele, e isso pede intervenção operacional, não
 * cadastro.
 */
export class IdentityExternalReferenceBindingAmbiguousError extends DomainError {
  public readonly code = "IDENTITY_EXTERNAL_REFERENCE_AMBIGUOUS";
  public readonly classification = "CONFLICT" as const;

  constructor(identityPublicId: string, systemCode: string, entityType: string) {
    super(
      `Mais de uma IdentityExternalReference ACTIVE para identityPublicId=${identityPublicId}, systemCode=${systemCode}, entityType=${entityType} — vínculo ambíguo, resolução recusada.`
    );
  }
}
