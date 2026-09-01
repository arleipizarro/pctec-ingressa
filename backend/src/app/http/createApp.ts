import express, { Router, type Express, type NextFunction, type Response } from "express";
import type { Pool } from "mysql2/promise";

import { createPool } from "../../shared/database/Pool.js";
import { loadEnv } from "../config/env.js";
import { correlationIdMiddleware, type RequestWithCorrelationId } from "../../shared/http/correlationId.js";
import { isDomainError, mapDomainErrorToHttp } from "../../shared/http/mapDomainErrorToHttp.js";
import type { IdentityRepository } from "../../modules/identity/domain/IdentityRepository.js";
import { MariaDbIdentityRepository } from "../../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { GetIdentityByPublicIdService } from "../../modules/identity/application/GetIdentityByPublicIdService.js";
import { createIdentityRoutes } from "../../modules/identity/http/identityRoutes.js";
import { MariaDbCredentialRepository } from "../../modules/security/infrastructure/persistence/MariaDbCredentialRepository.js";
import { MariaDbSessionRepository } from "../../modules/security/infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbAuditEventRepository } from "../../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { Argon2PasswordHasher } from "../../modules/security/infrastructure/hashing/Argon2PasswordHasher.js";
import { CryptoSessionTokenGenerator } from "../../modules/security/infrastructure/token/SessionTokenGenerator.js";
import { LoginService } from "../../modules/security/application/LoginService.js";
import { LogoutService } from "../../modules/security/application/LogoutService.js";
import { ValidateSessionService } from "../../modules/security/application/ValidateSessionService.js";
import { createSessionRoutes } from "../../modules/security/http/sessionRoutes.js";
import { createMeRoutes } from "../../modules/security/http/meRoutes.js";
import { createRequireAuthenticatedSession } from "../../modules/security/http/requireAuthenticatedSession.js";
import type { SessionCookieConfig } from "../../modules/security/http/sessionCookie.js";
import { MariaDbApplicationRepository } from "../../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { PCTEC_INGRESSA_APPLICATION_CODE, PCTEC_PORTAL_APPLICATION_CODE } from "../../modules/application/domain/value-objects/ApplicationCodes.js";
import { AuthorizeApplicationAccessService } from "../../modules/authorization/application/AuthorizeApplicationAccessService.js";
import { createRequireApplicationAccess } from "../../modules/authorization/http/requireApplicationAccess.js";
import { createAdminWhoamiRoutes } from "../../modules/authorization/http/adminRoutes.js";
import { createAdminApiRoutes, type AdminApiDeps } from "../../modules/admin/http/adminApiRoutes.js";
import {
  createHelpdeskImportRoutes,
  type HelpdeskImportApiDeps
} from "../../modules/admin/http/helpdeskImportRoutes.js";
import { composeHelpdeskImport } from "../../modules/import/infrastructure/HelpdeskImportComposition.js";
import {
  createPortalCatalogRoutes,
  type PortalCatalogApiDeps
} from "../../modules/admin/http/portalCatalogRoutes.js";
import { composePortalCatalog } from "../../modules/portal/infrastructure/PortalCatalogComposition.js";
import type { AutoLinkPortalOrganizationReferenceService } from "../../modules/portal/application/AutoLinkPortalOrganizationReferenceService.js";
import { createRequireSafeOrigin } from "../../modules/security/http/requireSafeOrigin.js";
import { MariaDbUnitOfWork } from "../../shared/database/UnitOfWork.js";
import { MariaDbAdminReadRepository } from "../../modules/admin/infrastructure/persistence/MariaDbAdminReadRepository.js";
import { MariaDbAuditEventReadRepository } from "../../modules/audit/infrastructure/MariaDbAuditEventReadRepository.js";
import { RevokeApplicationAccessService } from "../../modules/application/application/RevokeApplicationAccessService.js";
import { CreateMembershipService } from "../../modules/organization/application/CreateMembershipService.js";
import { EndMembershipService } from "../../modules/organization/application/EndMembershipService.js";
import { GrantApplicationAccessService } from "../../modules/application/application/GrantApplicationAccessService.js";
import { ActivateFederatedIdentityService } from "../../modules/helpdesk/application/ActivateFederatedIdentityService.js";
import { MariaDbMembershipRepository } from "../../modules/organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbOrganizationRepository } from "../../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../../modules/organization/infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../../modules/organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { CreateOrganizationExternalReferenceService } from "../../modules/organization/application/CreateOrganizationExternalReferenceService.js";
import { GetPortalOrganizationCoverageService } from "../../modules/organization/application/GetPortalOrganizationCoverageService.js";
import { LinkPortalOrganizationReferenceService } from "../../modules/organization/application/LinkPortalOrganizationReferenceService.js";
import { GetActiveOrganizationExternalReferenceService } from "../../modules/organization/application/GetActiveOrganizationExternalReferenceService.js";
import { GetPortalContextService } from "../../modules/portal/application/GetPortalContextService.js";
import { RequirePortalOrganizationContextPolicy } from "../../modules/portal/application/RequirePortalOrganizationContextPolicy.js";
import { RequireOrganizationAccessService } from "../../modules/portal/application/RequireOrganizationAccessService.js";
import { createPortalContextRoutes } from "../../modules/portal/http/portalContextRoutes.js";
import { createRequireOrganizationAccess } from "../../modules/portal/http/requireOrganizationAccess.js";
import { createOrganizationExternalReferenceRoutes } from "../../modules/portal/http/organizationExternalReferenceRoutes.js";
import { createRequireServiceCredential } from "../../modules/portal/http/requireServiceCredential.js";
import { createServicePortalOrganizationExternalReferenceRoutes } from "../../modules/portal/http/servicePortalOrganizationExternalReferenceRoutes.js";
import { GetActiveIdentityExternalReferenceService } from "../../modules/identity/application/GetActiveIdentityExternalReferenceService.js";
import { MariaDbIdentityExternalReferenceRepository } from "../../modules/identity/infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { createServicePortalIdentityExternalReferenceRoutes } from "../../modules/portal/http/servicePortalIdentityExternalReferenceRoutes.js";
import { createServicePortalIdentityContextRoutes } from "../../modules/portal/http/servicePortalIdentityContextRoutes.js";
import { createServiceHelpdeskUserContextRoutes } from "../../modules/helpdesk/http/serviceHelpdeskUserContextRoutes.js";
import { GetHelpdeskUserContextService } from "../../modules/helpdesk/application/GetHelpdeskUserContextService.js";
import { HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME } from "../../modules/portal/http/requireServiceCredential.js";
import { ResolvePortalTenantScopeService } from "../../modules/portal/application/ResolvePortalTenantScopeService.js";
import { createServicePortalTenantScopeRoutes } from "../../modules/portal/http/servicePortalTenantScopeRoutes.js";
import { composeSso } from "../../modules/sso/infrastructure/SsoComposition.js";
import { IssueAuthorizationCodeService } from "../../modules/sso/application/IssueAuthorizationCodeService.js";
import { ExchangeAuthorizationCodeService } from "../../modules/sso/application/ExchangeAuthorizationCodeService.js";
import { MariaDbAuthorizationCodeRepository } from "../../modules/sso/infrastructure/persistence/MariaDbAuthorizationCodeRepository.js";
import { CryptoAuthorizationCodeGenerator } from "../../modules/sso/infrastructure/token/AuthorizationCodeGenerator.js";
import { createSsoAuthorizeRoutes } from "../../modules/sso/http/ssoAuthorizeRoutes.js";
import { createServiceSsoTokenRoutes } from "../../modules/sso/http/serviceSsoTokenRoutes.js";
import { GetMyApplicationsService } from "../../modules/launcher/application/GetMyApplicationsService.js";
import { MariaDbGrantedApplicationReadRepository } from "../../modules/launcher/infrastructure/persistence/MariaDbGrantedApplicationReadRepository.js";
import { createAppsRoutes } from "../../modules/launcher/http/appsRoutes.js";
import { CreateIdentityInvitationService } from "../../modules/invitation/application/CreateIdentityInvitationService.js";
import { RedeemIdentityInvitationService } from "../../modules/invitation/application/RedeemIdentityInvitationService.js";
import { MariaDbInvitationRepository } from "../../modules/invitation/infrastructure/persistence/MariaDbInvitationRepository.js";
import { MariaDbInvitationEligibilityReadRepository } from "../../modules/invitation/infrastructure/persistence/MariaDbInvitationEligibilityReadRepository.js";
import { CryptoInvitationTokenGenerator } from "../../modules/invitation/infrastructure/token/invitationToken.js";
import { composeInvitationDelivery } from "../../modules/invitation/infrastructure/InvitationComposition.js";
import type { InvitationEmailTransport } from "../../modules/invitation/infrastructure/delivery/SmtpInvitationDelivery.js";
import { createAdminInvitationRoutes } from "../../modules/invitation/http/adminInvitationRoutes.js";
import { createInvitationRoutes } from "../../modules/invitation/http/invitationRoutes.js";
import { BlockIdentityService } from "../../modules/identity/application/BlockIdentityService.js";
import { UnblockIdentityService } from "../../modules/identity/application/UnblockIdentityService.js";
import { RevokeAllSessionsService } from "../../modules/security/application/RevokeAllSessionsService.js";
import { RevokeInvitationService } from "../../modules/invitation/application/RevokeInvitationService.js";
import { RenameOrganizationService } from "../../modules/organization/application/RenameOrganizationService.js";
import { CreateOrganizationRelationshipService } from "../../modules/organization/application/CreateOrganizationRelationshipService.js";
import { CreateOrganizationService } from "../../modules/organization/application/CreateOrganizationService.js";
import { ProvisionOrganizationService } from "../../modules/organization/application/ProvisionOrganizationService.js";
import { ProvisionOrganizationUserService } from "../../modules/admin/application/ProvisionOrganizationUserService.js";
import { CreateIdentityService } from "../../modules/identity/application/CreateIdentityService.js";
import { PCTEC_HELPDESK_APPLICATION_CODE } from "../../modules/application/domain/value-objects/ApplicationCodes.js";

