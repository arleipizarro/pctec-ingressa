import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { DomainError } from "../../../shared/errors/DomainError.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { CredentialRepository } from "../domain/CredentialRepository.js";
import { CredentialType } from "../domain/value-objects/CredentialType.js";
import { PlainPassword } from "../domain/value-objects/PlainPassword.js";
import { CredentialNotFoundError } from "../domain/errors/CredentialErrors.js";
import type { SessionRepository } from "../domain/session/SessionRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../../application/domain/ApplicationAccessRepository.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { PasswordHasher } from "./BootstrapFirstCredentialService.js";

/** Aplicação administrativa da plataforma e perfil exigido do alvo. */
export const PLATFORM_APPLICATION_CODE = "PCTEC_INGRESSA" as const;
export const PLATFORM_ADMIN_PROFILE = "ADMIN" as const;
/** Vai para o evento `credential.changed` — diz POR QUE a senha mudou. */
export const RESET_REASON_CODE = "ADMIN_PASSWORD_RECOVERY" as const;
export const SESSION_REVOCATION_REASON = "ADMIN_PASSWORD_RECOVERY" as const;

export class IdentityNotActiveForResetError extends DomainError {
  public readonly code = "IDENTITY_NOT_ACTIVE_FOR_RESET";
  public readonly classification = "CONFLICT" as const;

  constructor(status: string) {
    super(`identidade está ${status} — a recuperação só redefine senha de identidade ACTIVE.`);
  }
}

export class IdentityNotFoundForResetError extends DomainError {
  public readonly code = "IDENTITY_NOT_FOUND_FOR_RESET";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`identidade ${publicId} não encontrada.`);
  }
}

export class LoginDisabledForResetError extends DomainError {
  public readonly code = "IDENTITY_LOGIN_DISABLED_FOR_RESET";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "identidade está com login desabilitado — redefinir a senha não devolveria acesso, " +
        "e reabilitar login é outra decisão, com outro fluxo."
    );
  }
}

export interface ResetAdminPasswordRequest {
  readonly identityPublicId: string;
  /** Senha em texto puro, vinda EXCLUSIVAMENTE de stdin. */
  readonly plainPassword: string;
  readonly correlationId?: string | undefined;
}

export interface ResetAdminPasswordResult {
  readonly identityPublicId: string;
  readonly credentialPublicId: string;
  readonly credentialVersion: number;
  readonly revokedSessions: number;
}

export interface ResetAdminPasswordDeps {
  readonly unitOfWork: UnitOfWork;
  readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository;
  readonly credentialRepositoryFactory: (connection: Queryable) => CredentialRepository;
  readonly sessionRepositoryFactory: (connection: Queryable) => SessionRepository;
  readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository;
  readonly applicationAccessRepositoryFactory: (connection: Queryable) => ApplicationAccessRepository;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
  readonly passwordHasher: PasswordHasher;
}

/**
 * Recuperação administrativa de senha.
 *
 * Existe para um caso real e estreito: a única identidade ADMIN perdeu a
 * senha, e sem ela ninguém opera a plataforma. Tudo aqui é desenhado
 * para que esse caminho não vire porta dos fundos:
 *
 * - **só redefine ADMIN.** Uma identidade qualquer é recusada — este CLI
 *   não é um "trocar senha de quem eu quiser";
 * - **redefine a credencial que existe**, nunca cria uma segunda: duas
 *   `LOCAL_PASSWORD` para a mesma pessoa fariam a autenticação depender
 *   de qual delas o repositório devolvesse primeiro;
 * - **revoga todas as sessões ativas.** Sem isso, quem já estava logado
 *   com a senha antiga continuaria dentro — e o motivo mais provável de
 *   uma recuperação é justamente não se saber quem tem acesso;
 * - **política e hashing existentes**, sem exceção: `PlainPassword`
 *   aplica comprimento mínimo e blacklist (ADR-029), e o hash vem do
 *   `PasswordHasher` de produção;
 * - **nunca toca em `login_enabled`.** Se estiver desabilitado, recusa e
 *   explica: reabilitar login é outra decisão.
 *
 * A senha em texto puro entra por parâmetro e sai do escopo aqui — não é
 * logada, não vai para evento e não é devolvida.
 */
export class ResetAdminPasswordService {
  public constructor(private readonly deps: ResetAdminPasswordDeps) {}

  public async execute(request: ResetAdminPasswordRequest): Promise<ResetAdminPasswordResult> {
    const correlationId = request.correlationId ?? randomUUID();
    // Política de senha ANTES de qualquer I/O: entrada obviamente
    // inválida não merece transação nem hashing.
    const plainPassword = PlainPassword.create(request.plainPassword);
    const identityPublicId = IdentityPublicId.fromString(request.identityPublicId).toString();

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.deps.identityRepositoryFactory(connection);
      const credentialRepository = this.deps.credentialRepositoryFactory(connection);
      const sessionRepository = this.deps.sessionRepositoryFactory(connection);
      const auditEventRepository = this.deps.auditEventRepositoryFactory(connection);

      const identidade = await identityRepository.findByPublicId(
        IdentityPublicId.fromString(identityPublicId)
      );
      if (identidade === undefined) {
        throw new IdentityNotFoundForResetError(identityPublicId);
      }
      if (identidade.getStatus().toString() !== "ACTIVE") {
        throw new IdentityNotActiveForResetError(identidade.getStatus().toString());
      }
      if (!identidade.isLoginEnabled()) {
        throw new LoginDisabledForResetError();
      }

      // ADMIN é exigência, não conveniência: lança
      // ApplicationAccessDeniedError (403) para qualquer outro caso.
      await new AuthorizeApplicationAccessService(
        this.deps.applicationRepositoryFactory(connection),
        this.deps.applicationAccessRepositoryFactory(connection)
      ).execute({
        identityPublicId,
        applicationCode: PLATFORM_APPLICATION_CODE,
        requiredProfile: PLATFORM_ADMIN_PROFILE
      });

      const credencial = await credentialRepository.findByIdentityAndType(
        identityPublicId,
        CredentialType.localPassword()
      );
      if (credencial === undefined) {
        throw new CredentialNotFoundError(identityPublicId);
      }

      // O hasher recebe o Value Object, nunca a string crua — é o
      // mesmo contrato usado pelo bootstrap de credencial.
      const hash = await this.deps.passwordHasher.hash(plainPassword);
      const versaoOriginal = credencial.getVersion();
      credencial.resetPassword({
        newPasswordHash: hash,
        actorPublicId: identityPublicId,
        reasonCode: RESET_REASON_CODE,
        expectedVersion: versaoOriginal,
        correlationId
      });
      await credentialRepository.update(credencial, versaoOriginal);

      const eventos = credencial.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento));

      // Revogação em massa: cada sessão passa pelo próprio agregado, para
      // que cada uma gere seu evento de revogação.
      const ativas = (await sessionRepository.findActiveByIdentityPublicId?.(identityPublicId)) ?? [];
      for (const sessao of ativas) {
        const versaoSessao = sessao.getVersion();
        sessao.revoke({
          reason: SESSION_REVOCATION_REASON,
          actorPublicId: identityPublicId,
          correlationId
        });
        await sessionRepository.update(sessao, versaoSessao);
        eventos.push(...sessao.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento)));
      }

      if (eventos.length > 0) {
        await auditEventRepository.insertMany(eventos);
      }

      return {
        identityPublicId,
        credentialPublicId: credencial.getPublicId().toString(),
        credentialVersion: credencial.getVersion(),
        revokedSessions: ativas.length
      };
    });
  }
}
