import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { CredentialRepository } from "../domain/CredentialRepository.js";
import { CredentialType } from "../domain/value-objects/CredentialType.js";
import { PlainPassword } from "../domain/value-objects/PlainPassword.js";
import type { PasswordHash } from "../domain/value-objects/PasswordHash.js";
import { AuthenticationFailedError } from "../domain/errors/AuthenticationErrors.js";
import { DUMMY_PASSWORD_HASH } from "../infrastructure/hashing/DummyPasswordHash.js";

export interface PasswordVerifier {
  verify(password: PlainPassword, hash: PasswordHash): Promise<boolean>;
}

export interface AuthenticateIdentityRequest {
  readonly email: string;
  readonly password: string;
}

export interface AuthenticatedIdentity {
  readonly identityPublicId: string;
}

/**
 * Prova a identidade de uma pessoa via e-mail + senha — v0.6.0, Fase D
 * (ADR-030, `AuthenticateIdentityService`).
 *
 * **Nunca resolve `ApplicationAccess`** — retorna exclusivamente
 * `{ identityPublicId }`. A resolução de "o que esta identidade pode
 * acessar" é responsabilidade de uma camada separada e posterior, nunca
 * deste serviço (ADR-029/ADR-030, boundary já fixado).
 *
 * **Proteção contra enumeração (ADR-030):** todas as causas de falha —
 * e-mail inexistente, `Identity` não `ACTIVE`, `loginEnabled=false`,
 * `Credential` inexistente, `Credential` não `ACTIVE`, senha incorreta —
 * lançam a MESMA classe de erro (`AuthenticationFailedError`), com a
 * mesma mensagem externa. O motivo real fica apenas no campo interno
 * `reason` do erro (nunca serializado na resposta HTTP).
 *
 * **Mitigação de timing attack (ADR-030):** sempre que a `Identity`/
 * `Credential` não é encontrada ou está em estado inválido, um hash
 * `Argon2id` dummy é computado (mesmo custo do caminho real) ANTES de
 * lançar o erro — nivela o tempo de resposta entre "conta não existe" e
 * "senha incorreta". Os cinco pontos de checagem abaixo repetem
 * deliberadamente o padrão `await verify(dummy); throw ...` em vez de
 * delegar a um helper — um helper `async` retornando `Promise<never>`
 * não permite ao TypeScript estreitar (`narrow`) o tipo de
 * `identity`/`credential` para não-`undefined` nas linhas seguintes,
 * então o padrão fica inline por clareza e correção de tipos.
 */
export class AuthenticateIdentityService {
  public constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly credentialRepository: CredentialRepository,
    private readonly passwordVerifier: PasswordVerifier
  ) {}

  public async execute(request: AuthenticateIdentityRequest): Promise<AuthenticatedIdentity> {
    // Normalização idêntica à usada por Identity.email_normalized
    // (trim + lowercase) — nunca a validação estrita de formato de
    // Email.create() (que lançaria um erro DISTINTO, com HTTP DISTINTO,
    // para e-mail malformado — quebrando a uniformidade de resposta do
    // login).
    const normalizedEmail = request.email.trim().toLowerCase();

    // PlainPassword.forVerification() — deliberadamente SEM a política
    // de senha (comprimento mínimo/blacklist) que PlainPassword.create()
    // aplicaria. Ver PlainPassword.ts para a justificativa completa: a
    // política de senha é para DEFINIR uma senha nova, não para
    // VERIFICAR uma senha existente — aplicá-la aqui criaria um caminho
    // de falha mais rápido para senhas curtas, reintroduzindo timing
    // leak.
    const plainPassword = PlainPassword.forVerification(request.password);

    const identity = await this.identityRepository.findByNormalizedEmail(normalizedEmail);
    if (identity === undefined) {
      await this.passwordVerifier.verify(plainPassword, DUMMY_PASSWORD_HASH);
      throw new AuthenticationFailedError("IDENTITY_NOT_FOUND");
    }

    if (identity.getStatus().toString() !== "ACTIVE") {
      await this.passwordVerifier.verify(plainPassword, DUMMY_PASSWORD_HASH);
      throw new AuthenticationFailedError("IDENTITY_NOT_ACTIVE");
    }

    if (!identity.isLoginEnabled()) {
      await this.passwordVerifier.verify(plainPassword, DUMMY_PASSWORD_HASH);
      throw new AuthenticationFailedError("LOGIN_NOT_ENABLED");
    }

    const credential = await this.credentialRepository.findByIdentityAndType(
      identity.getPublicId().toString(),
      CredentialType.localPassword()
    );
    if (credential === undefined) {
      await this.passwordVerifier.verify(plainPassword, DUMMY_PASSWORD_HASH);
      throw new AuthenticationFailedError("CREDENTIAL_NOT_FOUND");
    }

    if (!credential.isActive()) {
      await this.passwordVerifier.verify(plainPassword, DUMMY_PASSWORD_HASH);
      throw new AuthenticationFailedError("CREDENTIAL_NOT_ACTIVE");
    }

    const passwordMatches = await this.passwordVerifier.verify(plainPassword, credential.getPasswordHash());
    if (!passwordMatches) {
      // Caminho real (não dummy) — já pagou o custo do Argon2id de
      // verdade, nenhum dummy adicional necessário aqui.
      throw new AuthenticationFailedError("INVALID_PASSWORD");
    }

    const expectedVersion = credential.getVersion();
    credential.recordSuccessfulAuthentication();
    await this.credentialRepository.update(credential, expectedVersion);

    return { identityPublicId: identity.getPublicId().toString() };
  }
}
