import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio do módulo `identity` que não pertencem naturalmente a
 * um único Value Object (ex.: dependem de consulta ao repositório, ou de
 * comparação entre estado esperado e persistido).
 *
 * Códigos alinhados a docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md.
 *
 * Nota: `IDENTITY_LOGIN_DISABLED`, `IDENTITY_BLOCKED` e `IDENTITY_INACTIVE`
 * (erros de tentativa de autenticação) não são implementados nesta fatia
 * — autenticação está fora do escopo da v0.4.0 Slice 1 (ver seção 2 do
 * prompt de implementação). Ficam registrados aqui como pendência para a
 * fatia que implementar `security`/login.
 */

export class IdentityNotFoundError extends DomainError {
  public readonly code = "IDENTITY_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`Identidade não encontrada: ${publicId}.`);
  }
}

export class IdentityEmailAlreadyExistsError extends DomainError {
  public readonly code = "IDENTITY_EMAIL_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe uma identidade com este e-mail (comparação normalizada, case-insensitive).");
  }
}

export class IdentityCpfAlreadyExistsError extends DomainError {
  public readonly code = "IDENTITY_CPF_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe uma identidade com este CPF (comparação normalizada).");
  }
}

export class IdentityVersionConflictError extends DomainError {
  public readonly code = "IDENTITY_VERSION_CONFLICT";
  public readonly classification = "CONFLICT" as const;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Conflito de concorrência otimista: versão esperada ${expectedVersion}, versão atual ${actualVersion}.`
    );
  }
}