/**
 * Payload fixo de `GET /health`, conforme especificado na v0.4.1 —
 * Runtime Bootstrap. Deliberadamente estático: não consulta banco, não
 * depende de migration, não expõe hostname/IP/memória/versão do Node ou
 * qualquer segredo. `version` é mantido manualmente em sincronia com
 * `package.json` (ver README, seção "Versionamento", para a recomendação
 * de fonte única — não implementada silenciosamente nesta fatia).
 */
const HEALTH_PAYLOAD = Object.freeze({
  status: "ok",
  service: "pctec-ingressa",
  version: "0.5.0"
});

export interface CreateAppOptions {
  /**
   * Injetável para testes (fake/in-memory) — em produção, quando
   * omitido, `createApp()` constrói um `MariaDbIdentityRepository` real
   * a partir de `loadEnv()`. Criar o `Pool` aqui NUNCA abre uma conexão
   * de verdade (mysql2 conecta de forma preguiçosa, só no primeiro
   * `execute()`) — por isso `GET /health` continua funcionando mesmo sem
   * nenhum MariaDB acessível, e `npm test`/`typecheck`/`build` nunca
   * tocam rede.
   */
  readonly identityRepository?: IdentityRepository;
  /**
   * Injetável para testes — v0.6.0, Fase D. Quando omitido, `createApp()`
   * constrói um `LoginService` real (Argon2id real, MariaDB real via
   * `loadEnv()`).
   */
  readonly loginService?: LoginService;
  /**
   * Injetável para testes — v0.6.x, Fase E. Quando omitido,
   * `createApp()` constrói um `LogoutService` real.
   */
  readonly logoutService?: LogoutService;
  /**
   * Injetável para testes — v0.6.x, Fase E. Quando omitido,
   * `createApp()` constrói um `ValidateSessionService` real, usado pelo
   * middleware `requireAuthenticatedSession` (`GET /api/v1/me`).
   */
  readonly validateSessionService?: ValidateSessionService;
  /**
   * Injetável para testes — controla `Secure` do cookie de sessão.
   * Quando omitido, lido de `SESSION_COOKIE_SECURE` (env).
   */
  readonly sessionCookieConfig?: SessionCookieConfig;
  /**
   * Injetável para testes — v0.6.x, Fase E. Lista de origens confiáveis
   * para validação CSRF do logout. Quando omitido, lido de
   * `ALLOWED_ORIGINS` (env).
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Injetável para testes — v0.6.x, Fase F. Quando omitido,
   * `createApp()` constrói um `AuthorizeApplicationAccessService` real,
   * usado pelo middleware `requireApplicationAccess`
   * (`GET /api/v1/admin/whoami`).
   */
  readonly authorizeApplicationAccessService?: AuthorizeApplicationAccessService;
  /**
   * Injetável para testes — G3 (v0.6.x). Quando omitido, `createApp()`
   * constrói um `GetPortalContextService` real, usado por
   * `GET /api/v1/portal/context`.
   */
  readonly getPortalContextService?: GetPortalContextService;
  /**
   * Injetável para testes — P1 Portal (v0.7.x). Quando omitido,
   * `createApp()` constrói um `RequireOrganizationAccessService` real,
   * usado pelo middleware `requireOrganizationAccess` — primeira rota
   * real a montá-lo desde G3.
   */
  readonly requireOrganizationAccessService?: RequireOrganizationAccessService;
  /**
   * Injetável para testes — P1 Portal (v0.7.x). Quando omitido,
   * `createApp()` constrói um `GetActiveOrganizationExternalReferenceService`
   * real, usado por
   * `GET /api/v1/portal/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`.
   */
  readonly getActiveOrganizationExternalReferenceService?: GetActiveOrganizationExternalReferenceService;
  /**
   * Injetável para testes — P1A.1 (v0.7.x). Quando omitido, lido de
   * `INGRESSA_PORTAL_SERVICE_CREDENTIAL` (env). String vazia (default
   * do schema) significa "rota `/api/v1/service/portal/...`
   * indisponível" — fail-closed absoluto, nunca um segredo funcional
   * por omissão.
   */
  readonly serviceCredential?: string;
  /**
   * Credencial do consumidor Helpdesk — separada da do Portal por
   * decisão de contrato. Ausente/vazia, só a rota
   * `/api/v1/service/helpdesk/...` fica indisponível (401).
   */
  readonly helpdeskServiceCredential?: string;
  /** Injetável para teste; por padrão é composto aqui a partir dos demais. */
  readonly getHelpdeskUserContextService?: GetHelpdeskUserContextService;
  /** Injetável para teste da API administrativa (v0.9.x). */
  readonly adminApi?: AdminApiDeps;
  /**
   * Injetável para teste do assistente de importação (v0.10.x).
   *
   * Quando omitido, `createApp()` tenta montar o assistente real a
   * partir de `loadHelpdeskSourceConfig()`. Faltando a configuração da
   * fonte, as rotas do assistente respondem 503 — nunca somem
   * silenciosamente e nunca operam com credencial adivinhada.
   */
  readonly helpdeskImport?: HelpdeskImportApiDeps;
  /**
   * Injetável para teste do catálogo administrativo do Portal.
   *
   * Quando omitido, `createApp()` tenta montar o catálogo real a partir
   * de `loadPortalSourceConfig()`. Faltando a configuração da fonte, as
   * rotas do catálogo respondem 503 — nunca somem silenciosamente e
   * nunca operam com credencial adivinhada. O restante da API,
   * inclusive login e o vínculo manual ao Portal, segue funcionando.
   */
  readonly portalCatalog?: PortalCatalogApiDeps;
  /**
   * Injetável para testes — P1B.0 Fatia 4 (v0.7.x). Quando omitido,
   * `createApp()` constrói um `GetActiveIdentityExternalReferenceService`
   * real, usado por
   * `GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId`.
   */
  readonly getActiveIdentityExternalReferenceService?: GetActiveIdentityExternalReferenceService;
  /**
   * Injetável para testes — P1D (v0.7.x). Quando omitido, `createApp()`
   * constrói um `ResolvePortalTenantScopeService` real, usado por
   * `GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/tenant-scope`.
   */
  readonly resolvePortalTenantScopeService?: ResolvePortalTenantScopeService;
  /**
   * Injetáveis para teste — v1.0 (autenticação central + launcher).
   * Quando omitidos, `createApp()` compõe as versões reais a partir de
   * `loadEnv()` e do pool compartilhado.
   */
  readonly issueAuthorizationCodeService?: IssueAuthorizationCodeService;
  readonly exchangeAuthorizationCodeService?: ExchangeAuthorizationCodeService;
  readonly getMyApplicationsService?: GetMyApplicationsService;
  readonly createIdentityInvitationService?: CreateIdentityInvitationService;
  readonly redeemIdentityInvitationService?: RedeemIdentityInvitationService;
  /**
   * Dublê de transporte SMTP para teste (v1.0). Em produção fica sempre
   * ausente e `composeInvitationDelivery` constrói o transporte real a
   * partir de `INGRESSA_SMTP_*` — nunca o contrário: um teste que
   * esquecesse de injetar não pode acabar falando com um servidor SMTP
   * de verdade.
   */
  readonly invitationEmailTransport?: InvitationEmailTransport;
}

