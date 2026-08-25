import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { GetPortalContextService } from "../../portal/application/GetPortalContextService.js";
import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import type { AuthorizationCodeRepository } from "../domain/AuthorizationCodeRepository.js";
import { AuthorizationCode } from "../domain/AuthorizationCode.js";
import { createSsoAuthorizationCodeIssuedEvent } from "../domain/events/SsoDomainEvents.js";
import { SsoAuthorizationDeniedError } from "../domain/errors/SsoErrors.js";
import type { AuthorizationCodeGenerator } from "../infrastructure/token/AuthorizationCodeGenerator.js";
import { hashAuthorizationCode } from "../infrastructure/token/hashAuthorizationCode.js";

export interface IssueAuthorizationCodeRequest {
  /** Já provado pelo cookie de sessão — NUNCA vem do navegador como parâmetro. */
  readonly identityPublicId: string;
  /** `client_id` do fluxo, já resolvido contra o `SsoClientRegistry`. */
  readonly applicationCode: string;
  readonly requiredProfile: string;
  /** Já validado contra a lista fechada do cliente — igualdade exata. */
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly correlationId?: string | undefined;
}

export interface IssueAuthorizationCodeResult {
  /** Código BRUTO — existe só nesta resposta e no redirect; nunca é persistido. */
  readonly code: string;
  readonly expiresAt: Date;
  readonly correlationId: string;
}

/**
 * Emite um código de autorização para uma Identity JÁ AUTENTICADA —
 * etapa 2/3 do fluxo SSO first-party.
 *
 * **Não reimplementa autorização.** As duas perguntas que decidem se o
 * SSO pode começar já têm dono nesta base, e são esses donos que
 * respondem aqui:
 *
 * - "esta identidade pode usar esta aplicação?" →
 *   `AuthorizeApplicationAccessService` (Application ACTIVE +
 *   ApplicationAccess GRANTED + perfil suficiente);
 * - "ela tem algum vínculo empresarial utilizável?" →
 *   `GetPortalContextService` (Membership ACTIVE + Organization ACTIVE +
 *   expansão de grupo + deduplicação).
 *
 * A checagem de vínculo existe porque uma sessão criada no Portal sem
 * nenhuma organização acessível não é uma sessão útil — é uma tela vazia
 * com um cookie válido. Recusar aqui devolve a pessoa ao launcher com
 * uma negativa, em vez de empurrá-la para um produto onde nada abre.
 *
 * `Identity ACTIVE` e `login_enabled` são reverificados mesmo já tendo
 * sido verificados na validação da sessão: entre um clique e outro o
 * estado pode ter mudado, e emitir um código é criar acesso NOVO, não
 * continuar um já existente.
 *
 * O código bruto nunca é persistido nem logado — só seu SHA-256 vai ao
 * banco, e o valor em claro sai apenas no retorno desta função.
 */
export class IssueAuthorizationCodeService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository,
    private readonly authorizationCodeRepositoryFactory: (connection: Queryable) => AuthorizationCodeRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository,
    private readonly authorizeApplicationAccessService: AuthorizeApplicationAccessService,
    private readonly getPortalContextService: GetPortalContextService,
    private readonly codeGenerator: AuthorizationCodeGenerator,
    private readonly ttlSeconds: number
  ) {}

  public async execute(request: IssueAuthorizationCodeRequest): Promise<IssueAuthorizationCodeResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const identityPublicId = IdentityPublicId.fromString(request.identityPublicId).toString();

    // Application ACTIVE + ApplicationAccess GRANTED + perfil — colapsa em
    // 403 ApplicationAccessDeniedError, que a rota converte para a
    // negativa genérica do SSO.
    const authorization = await this.authorizeApplicationAccessService.execute({
      identityPublicId,
      applicationCode: request.applicationCode,
      requiredProfile: request.requiredProfile
    });

    const context = await this.getPortalContextService.execute(identityPublicId);
    if (context.organizations.length === 0) {
      throw new SsoAuthorizationDeniedError("NO_USABLE_MEMBERSHIP");
    }

    const rawCode = this.codeGenerator.generate();
    const codeHash = hashAuthorizationCode(rawCode);

    const expiresAt = await this.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.identityRepositoryFactory(connection);
      const applicationRepository = this.applicationRepositoryFactory(connection);
      const authorizationCodeRepository = this.authorizationCodeRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const identity = await identityRepository.findByPublicId(IdentityPublicId.fromString(identityPublicId));
      if (identity === undefined) {
        throw new SsoAuthorizationDeniedError("IDENTITY_NOT_FOUND");
      }
      if (identity.getStatus().toString() !== "ACTIVE") {
        throw new SsoAuthorizationDeniedError("IDENTITY_NOT_ACTIVE");
      }
      if (!identity.isLoginEnabled()) {
        throw new SsoAuthorizationDeniedError("LOGIN_NOT_ENABLED");
      }

      const application = await applicationRepository.findByCode(ApplicationCode.create(request.applicationCode));
      if (application === undefined || !application.isActive()) {
        throw new SsoAuthorizationDeniedError("APPLICATION_NOT_AVAILABLE");
      }

      const authorizationCode = AuthorizationCode.issue({
        identityPublicId,
        audienceApplicationPublicId: application.getPublicId().toString(),
        audienceApplicationCode: authorization.applicationCode,
        codeHash,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        ttlSeconds: this.ttlSeconds,
        correlationId
      });

      await authorizationCodeRepository.insert(authorizationCode);

      await auditEventRepository.insert(
        AuditEvent.fromDomainEvent(
          createSsoAuthorizationCodeIssuedEvent(
            {
              aggregatePublicId: authorizationCode.getPublicId().toString(),
              actorPublicId: identityPublicId,
              correlationId,
              occurredAt: authorizationCode.getCreatedAt()
            },
            {
              authorizationCodePublicId: authorizationCode.getPublicId().toString(),
              identityPublicId,
              audienceApplicationCode: authorization.applicationCode,
              redirectUri: authorizationCode.getRedirectUri(),
              expiresAt: authorizationCode.getExpiresAt().toISOString()
            }
          )
        )
      );

      return authorizationCode.getExpiresAt();
    });

    return { code: rawCode, expiresAt, correlationId };
  }
}
