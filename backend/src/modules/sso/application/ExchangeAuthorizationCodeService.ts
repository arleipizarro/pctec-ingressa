import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import type { AuthorizationCodeRepository } from "../domain/AuthorizationCodeRepository.js";
import { createSsoAuthorizationCodeConsumedEvent } from "../domain/events/SsoDomainEvents.js";
import { SsoAuthorizationCodeExchangeFailedError } from "../domain/errors/SsoErrors.js";
import { hashAuthorizationCode } from "../infrastructure/token/hashAuthorizationCode.js";
import { verifyCodeChallengeS256 } from "../infrastructure/token/pkce.js";

export interface ExchangeAuthorizationCodeRequest {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly requiredProfile: string;
}

export interface ExchangeAuthorizationCodeResult {
  readonly identityPublicId: string;
  /** Nome de exibição — o mínimo que a sessão do cliente precisa mostrar. */
  readonly fullName: string;
  readonly applicationCode: string;
  readonly accessProfile: string;
  readonly correlationId: string;
}

/**
 * Troca o código opaco pela identidade — etapa 4/5 do fluxo SSO,
 * chamada EXCLUSIVAMENTE pelo backend do cliente, autenticada pela
 * credencial service-to-service (nunca pelo navegador).
 *
 * **O consumo é commitado ANTES das validações que dependem do conteúdo
 * do código, e isso é deliberado.** Se o consumo participasse da mesma
 * transação das validações, um `code_verifier` errado causaria rollback
 * e devolveria o código ao estado "não usado" — um atacante de posse do
 * código poderia então tentar de novo, quantas vezes quisesse, até
 * acertar. Consumindo primeiro, uma apresentação inválida QUEIMA o
 * código: é uma tentativa, e só. É também o que a RFC 6749 §4.1.2
 * recomenda ("the authorization server SHOULD revoke the code").
 *
 * A ordem das verificações posteriores não afeta segurança — todas
 * colapsam no mesmo erro externo — mas segue a mesma sequência do
 * contrato: audience, redirect_uri, PKCE, e só então o estado ATUAL da
 * identidade e do acesso.
 *
 * **Revalidação do acesso na troca** (não só na emissão): entre o
 * clique e a troca cabe uma revogação administrativa. Um código emitido
 * legitimamente não é um salvo-conduto — `ApplicationAccess` revogado
 * impede a criação da sessão no cliente.
 */
export class ExchangeAuthorizationCodeService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly authorizationCodeRepositoryFactory: (connection: Queryable) => AuthorizationCodeRepository,
    private readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository,
    private readonly identityRepository: IdentityRepository,
    private readonly authorizeApplicationAccessService: AuthorizeApplicationAccessService
  ) {}

  public async execute(request: ExchangeAuthorizationCodeRequest): Promise<ExchangeAuthorizationCodeResult> {
    const now = new Date();
    const codeHash = hashAuthorizationCode(request.code);

    const consumed = await this.unitOfWork.runInTransaction(async (connection) => {
      const authorizationCodeRepository = this.authorizationCodeRepositoryFactory(connection);
      const applicationRepository = this.applicationRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const authorizationCode = await authorizationCodeRepository.consumeByCodeHash(codeHash, now);
      if (authorizationCode === undefined) {
        // Inexistente, já consumido (replay) ou expirado — indistinguíveis
        // de fora, de propósito.
        return undefined;
      }

      const application = await applicationRepository.findByCode(ApplicationCode.create(request.clientId));

      await auditEventRepository.insert(
        AuditEvent.fromDomainEvent(
          createSsoAuthorizationCodeConsumedEvent(
            {
              aggregatePublicId: authorizationCode.getPublicId().toString(),
              actorPublicId: authorizationCode.getIdentityPublicId(),
              correlationId: authorizationCode.getCorrelationId(),
              occurredAt: now
            },
            {
              authorizationCodePublicId: authorizationCode.getPublicId().toString(),
              identityPublicId: authorizationCode.getIdentityPublicId(),
              audienceApplicationCode: request.clientId
            }
          )
        )
      );

      return {
        authorizationCode,
        requestedApplicationPublicId: application?.getPublicId().toString(),
        requestedApplicationIsActive: application?.isActive() ?? false
      };
    });

    if (consumed === undefined) {
      throw new SsoAuthorizationCodeExchangeFailedError("CODE_NOT_CONSUMABLE");
    }

    const { authorizationCode, requestedApplicationPublicId, requestedApplicationIsActive } = consumed;

    // Audience: o código foi emitido PARA uma Application específica.
    // Apresentá-lo em nome de outro `client_id` é troca de audiência, não
    // um detalhe de forma.
    if (
      requestedApplicationPublicId === undefined ||
      !requestedApplicationIsActive ||
      requestedApplicationPublicId !== authorizationCode.getAudienceApplicationPublicId()
    ) {
      throw new SsoAuthorizationCodeExchangeFailedError("AUDIENCE_MISMATCH");
    }

    if (!authorizationCode.matchesRedirectUri(request.redirectUri)) {
      throw new SsoAuthorizationCodeExchangeFailedError("REDIRECT_URI_MISMATCH");
    }

    if (!verifyCodeChallengeS256(request.codeVerifier, authorizationCode.getCodeChallenge())) {
      throw new SsoAuthorizationCodeExchangeFailedError("PKCE_VERIFICATION_FAILED");
    }

    const identityPublicId = authorizationCode.getIdentityPublicId();
    const identity = await this.identityRepository.findByPublicId(IdentityPublicId.fromString(identityPublicId));
    if (identity === undefined || identity.getStatus().toString() !== "ACTIVE" || !identity.isLoginEnabled()) {
      throw new SsoAuthorizationCodeExchangeFailedError("IDENTITY_NOT_USABLE");
    }

    let accessProfile: string;
    try {
      const authorization = await this.authorizeApplicationAccessService.execute({
        identityPublicId,
        applicationCode: request.clientId,
        requiredProfile: request.requiredProfile
      });
      accessProfile = authorization.accessProfile;
    } catch {
      // Acesso revogado entre a emissão e a troca — o código continua
      // queimado, e nenhuma sessão nasce do outro lado.
      throw new SsoAuthorizationCodeExchangeFailedError("APPLICATION_ACCESS_REVOKED");
    }

    return {
      identityPublicId,
      fullName: identity.getFullName().toString(),
      applicationCode: request.clientId,
      accessProfile,
      correlationId: authorizationCode.getCorrelationId()
    };
  }
}
