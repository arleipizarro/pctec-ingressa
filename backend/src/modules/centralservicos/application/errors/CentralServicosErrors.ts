import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * A identidade não está autorizada na Central de Serviços: não existe,
 * não está ACTIVE, não tem acesso à aplicação ou não tem nenhum perfil.
 * Um código só, de propósito — o produto consumidor não precisa saber
 * qual das quatro condições falhou para recusar.
 */
export class CentralServicosIdentityNotAuthorizedError extends DomainError {
  public readonly code = "CENTRAL_SERVICOS_IDENTITY_NOT_AUTHORIZED";
  public readonly classification = "AUTHORIZATION" as const;

  constructor() {
    super("Identidade sem autorização vigente na Central de Serviços.");
  }
}

/** Entrada malformada para emitir ou verificar uma asserção. */
export class DelegationAssertionInvalidInputError extends DomainError {
  public readonly code = "DELEGATION_ASSERTION_INVALID_INPUT";
  public readonly classification = "VALIDATION" as const;

  constructor(campo: string) {
    super(`Campo inválido na asserção de delegação: ${campo}.`);
  }
}

/**
 * Já existe asserção para esta ação do emissor. Uma ação, uma asserção:
 * emitir outra para a mesma chave abriria duas provas para o mesmo gesto.
 */
export class DelegationAssertionAlreadyIssuedError extends DomainError {
  public readonly code = "DELEGATION_ASSERTION_ALREADY_ISSUED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe asserção de delegação para esta ação.");
  }
}
