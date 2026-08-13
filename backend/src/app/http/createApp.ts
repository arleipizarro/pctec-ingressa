import express, { type Express, type NextFunction, type Response } from "express";

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
import { MariaDbMembershipRepository } from "../../modules/organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbOrganizationRepository } from "../../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../../modules/organization/infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../../modules/organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { GetActiveOrganizationExternalReferenceService } from "../../modules/organization/application/GetActiveOrganizationExternalReferenceService.js";
import { GetPortalContextService } from "../../modules/portal/application/GetPortalContextService.js";
import { RequireOrganizationAccessService } from "../../modules/portal/application/RequireOrganizationAccessService.js";
import { createPortalContextRoutes } from "../../modules/portal/http/portalContextRoutes.js";
import { createRequireOrganizationAccess } from "../../modules/portal/http/requireOrganizationAccess.js";
import { createOrganizationExternalReferenceRoutes } from "../../modules/portal/http/organizationExternalReferenceRoutes.js";
import { createRequireServiceCredential } from "../../modules/portal/http/requireServiceCredential.js";
import { createServicePortalOrganizationExternalReferenceRoutes } from "../../modules/portal/http/servicePortalOrganizationExternalReferenceRoutes.js";

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
    options.getActiveOrganizationExternalReferenceService === undefined;
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
  const sessionCookieConfig: SessionCookieConfig = options.sessionCookieConfig ?? {
    secure: loadEnv().SESSION_COOKIE_SECURE
  };
  const allowedOrigins = options.allowedOrigins ?? loadEnv().ALLOWED_ORIGINS;
  const serviceCredential = options.serviceCredential ?? loadEnv().INGRESSA_PORTAL_SERVICE_CREDENTIAL;

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
    createAdminWhoamiRoutes()
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
    )
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
        error: { code: mapped.code, message: mapped.message, correlation_id: correlationId, details: [] }
      });
      return;
    }
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Erro interno inesperado.", correlation_id: correlationId, details: [] }
    });
  });

  return app;
}