/**
 * Pool único, compartilhado entre `IdentityRepository` e `LoginService`
 * quando nenhum dos dois é injetado — evita abrir dois pools mysql2
 * separados para o mesmo banco. Nunca abre conexão de verdade aqui
 * (mysql2 é preguiçoso).
 */
function createDefaultPool(): ReturnType<typeof createPool> {
  const env = loadEnv();
  return createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });
}

function defaultLoginService(pool: ReturnType<typeof createPool>): LoginService {
  const env = loadEnv();
  return new LoginService(
    pool,
    (connection) => new MariaDbIdentityRepository(connection),
    (connection) => new MariaDbCredentialRepository(connection),
    (connection) => new MariaDbSessionRepository(connection),
    (connection) => new MariaDbAuditEventRepository(connection),
    new Argon2PasswordHasher(),
    new CryptoSessionTokenGenerator(),
    env.SESSION_TTL_SECONDS
  );
}

function defaultLogoutService(pool: ReturnType<typeof createPool>): LogoutService {
  return new LogoutService(
    pool,
    (connection) => new MariaDbSessionRepository(connection),
    (connection) => new MariaDbIdentityRepository(connection),
    (connection) => new MariaDbAuditEventRepository(connection)
  );
}

function defaultValidateSessionService(
  pool: ReturnType<typeof createPool>,
  identityRepository: IdentityRepository
): ValidateSessionService {
  return new ValidateSessionService(new MariaDbSessionRepository(pool), identityRepository);
}

function defaultAuthorizeApplicationAccessService(
  pool: ReturnType<typeof createPool>
): AuthorizeApplicationAccessService {
  return new AuthorizeApplicationAccessService(
    new MariaDbApplicationRepository(pool),
    new MariaDbApplicationAccessRepository(pool)
  );
}

function defaultGetPortalContextService(pool: ReturnType<typeof createPool>): GetPortalContextService {
  return new GetPortalContextService(
    new MariaDbMembershipRepository(pool),
    new MariaDbOrganizationRepository(pool),
    new MariaDbOrganizationRelationshipRepository(pool)
  );
}

function defaultRequireOrganizationAccessService(
  pool: ReturnType<typeof createPool>
): RequireOrganizationAccessService {
  return new RequireOrganizationAccessService(defaultGetPortalContextService(pool));
}

function defaultGetActiveOrganizationExternalReferenceService(
  pool: ReturnType<typeof createPool>
): GetActiveOrganizationExternalReferenceService {
  return new GetActiveOrganizationExternalReferenceService(new MariaDbOrganizationExternalReferenceRepository(pool));
}

function defaultResolvePortalTenantScopeService(
  pool: ReturnType<typeof createPool>,
  getActiveOrganizationExternalReferenceService: GetActiveOrganizationExternalReferenceService
): ResolvePortalTenantScopeService {
  return new ResolvePortalTenantScopeService(
    new MariaDbOrganizationRepository(pool),
    new MariaDbOrganizationRelationshipRepository(pool),
    getActiveOrganizationExternalReferenceService
  );
}

/**
 * Router do assistente — montado sempre, funcional só quando a fonte
 * está configurada.
 *
 * A configuração da fonte Helpdesk (`HELPDESK_DB_*`) vive fora do
 * `.env` do backend, num env-file próprio de permissão 600, e o
 * processo do servidor pode legitimamente não tê-la. Três respostas
 * seriam possíveis e duas são erradas:
 *
 *  - **derrubar o boot** puniria todo o resto da API por causa de uma
 *    funcionalidade opcional: login, portal e contexto do Helpdesk
 *    parariam junto;
 *  - **não montar a rota** devolveria 404, que significa "não existe" —
 *    e a rota existe, o que falta é configuração. Quem operasse iria
 *    procurar erro de digitação na URL;
 *  - **503 com código próprio** diz a verdade: a funcionalidade existe,
 *    está indisponível, e o motivo é configuração ausente.
 *
 * Fail-closed em qualquer caso: sem credencial da fonte, nada é lido e
 * nada é escrito. Nunca há default de host, usuário ou senha.
 */
function helpdeskImportRouter(
  options: CreateAppOptions,
  ingressaPool: Pool | undefined,
  portalAutoLinkService: AutoLinkPortalOrganizationReferenceService | undefined
): Router {
  if (options.helpdeskImport !== undefined) {
    return createHelpdeskImportRoutes(options.helpdeskImport);
  }

  try {
    const composicao = composeHelpdeskImport(ingressaPool!, portalAutoLinkService);
    return createHelpdeskImportRoutes({
      catalogService: composicao.catalogService,
      wizardService: composicao.wizardService
    });
  } catch (error) {
    // A mensagem do erro de configuração lista NOMES de variável, nunca
    // valores (ver `MissingHelpdeskSourceConfigError`) — um erro de
    // configuração não pode ser o caminho pelo qual a senha aparece num
    // log de operação. Ainda assim ela não vai para a resposta HTTP:
    // quem está do lado de fora não precisa da lista.
    const motivo = error instanceof Error ? error.message : String(error);
    const router = Router();
    router.use((_req, res: Response) => {
      res.status(503).json({
        error: {
          code: "IMPORT_WIZARD_SOURCE_NOT_CONFIGURED",
          message:
            "Assistente de importação indisponível: a configuração da fonte Helpdesk não está presente neste processo.",
          details: []
        }
      });
    });
    // Registrado uma vez, no boot, para que a indisponibilidade seja
    // diagnosticável sem precisar reproduzir a requisição.
    // eslint-disable-next-line no-console -- diagnóstico de boot, sem valor de credencial.
    console.warn(`[helpdesk-import] rotas do assistente indisponíveis: ${motivo}`);
    return router;
  }
}

