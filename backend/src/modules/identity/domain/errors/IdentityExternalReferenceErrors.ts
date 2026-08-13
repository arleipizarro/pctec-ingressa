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