/**
 * Catálogo administrativo do Portal — montado sempre, funcional só
 * quando a fonte está configurada.
 *
 * Mesma decisão do assistente de importação, pelas mesmas três razões:
 * derrubar o boot puniria login e todo o resto por causa de uma
 * funcionalidade opcional; não montar a rota devolveria 404 ("não
 * existe") quando a verdade é "existe, falta configuração"; 503 com
 * código próprio diz o que é.
 *
 * A diferença em relação ao assistente é o que sobrevive à falta de
 * configuração: **o vínculo manual ao Portal continua inteiro**. A rota
 * `POST /admin/organizations/:publicId/portal-reference` não depende da
 * fonte — o ADMIN que souber o `legacyId` segue vinculando. O que fica
 * indisponível é a parte que existe para ele NÃO precisar saber.
 *
 * Devolve também o serviço de vínculo automático, `undefined` quando a
 * fonte não está configurada: a criação manual de COMPANY usa esse
 * mesmo objeto e precisa distinguir "não bateu" de "nem foi possível
 * perguntar".
 */
function portalCatalogRouter(
  options: CreateAppOptions,
  ingressaPool: Pool | undefined,
  linkService: LinkPortalOrganizationReferenceService,
  allowedOrigins: readonly string[]
): { readonly router: Router; readonly autoLinkService: AutoLinkPortalOrganizationReferenceService | undefined } {
  if (options.portalCatalog !== undefined) {
    return {
      router: createPortalCatalogRoutes(options.portalCatalog, allowedOrigins),
      autoLinkService: undefined
    };
  }

  try {
    const composicao = composePortalCatalog(ingressaPool!, linkService);
    return {
      router: createPortalCatalogRoutes(
        {
          catalogService: composicao.catalogService,
          matchService: composicao.matchService,
          reconciliationService: composicao.reconciliationService,
          confirmSelectionService: composicao.confirmSelectionService
        },
        allowedOrigins
      ),
      autoLinkService: composicao.autoLinkService
    };
  } catch (error) {
    // A mensagem do erro de configuração lista NOMES de variável, nunca
    // valores (ver `MissingPortalSourceConfigError`). Ainda assim ela
    // não vai para a resposta HTTP: quem está do lado de fora não
    // precisa da lista, e ela não deve aparecer num log de navegador.
    const motivo = error instanceof Error ? error.message : String(error);
    const router = Router();
    router.use((_req, res: Response) => {
      res.status(503).json({
        error: {
          code: PORTAL_CATALOG_SOURCE_NOT_CONFIGURED,
          message:
            "Catálogo do Portal indisponível: a configuração da fonte não está presente neste processo. " +
            "O vínculo manual pelo id do cliente continua funcionando.",
          details: []
        }
      });
    });
    // Registrado uma vez, no boot, para que a indisponibilidade seja
    // diagnosticável sem precisar reproduzir a requisição.
    // eslint-disable-next-line no-console -- diagnóstico de boot, sem valor de credencial.
    console.warn(`[portal-catalog] rotas do catálogo indisponíveis: ${motivo}`);
    return { router, autoLinkService: undefined };
  }
}

/** Código estável da indisponibilidade — a UI distingue "não bateu" de "não deu para perguntar". */
export const PORTAL_CATALOG_SOURCE_NOT_CONFIGURED = "PORTAL_CATALOG_SOURCE_NOT_CONFIGURED";

/**
 * Cria a aplicação Express, sem abrir porta nenhuma — quem decide
 * `listen()` é `server.ts`. Separar `createApp` de `server.ts` permite
 * testar toda a camada HTTP com `fetch` contra um servidor efêmero nos
 * testes, sem depender de uma porta de rede real fixa.
 *
 * Escopo desta fatia (v0.5.0 Slice 1): `GET /health` (já existente) +
 * `GET /api/v1/identities/:publicId` (novo, somente leitura). Nenhuma
 * outra rota, nenhuma autenticação, nenhum middleware de
 * CORS/rate-limit/trust-proxy — todos fora de escopo aqui (não há Nginx
 * na frente da API de Identity ainda; só `/health` é exposto pelo Nginx
 * DEV).
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Pool compartilhado — só construído se algo precisar dele (nenhuma
  // conexão real é aberta pela simples criação do Pool).
  const needsDefaultPool =
    options.identityRepository === undefined ||
    options.loginService === undefined ||
    options.logoutService === undefined ||
    options.validateSessionService === undefined ||
    options.authorizeApplicationAccessService === undefined ||
    options.getPortalContextService === undefined ||
    options.requireOrganizationAccessService === undefined ||
    options.getActiveOrganizationExternalReferenceService === undefined ||
    options.getActiveIdentityExternalReferenceService === undefined ||
    options.getHelpdeskUserContextService === undefined ||
    options.resolvePortalTenantScopeService === undefined ||
    options.issueAuthorizationCodeService === undefined ||
    options.exchangeAuthorizationCodeService === undefined ||
    options.getMyApplicationsService === undefined ||
    options.createIdentityInvitationService === undefined ||
    options.redeemIdentityInvitationService === undefined;
  const sharedPool = needsDefaultPool ? createDefaultPool() : undefined;

  const identityRepository = options.identityRepository ?? new MariaDbIdentityRepository(sharedPool!);
  const getIdentityByPublicId = new GetIdentityByPublicIdService(identityRepository);

  const loginService = options.loginService ?? defaultLoginService(sharedPool!);
  const logoutService = options.logoutService ?? defaultLogoutService(sharedPool!);
  const validateSessionService =
    options.validateSessionService ?? defaultValidateSessionService(sharedPool!, identityRepository);
  const authorizeApplicationAccessService =
    options.authorizeApplicationAccessService ?? defaultAuthorizeApplicationAccessService(sharedPool!);
  const getPortalContextService =
    options.getPortalContextService ?? defaultGetPortalContextService(sharedPool!);
  const requireOrganizationAccessService =
    options.requireOrganizationAccessService ?? defaultRequireOrganizationAccessService(sharedPool!);
  const getActiveOrganizationExternalReferenceService =
    options.getActiveOrganizationExternalReferenceService ??
    defaultGetActiveOrganizationExternalReferenceService(sharedPool!);
  const getActiveIdentityExternalReferenceService =
    options.getActiveIdentityExternalReferenceService ??
    new GetActiveIdentityExternalReferenceService(new MariaDbIdentityExternalReferenceRepository(sharedPool!));
  // Contexto do Helpdesk — composição, não redesenho: os quatro
  // colaboradores são os MESMOS já usados pelo Portal, nas mesmas
  // instâncias construídas acima.
  const getHelpdeskUserContextService =
    options.getHelpdeskUserContextService ??
    new GetHelpdeskUserContextService(
      getActiveIdentityExternalReferenceService,
      new MariaDbIdentityExternalReferenceRepository(sharedPool!),
      identityRepository,
      authorizeApplicationAccessService,
      getPortalContextService,
      new MariaDbOrganizationExternalReferenceRepository(sharedPool!)
    );
  const resolvePortalTenantScopeService =
    options.resolvePortalTenantScopeService ??
    defaultResolvePortalTenantScopeService(sharedPool!, getActiveOrganizationExternalReferenceService);
  const sessionCookieConfig: SessionCookieConfig = options.sessionCookieConfig ?? {
    secure: loadEnv().SESSION_COOKIE_SECURE
  };
  const allowedOrigins = options.allowedOrigins ?? loadEnv().ALLOWED_ORIGINS;
  const serviceCredential = options.serviceCredential ?? loadEnv().INGRESSA_PORTAL_SERVICE_CREDENTIAL;
  const helpdeskServiceCredential =
    options.helpdeskServiceCredential ?? loadEnv().INGRESSA_HELPDESK_SERVICE_CREDENTIAL;

  // --- Autenticação central + launcher (v1.0) --------------------------
  //
  // Toda a composição abaixo reaproveita instâncias JÁ construídas
  // acima: `authorizeApplicationAccessService` (Application ACTIVE +
  // ApplicationAccess GRANTED + perfil) e `getPortalContextService`
  // (Membership ACTIVE + expansão + deduplicação) são exatamente os
  // mesmos objetos que servem `/api/v1/portal` e
  // `/api/v1/service/portal`. O SSO não reimplementa nenhuma dessas
  // regras — se um dia a regra mudar, muda em um lugar só.
  const env = loadEnv();
  const sso = composeSso({
    portalRedirectUris: env.SSO_PORTAL_REDIRECT_URIS,
    portalLaunchUrl: env.SSO_PORTAL_LAUNCH_URL,
    // A exigência de contexto organizacional é do PRODUTO Portal e é
    // declarada aqui, na composição — o módulo `sso` não conhece
    // Membership, Organization nem `GetPortalContextService`. Reaproveita
    // a MESMA instância que serve `/api/v1/portal/context`.
    portalIssuancePolicies: [new RequirePortalOrganizationContextPolicy(getPortalContextService)]
  });
  const unitOfWork = sharedPool === undefined ? undefined : new MariaDbUnitOfWork(sharedPool);

  const issueAuthorizationCodeService =
    options.issueAuthorizationCodeService ??
    new IssueAuthorizationCodeService(
      unitOfWork!,
      (c) => new MariaDbIdentityRepository(c),
      (c) => new MariaDbApplicationRepository(c),
      (c) => new MariaDbAuthorizationCodeRepository(c),
      (c) => new MariaDbAuditEventRepository(c),
      authorizeApplicationAccessService,
      sso.issuancePolicyRegistry,
      new CryptoAuthorizationCodeGenerator(),
      env.SSO_AUTHORIZATION_CODE_TTL_SECONDS
    );

  const exchangeAuthorizationCodeService =
    options.exchangeAuthorizationCodeService ??
    new ExchangeAuthorizationCodeService(
      unitOfWork!,
      (c) => new MariaDbAuthorizationCodeRepository(c),
      (c) => new MariaDbApplicationRepository(c),
      (c) => new MariaDbAuditEventRepository(c),
      identityRepository,
      authorizeApplicationAccessService
    );

  // Destinos dos cards. `PCTEC_INGRESSA` aponta para um caminho RELATIVO
  // (a própria UI administrativa) e os outros para URLs absolutas dos
  // respectivos produtos — o card do Portal leva ao endpoint que INICIA
  // o SSO lá, porque o `code_challenge` é do cliente e só ele pode
  // gerá-lo. Entrada vazia vira card desabilitado, nunca card ausente.
  const launchUrlByApplicationCode: Record<string, string> = { [PCTEC_INGRESSA_APPLICATION_CODE]: "/admin" };
  if (env.SSO_PORTAL_LAUNCH_URL.trim().length > 0) {
    launchUrlByApplicationCode[PCTEC_PORTAL_APPLICATION_CODE] = env.SSO_PORTAL_LAUNCH_URL;
  }
  if (env.HELPDESK_LAUNCH_URL.trim().length > 0) {
    launchUrlByApplicationCode[PCTEC_HELPDESK_APPLICATION_CODE] = env.HELPDESK_LAUNCH_URL;
  }

  const getMyApplicationsService =
    options.getMyApplicationsService ??
    new GetMyApplicationsService(
      identityRepository,
      new MariaDbGrantedApplicationReadRepository(sharedPool!),
      launchUrlByApplicationCode
    );

  const createIdentityInvitationService =
    options.createIdentityInvitationService ??
    new CreateIdentityInvitationService(
      unitOfWork!,
      new MariaDbInvitationEligibilityReadRepository(sharedPool!),
      (c) => new MariaDbInvitationRepository(c),
      (c) => new MariaDbAuditEventRepository(c),
      new CryptoInvitationTokenGenerator(),
      composeInvitationDelivery(
        {
          mode: env.INVITATION_DELIVERY_MODE,
          smtpHost: env.INGRESSA_SMTP_HOST,
          smtpPort: env.INGRESSA_SMTP_PORT,
          smtpUser: env.INGRESSA_SMTP_USER,
          smtpPassword: env.INGRESSA_SMTP_PASSWORD,
          smtpFrom: env.INGRESSA_SMTP_FROM,
          smtpSecure: env.INGRESSA_SMTP_SECURE,
          // TLS obrigatório em produção — nunca configurável para menos.
          requireTls: env.NODE_ENV === "production"
        },
        options.invitationEmailTransport
      ),
      env.INVITATION_TTL_SECONDS,
      env.INGRESSA_PUBLIC_BASE_URL
    );

  const redeemIdentityInvitationService =
    options.redeemIdentityInvitationService ??
    new RedeemIdentityInvitationService(
      unitOfWork!,
      (c) => new MariaDbInvitationRepository(c),
      (c) => new MariaDbIdentityRepository(c),
      (c) => new MariaDbCredentialRepository(c),
      (c) => new MariaDbAuditEventRepository(c),
      new Argon2PasswordHasher(),
      new MariaDbInvitationRepository(sharedPool!),
      identityRepository
    );

  // Não anunciar a tecnologia do servidor em nenhuma resposta.
  app.disable("x-powered-by");

  // Corpo de requisição pequeno e explícito — `POST /api/v1/sessions`
  // (v0.6.0) é a primeira rota desta fatia que de fato usa body; o
  // limite de 10kb já existia por precaução deliberada, mais que
  // suficiente para um payload de e-mail/senha.
  app.use(express.json({ limit: "10kb" }));

  // Conforme API-CONTRACT-V1.md: todo request/response carrega
  // X-Correlation-Id (gerado se ausente/inválido).
  app.use(correlationIdMiddleware);

  app.get("/health", (_req, res: Response) => {
    res.status(200).json(HEALTH_PAYLOAD);
  });

  app.use("/api/v1/identities", createIdentityRoutes(getIdentityByPublicId));
  app.use("/api/v1/sessions", createSessionRoutes(loginService, logoutService, sessionCookieConfig, allowedOrigins));
  // GET /api/v1/me — protegida por requireAuthenticatedSession, montado
  // ANTES do router de fato (v0.6.x, Fase E). Nunca resolve
  // ApplicationAccess/ADMIN/roles — só autenticação (task, seção 13).
  app.use(
    "/api/v1/me",
    createRequireAuthenticatedSession(validateSessionService),
    createMeRoutes()
  );
  // GET /api/v1/apps — painel "Meus aplicativos" (v1.0). Autenticação e
  // SÓ autenticação: este é o painel de qualquer pessoa que entra, não
  // uma rota administrativa. Os cards vêm de ApplicationAccess GRANTED,
  // resolvido no service — o cliente não filtra nada.
  app.use("/api/v1/apps", createRequireAuthenticatedSession(validateSessionService), createAppsRoutes(getMyApplicationsService));

  // GET /api/v1/sso/authorize — entrada do fluxo SSO, vinda do
  // navegador. Deliberadamente SEM `createRequireAuthenticatedSession`
  // na cadeia: o middleware responde 401 em JSON, e aqui a resposta
  // certa para "sem sessão" é mandar a pessoa para o login com o retorno
  // preservado. A validação de sessão acontece dentro da rota, com o
  // MESMO `ValidateSessionService`.
  app.use("/api/v1/sso", createSsoAuthorizeRoutes(sso.registry, validateSessionService, issueAuthorizationCodeService, sso.requiredProfileByClientId));

  // POST /api/v1/invitations/{preview,redeem} — rotas PÚBLICAS do
  // convite de primeiro acesso. Quem as usa ainda não tem credencial; a
  // autorização é o token de uso único, enviado no CORPO (nunca na URL).
  app.use("/api/v1/invitations", createInvitationRoutes(redeemIdentityInvitationService));

  // POST /api/v1/admin/invitations — emissão administrativa. Montada no
  // próprio prefixo, ANTES do /api/v1/admin genérico, pelo mesmo motivo
  // documentado no assistente de importação: a guarda de origem vale
  // para este router inteiro sem transformar 404 de rota inexistente em
  // 403 enganoso no resto da administração.
  app.use(
    "/api/v1/admin/invitations",
    createRequireAuthenticatedSession(validateSessionService),
    createRequireApplicationAccess(authorizeApplicationAccessService, {
      applicationCode: PCTEC_INGRESSA_APPLICATION_CODE,
      profile: "ADMIN"
    }),
    createRequireSafeOrigin(allowedOrigins),
    createAdminInvitationRoutes(createIdentityInvitationService)
  );

  /**
   * Vínculo da COMPANY ao Portal — UMA montagem, DOIS consumidores.
   *
   * A rota administrativa de vínculo manual e o vínculo automático por
   * CNPJ escrevem pelo MESMO serviço, com o `SELECT ... FOR UPDATE`, a
   * idempotência e a auditoria dele. Montá-lo duas vezes daria dois
   * caminhos de escrita que divergem no primeiro ajuste feito de um
   * lado só — e o sintoma seria uma empresa apontando para o cliente
   * errado.
   */
  const vinculoDoPortal = new LinkPortalOrganizationReferenceService(
    new MariaDbUnitOfWork(sharedPool!),
    (c) => new MariaDbOrganizationRepository(c),
    (c) => new MariaDbOrganizationExternalReferenceRepository(c),
    (uow) =>
      new CreateOrganizationExternalReferenceService(
        uow,
        (c) => new MariaDbOrganizationRepository(c),
        (c) => new MariaDbOrganizationExternalReferenceRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      )
  );
  const catalogoDoPortal = portalCatalogRouter(options, sharedPool, vinculoDoPortal, allowedOrigins);

  // Assistente de importação Helpdesk (v0.10.x) — MESMA cadeia de
  // autorização do restante de /api/v1/admin (sessão → Identity ACTIVE →
  // ADMIN em PCTEC_INGRESSA), MAIS a guarda de origem.
  //
  // Montado no próprio prefixo, ANTES do /api/v1/admin genérico, em vez
  // de encaixado no meio da cadeia dele. A diferença é observável: como
  // middleware do router administrativo inteiro, a guarda de origem
  // passaria a responder 403 a qualquer método mutável que nenhuma rota
  // administrativa atende — trocando o 404 correto ("essa rota não
  // existe") por um 403 enganoso ("sua origem não é confiável").
  //
  // A guarda vale para o router inteiro do assistente, incluindo as
  // rotas que ainda não existem: montada aqui, a rota nova nasce
  // protegida, e desprotegê-la exige um ato deliberado.
  //
  // Montado DEPOIS do catálogo do Portal porque recebe o vínculo
  // automático dele — o MESMO objeto da criação manual e da
  // reconciliação. `undefined` quando a fonte não está configurada, e
  // nesse caso o assistente segue funcionando inteiro: o APPLY responde
  // `SOURCE_NOT_CONFIGURED` na integração e não vincula nada.
  app.use(
    "/api/v1/admin/helpdesk-import",
    createRequireAuthenticatedSession(validateSessionService),
    createRequireApplicationAccess(authorizeApplicationAccessService, {
      applicationCode: PCTEC_INGRESSA_APPLICATION_CODE,
      profile: "ADMIN"
    }),
    createRequireSafeOrigin(allowedOrigins),
    helpdeskImportRouter(options, sharedPool, catalogoDoPortal.autoLinkService)
  );

  // Catálogo administrativo do Portal (v0.12.x) — MESMA cadeia do
  // restante de /api/v1/admin (sessão → Identity ACTIVE → ADMIN em
  // PCTEC_INGRESSA). A guarda de origem fica ROTA A ROTA dentro do
  // router, e não aqui: das quatro rotas, três são leitura pura, e
  // montar a guarda no prefixo transformaria o 404 de rota inexistente
  // em 403 enganoso.
  //
  // Prefixo próprio, ANTES do /api/v1/admin genérico, pelo mesmo motivo
  // do assistente de importação — e por um a mais: sem a configuração
  // da fonte, este router inteiro responde 503, e nada mais em
  // /api/v1/admin é afetado.
  app.use(
    "/api/v1/admin/portal-catalog",
    createRequireAuthenticatedSession(validateSessionService),
    createRequireApplicationAccess(authorizeApplicationAccessService, {
      applicationCode: PCTEC_INGRESSA_APPLICATION_CODE,
      profile: "ADMIN"
    }),
    catalogoDoPortal.router
  );
  /**
   * Cobertura do Portal de uma organização — leitura pura, composta dos
   * repositórios oficiais, sobre o pool.
   *
   * Uma FÁBRICA e não uma instância: o literal de `options.adminApi ??
   * {...}` só é avaliado quando ninguém injeta as dependências (testes
   * injetam), e construir isto fora dele criaria repositórios sobre um
   * pool que talvez nem exista naquele modo. O serviço não guarda
   * estado, então duas instâncias respondem a mesma coisa — o que
   * precisa ser único é a DEFINIÇÃO de "coberto", e ela é uma só.
   */
  const criarCoberturaDoPortal = (): GetPortalOrganizationCoverageService =>
    new GetPortalOrganizationCoverageService(
      new MariaDbOrganizationRepository(sharedPool!),
      new MariaDbOrganizationRelationshipRepository(sharedPool!),
      new MariaDbOrganizationExternalReferenceRepository(sharedPool!)
    );
  // GET /api/v1/admin/whoami — v0.6.x, Fase F. Ordem OBRIGATÓRIA:
  // requireAuthenticatedSession (autenticação) SEMPRE antes de
  // requireApplicationAccess (autorização) — nunca o contrário (task,
  // seção 15). ADMIN/applicationAccesses continuam fora de
  // req.auth/AuthenticatedPrincipal — só em req.authorization, anexado
  // pelo segundo middleware.
  app.use(
    "/api/v1/admin",
    createRequireAuthenticatedSession(validateSessionService),
    createRequireApplicationAccess(authorizeApplicationAccessService, {
      applicationCode: PCTEC_INGRESSA_APPLICATION_CODE,
      profile: "ADMIN"
    }),
    createAdminWhoamiRoutes(getIdentityByPublicId),
    // API administrativa da UI (v0.9.x) — MESMO namespace, MESMA cadeia
    // (sessão → ADMIN em PCTEC_INGRESSA), montada uma vez só. Leitura é
    // projeção paginada; toda mutação delega ao Application Service que
    // já detém a regra.
    createAdminApiRoutes(
      options.adminApi ?? {
        readRepository: new MariaDbAdminReadRepository(sharedPool!),
        // A MESMA composição em dois consumidores: a tela de detalhes
        // (que mostra a cobertura) e o gate do provisionamento (que
        // recusa com base nela). Leitura pura sobre o pool — sem
        // transação, porque nada aqui escreve.
        portalOrganizationCoverageService: criarCoberturaDoPortal(),
        // Vínculo administrativo da COMPANY ao Portal. A ESCRITA continua
        // sendo do serviço oficial de criação de referência externa, com
        // a transação e a auditoria dele; este serviço só decide quando
        // ela é legítima.
        // Tudo numa transação só: o serviço abre a dele, bloqueia a linha
        // da Organization (`FOR UPDATE`) e passa `ExistingConnectionUnitOfWork`
        // ao serviço oficial de criação — que assim escreve DENTRO dela,
        // com o Aggregate, o evento e a auditoria de sempre. Uma segunda
        // transação aqui reabriria a janela de corrida que este desenho
        // fecha.
        linkPortalOrganizationReferenceService: vinculoDoPortal,
        // Correspondência automática por CNPJ na criação manual de
        // COMPANY. `undefined` quando a fonte do Portal não está
        // configurada — e a rota diz isso à tela em vez de fingir que
        // não houve correspondência.
        ...(catalogoDoPortal.autoLinkService !== undefined
          ? { autoLinkPortalReferenceService: catalogoDoPortal.autoLinkService }
          : {}),
        // Projeção de leitura da auditoria — contrato separado do
        // repositório de ESCRITA, que segue append-only e sem consulta.
        auditEventReadRepository: new MariaDbAuditEventReadRepository(sharedPool!),
        grantApplicationAccessService: new GrantApplicationAccessService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbApplicationRepository(c),
          (c) => new MariaDbIdentityRepository(c),
          (c) => new MariaDbApplicationAccessRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        revokeApplicationAccessService: new RevokeApplicationAccessService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbApplicationAccessRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        createMembershipService: new CreateMembershipService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbIdentityRepository(c),
          (c) => new MariaDbOrganizationRepository(c),
          (c) => new MariaDbMembershipRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        endMembershipService: new EndMembershipService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbMembershipRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        blockIdentityService: new BlockIdentityService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbIdentityRepository(c),
          (c) => new MariaDbSessionRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        unblockIdentityService: new UnblockIdentityService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbIdentityRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        revokeAllSessionsService: new RevokeAllSessionsService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbSessionRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        renameOrganizationService: new RenameOrganizationService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbOrganizationRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        createOrganizationRelationshipService: new CreateOrganizationRelationshipService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbOrganizationRepository(c),
          (c) => new MariaDbOrganizationRelationshipRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        // Provisionamento (v0.11.x). Os serviços compostos recebem
        // FÁBRICAS de UnitOfWork, não instâncias: dentro da transação
        // externa eles são reconstruídos sobre
        // `ExistingConnectionUnitOfWork`, e é isso que faz as escritas
        // caírem todas na MESMA transação em vez de uma por serviço.
        provisionOrganizationService: new ProvisionOrganizationService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbOrganizationRepository(c),
          (uow) =>
            new CreateOrganizationService(
              uow,
              (c) => new MariaDbOrganizationRepository(c),
              (c) => new MariaDbAuditEventRepository(c)
            ),
          (uow) =>
            new CreateOrganizationRelationshipService(
              uow,
              (c) => new MariaDbOrganizationRepository(c),
              (c) => new MariaDbOrganizationRelationshipRepository(c),
              (c) => new MariaDbAuditEventRepository(c)
            )
        ),
        provisionOrganizationUserService: new ProvisionOrganizationUserService({
          unitOfWork: new MariaDbUnitOfWork(sharedPool!),
          organizationRepositoryFactory: (c) => new MariaDbOrganizationRepository(c),
          identityRepositoryFactory: (c) => new MariaDbIdentityRepository(c),
          applicationRepositoryFactory: (c) => new MariaDbApplicationRepository(c),
          auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c),
          createIdentityServiceFactory: (uow) =>
            new CreateIdentityService(
              uow,
              (c) => new MariaDbIdentityRepository(c),
              (c) => new MariaDbAuditEventRepository(c)
            ),
          createMembershipServiceFactory: (uow) =>
            new CreateMembershipService(
              uow,
              (c) => new MariaDbIdentityRepository(c),
              (c) => new MariaDbOrganizationRepository(c),
              (c) => new MariaDbMembershipRepository(c),
              (c) => new MariaDbAuditEventRepository(c)
            ),
          grantApplicationAccessServiceFactory: (uow) =>
            new GrantApplicationAccessService(
              uow,
              (c) => new MariaDbApplicationRepository(c),
              (c) => new MariaDbIdentityRepository(c),
              (c) => new MariaDbApplicationAccessRepository(c),
              (c) => new MariaDbAuditEventRepository(c)
            ),
          // Fora das fábricas de propósito: a cobertura é conferida
          // ANTES de a transação abrir, e por isso vive no pool.
          portalOrganizationCoverageService: criarCoberturaDoPortal()
        }),
        // O MESMO serviço já montado para a tela de convites — uma
        // implementação só da regra de elegibilidade.
        createIdentityInvitationService,
        revokeInvitationService: new RevokeInvitationService(
          new MariaDbUnitOfWork(sharedPool!),
          (c) => new MariaDbInvitationRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        ),
        activateFederatedIdentityService: new ActivateFederatedIdentityService({
          unitOfWork: new MariaDbUnitOfWork(sharedPool!),
          identityRepositoryFactory: (c) => new MariaDbIdentityRepository(c),
          identityExternalReferenceRepositoryFactory: (c) => new MariaDbIdentityExternalReferenceRepository(c),
          applicationRepositoryFactory: (c) => new MariaDbApplicationRepository(c),
          applicationAccessRepositoryFactory: (c) => new MariaDbApplicationAccessRepository(c),
          auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c)
        })
      },
      allowedOrigins
    )
  );
  // GET /api/v1/portal/context — G3 (v0.6.x). Mesma ordem obrigatória:
  // requireAuthenticatedSession (autenticação) SEMPRE antes de
  // requireApplicationAccess (autorização). PCTEC_PORTAL é uma
  // Application DISTINTA de PCTEC_INGRESSA (ADR-031 §1) — um ADMIN de
  // PCTEC_INGRESSA sem ApplicationAccess(PCTEC_PORTAL, USER) próprio
  // recebe 403 aqui, mesmo sendo administrador da plataforma (task G3,
  // seção 6, testado explicitamente). `requireOrganizationAccess`
  // (módulo portal) NÃO é montado em nenhuma rota nesta entrega — task
  // G3, seção 22 ("não inventar endpoint comercial falso").
  app.use(
    "/api/v1/portal",
    createRequireAuthenticatedSession(validateSessionService),
    createRequireApplicationAccess(authorizeApplicationAccessService, {
      applicationCode: PCTEC_PORTAL_APPLICATION_CODE,
      profile: "USER"
    }),
    createPortalContextRoutes(getPortalContextService),
    // GET /api/v1/portal/organizations/:organizationPublicId/external-references/PCTEC_PORTAL
    // — P1 Portal (v0.7.x). Primeira rota real a montar
    // requireOrganizationAccess (preparado desde G3, nunca usado até
    // aqui). Pipeline completo: requireAuthenticatedSession (acima) →
    // requireApplicationAccess (acima) → requireOrganizationAccess
    // (abaixo, por rota, pois só esta rota tem :organizationPublicId —
    // createPortalContextRoutes/GET /context não tem esse parâmetro) →
    // handler.
    createOrganizationExternalReferenceRoutes(
      createRequireOrganizationAccess(requireOrganizationAccessService, { paramName: "organizationPublicId" }),
      getActiveOrganizationExternalReferenceService
    )
  );

  // GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/external-references/PCTEC_PORTAL
  // — P1A.1 (v0.7.x). Fronteira service-to-service Ingressa↔Portal,
  // COMPLETAMENTE SEPARADA de /api/v1/portal/... (browser-facing) —
  // decisão deliberada do Product Owner. Nunca usa
  // requireAuthenticatedSession/requireApplicationAccess/
  // requireOrganizationAccess como middleware de rota (esses exigem
  // cookie de sessão, que não existe nesta chamada) — em vez disso,
  // requireServiceCredential (credencial de máquina) protege o acesso,
  // e AuthorizeApplicationAccessService/RequireOrganizationAccessService
  // são chamados DIRETAMENTE dentro do handler da rota, com
  // identityPublicId vindo do parâmetro de rota (nunca de sessão) —
  // ambos reaproveitados sem nenhuma alteração.
  app.use(
    "/api/v1/service/portal",
    createRequireServiceCredential(serviceCredential),
    createServicePortalOrganizationExternalReferenceRoutes(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService
    ),
    // GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId
    // — P1B.0 Fatia 4 (v0.7.x). Resolve portal_acesso.id → Identity.publicId.
    // Mesmo namespace /api/v1/service/portal, mesmo requireServiceCredential
    // já aplicado acima — nunca duplicado. Sem AuthorizeApplicationAccessService
    // nem RequireOrganizationAccessService: esta rota não tem identityPublicId
    // como entrada para verificar; está justamente RESOLVENDO qual é.
    createServicePortalIdentityExternalReferenceRoutes(getActiveIdentityExternalReferenceService),
    // GET /api/v1/service/portal/identities/:identityPublicId/context
    // — P1B.1 (v0.7.x). Pipeline: requireServiceCredential (aplicado acima)
    // → AuthorizeApplicationAccessService(PCTEC_PORTAL, USER)
    // → GetPortalContextService → organizations sanitizadas.
    // Mesmo namespace, mesmo requireServiceCredential — nunca duplicado.
    createServicePortalIdentityContextRoutes(authorizeApplicationAccessService, getPortalContextService),
    // GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/tenant-scope
    // — P1D (v0.7.x). Escopo comercial de uma seleção do Portal: COMPANY
    // resolve a si mesma; BUSINESS_GROUP expande nas COMPANY filhas
    // ACTIVE pelas relações canônicas, cada uma com seu legacyId.
    // Mesmo namespace, mesmo requireServiceCredential — nunca duplicado.
    // Pipeline: requireServiceCredential (acima)
    // → AuthorizeApplicationAccessService(PCTEC_PORTAL, USER)
    // → RequireOrganizationAccessService (a seleção pertence ao
    //   PortalContext real da Identity?) → ResolvePortalTenantScopeService.
    // Os dois primeiros são os MESMOS services de P1A.1, sem alteração.
    createServicePortalTenantScopeRoutes(
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      resolvePortalTenantScopeService
    )
  );

  // POST /api/v1/service/sso/token — troca do código pelo backend do
  // Portal. Reaproveita a credencial e o header que o Portal já usa
  // desde P1A.1: um canal service-to-service novo significaria um
  // segredo novo para distribuir, rotacionar e vazar. Um navegador nunca
  // chega aqui — este namespace nunca aceita cookie de sessão.
  app.use(
    "/api/v1/service/sso",
    createRequireServiceCredential(serviceCredential),
    createServiceSsoTokenRoutes(exchangeAuthorizationCodeService, sso.registry, sso.requiredProfileByClientId)
  );

  // GET /api/v1/service/helpdesk/users/:legacyUserId/context — v0.8.x.
  //
  // NAMESPACE PRÓPRIO, com CREDENCIAL PRÓPRIA e HEADER PRÓPRIO. Não é
  // reaproveitamento do namespace do Portal, e a separação é o ponto:
  // vazar a credencial do Helpdesk não pode dar acesso ao contexto do
  // Portal, e revogar uma não pode derrubar os dois produtos
  // (docs/import/CONTRATO-SERVICE-HELPDESK.md, "Credencial própria").
  //
  // Pipeline: requireServiceCredential(helpdesk)
  //   → GetHelpdeskUserContextService (referência externa → Identity
  //     ACTIVE → ApplicationAccess(PCTEC_HELPDESK, USER) → Memberships)
  //   → organizations sanitizadas.
  app.use(
    "/api/v1/service/helpdesk",
    createRequireServiceCredential(helpdeskServiceCredential, HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME),
    createServiceHelpdeskUserContextRoutes(getHelpdeskUserContextService)
  );

  // Qualquer outra rota ou método cai aqui — decisão desta fatia: 404
  // uniforme, nunca 405, para não revelar quais métodos existiriam em
  // rotas que ainda nem existem publicamente. Mesmo envelope de erro
  // padronizado (API-CONTRACT-V1.md) usado pelo handler de erro abaixo.
  app.use((req: RequestWithCorrelationId, res: Response) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Rota não encontrada.", correlation_id: req.correlationId ?? null, details: [] }
    });
  });

  // Handler de erro central: nunca vaza stack trace, mensagem de driver,
  // nome de tabela/coluna, ou qualquer detalhe interno na resposta.
  // `DomainError` é mapeada para o status HTTP correto
  // (`mapDomainErrorToHttp`); qualquer outro erro (bug, falha de driver,
  // etc.) vira 500 genérico e sanitizado. `_next` é mantido na
  // assinatura porque o Express só reconhece um handler de erro pela
  // aridade de 4 parâmetros.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: RequestWithCorrelationId, res: Response, _next: NextFunction) => {
    const correlationId = req.correlationId ?? null;
    if (isDomainError(err)) {
      const mapped = mapDomainErrorToHttp(err);
      res.status(mapped.status).json({
        error: {
          code: mapped.code,
          message: mapped.message,
          correlation_id: correlationId,
          // `details` só existe no erro que precisa dele; os demais
          // continuam respondendo a lista vazia de sempre. O conteúdo é
          // do próprio erro de domínio, que responde pela mesma regra de
          // sigilo da mensagem.
          details: err.details ?? []
        }
      });
      return;
    }
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Erro interno inesperado.", correlation_id: correlationId, details: [] }
    });
  });

  return app;
}
