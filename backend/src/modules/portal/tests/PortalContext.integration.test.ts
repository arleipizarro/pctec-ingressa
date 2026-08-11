import type { Pool } from "mysql2/promise";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { createApp } from "../../../app/http/createApp.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbSessionRepository } from "../../security/infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbApplicationRepository } from "../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbOrganizationRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { MariaDbMembershipRepository } from "../../organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { ValidateSessionService } from "../../security/application/ValidateSessionService.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { Session } from "../../security/domain/session/Session.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import { PCTEC_PORTAL_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";
import { GetPortalContextService } from "../application/GetPortalContextService.js";
import { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import { CreateOrganizationService } from "../../organization/application/CreateOrganizationService.js";
import { CreateOrganizationRelationshipService } from "../../organization/application/CreateOrganizationRelationshipService.js";
import { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import { CryptoSessionTokenGenerator } from "../../security/infrastructure/token/SessionTokenGenerator.js";
import { hashSessionToken } from "../../security/infrastructure/token/hashSessionToken.js";
import { SESSION_COOKIE_NAME } from "../../security/http/sessionCookie.js";

/**
 * Teste de integração real do fluxo completo do Portal — G3 (v0.6.x).
 * Prova a cadeia completa contra um MariaDB de verdade e um servidor
 * HTTP efêmero real: `AuthenticatedPrincipal` -> `ApplicationAccess(PCTEC_PORTAL)`
 * -> `Membership ACTIVE` -> `Organization`/`OrganizationRelationship` ->
 * `GET /api/v1/portal/context`.
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, mesmo padrão de
 * `ApplicationAccessEnforcement.integration.test.ts` (Fase F) e
 * `OrganizationFoundation.integration.test.ts`/`OrganizationMembership.integration.test.ts`
 * (G1/G2).
 *
 * **`PCTEC_PORTAL`: usa a Application REAL, só leitura, mesmo raciocínio
 * já documentado em `ApplicationAccessEnforcement.integration.test.ts`
 * para `PCTEC_INGRESSA`** — `Application` não tem comando de criação;
 * a única linha existe pelo seed técnico (migration 0014, ainda não
 * aplicada — este teste PRESSUPÕE que já foi, mesmo pressuposto de
 * todo teste de integração existente neste repositório). Nunca
 * modifica/revoga o seed real.
 *
 * **`Identity`/`Session`/`ApplicationAccess`/`Organization`/`Membership`:
 * fixtures próprias**, todas criadas e removidas por este arquivo.
 * `ApplicationAccess` usa `GrantApplicationAccessService` (G3, `grant()`
 * genérico, com Actor real — nunca o marcador `BOOTSTRAP`, reservado à
 * concessão fundacional). Cleanup específico por `public_id`, ordem
 * respeitando FKs, nunca `DELETE` genérico.
 *
 * **Nenhum dado real do Product Owner** — a Identity/Session/
 * ApplicationAccess/Organization/Membership usadas aqui nunca são as
 * reais.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("PortalContext (integração - requer MariaDB real, G3)", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;
  let realPortalApplicationPublicId: string;
  let fixtureIdentityPublicId: string | undefined;
  let fixtureSessionPublicId: string | undefined;
  let fixtureApplicationAccessPublicId: string | undefined;
  let fixtureGroupPublicId: string | undefined;
  let fixtureCompanyPublicId: string | undefined;
  let fixtureRelationshipPublicId: string | undefined;
  let fixtureMembershipPublicId: string | undefined;
  let fixtureRawToken: string;

  const FIXTURE_SYSTEM_ACTOR = ActorPublicId.system();

  beforeAll(async () => {
    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });

    const applicationRepository = new MariaDbApplicationRepository(pool);
    const realPortalApplication = await applicationRepository.findByCode(
      ApplicationCode.create(PCTEC_PORTAL_APPLICATION_CODE)
    );
    if (realPortalApplication === undefined) {
      throw new Error("PCTEC_PORTAL não encontrada — seed técnico (migration 0014) precisa já ter rodado neste banco.");
    }
    realPortalApplicationPublicId = realPortalApplication.getPublicId().toString();

    // --- Identity fixture (ativa, login habilitado) ---
    const identityRepository = new MariaDbIdentityRepository(pool);
    const fixtureIdentity = Identity.create({
      type: "HUMAN",
      fullName: "Fixture de Integracao - Portal Context v0.6.x",
      email: `portal-context-integration-${Date.now()}@example.invalid`,
      actor: FIXTURE_SYSTEM_ACTOR,
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    await identityRepository.insert(fixtureIdentity);
    fixtureIdentity.activate({
      actor: FIXTURE_SYSTEM_ACTOR,
      expectedVersion: fixtureIdentity.getVersion(),
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    fixtureIdentity.enableLogin({
      actor: FIXTURE_SYSTEM_ACTOR,
      expectedVersion: fixtureIdentity.getVersion(),
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    await identityRepository.update(fixtureIdentity, 1);
    fixtureIdentityPublicId = fixtureIdentity.getPublicId().toString();

    // --- Session fixture ---
    const sessionRepository = new MariaDbSessionRepository(pool);
    const tokenGenerator = new CryptoSessionTokenGenerator();
    fixtureRawToken = tokenGenerator.generate();
    const fixtureSession = Session.create({
      identityPublicId: fixtureIdentityPublicId,
      tokenHash: hashSessionToken(fixtureRawToken),
      ttlSeconds: 3600,
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    fixtureSession.pullDomainEvents();
    await sessionRepository.insert(fixtureSession);
    fixtureSessionPublicId = fixtureSession.getPublicId().toString();

    // --- ApplicationAccess(PCTEC_PORTAL, USER) fixture — grant() genérico (G3) ---
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const grantApplicationAccessService = new GrantApplicationAccessService(
      unitOfWork,
      (connection) => new MariaDbApplicationRepository(connection),
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbApplicationAccessRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const accessResult = await grantApplicationAccessService.execute({
      identityPublicId: fixtureIdentityPublicId,
      applicationCode: PCTEC_PORTAL_APPLICATION_CODE,
      accessProfile: "USER",
      grantedByIdentityPublicId: fixtureIdentityPublicId
    });
    fixtureApplicationAccessPublicId = accessResult.applicationAccessPublicId;

    // --- Organization fixtures: BUSINESS_GROUP + COMPANY filha ---
    const createOrganizationService = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const groupResult = await createOrganizationService.execute({
      type: "BUSINESS_GROUP",
      legalName: `Grupo Fixture Portal Context ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureGroupPublicId = groupResult.publicId;

    const companyResult = await createOrganizationService.execute({
      type: "COMPANY",
      legalName: `Empresa Fixture Portal Context ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureCompanyPublicId = companyResult.publicId;

    const createOrganizationRelationshipService = new CreateOrganizationRelationshipService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationRelationshipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const relationshipResult = await createOrganizationRelationshipService.execute({
      parentOrganizationPublicId: fixtureGroupPublicId,
      childOrganizationPublicId: fixtureCompanyPublicId,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureRelationshipPublicId = relationshipResult.publicId;

    // --- Membership fixture: AND_DESCENDANTS no grupo — deve alcançar a COMPANY filha também ---
    const createMembershipService = new CreateMembershipService(
      unitOfWork,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbMembershipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const membershipResult = await createMembershipService.execute({
      identityPublicId: fixtureIdentityPublicId,
      organizationPublicId: fixtureGroupPublicId,
      profile: "CUSTOMER",
      scope: "ORGANIZATION_AND_DESCENDANTS",
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureMembershipPublicId = membershipResult.publicId;

    // --- Servidor HTTP efêmero real ---
    const validateSessionService = new ValidateSessionService(
      new MariaDbSessionRepository(pool),
      new MariaDbIdentityRepository(pool)
    );
    const authorizeApplicationAccessService = new AuthorizeApplicationAccessService(
      new MariaDbApplicationRepository(pool),
      new MariaDbApplicationAccessRepository(pool)
    );
    const getPortalContextService = new GetPortalContextService(
      new MariaDbMembershipRepository(pool),
      new MariaDbOrganizationRepository(pool),
      new MariaDbOrganizationRelationshipRepository(pool)
    );
    const app = createApp({
      validateSessionService,
      authorizeApplicationAccessService,
      getPortalContextService,
      sessionCookieConfig: { secure: false }
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado do servidor de teste");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    // Ordem de remoção respeita FKs: memberships/organization_relationships
    // antes de organizations; application_accesses/sessions antes de
    // identities. Nunca um DELETE amplo por tabela inteira.
    if (fixtureMembershipPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureMembershipPublicId]);
      await pool.execute(`DELETE FROM memberships WHERE public_id = ?`, [fixtureMembershipPublicId]);
    }
    if (fixtureRelationshipPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureRelationshipPublicId]);
      await pool.execute(`DELETE FROM organization_relationships WHERE public_id = ?`, [fixtureRelationshipPublicId]);
    }
    if (fixtureCompanyPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureCompanyPublicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureCompanyPublicId]);
    }
    if (fixtureGroupPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureGroupPublicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureGroupPublicId]);
    }
    if (fixtureApplicationAccessPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
        fixtureApplicationAccessPublicId
      ]);
      await pool.execute(`DELETE FROM application_accesses WHERE public_id = ?`, [
        fixtureApplicationAccessPublicId
      ]);
    }
    if (fixtureSessionPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureSessionPublicId]);
      await pool.execute(`DELETE FROM sessions WHERE public_id = ?`, [fixtureSessionPublicId]);
    }
    if (fixtureIdentityPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureIdentityPublicId]);
      await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentityPublicId]);
    }
    await pool.end();
  });

  it("GET /api/v1/portal/context com cookie fixture + ApplicationAccess(PCTEC_PORTAL, USER) GRANTED -> 200, grupo + empresa filha (AND_DESCENDANTS)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/portal/context`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` }
    });
    const body = (await res.json()) as {
      identity: { publicId: string };
      organizations: Array<{ publicId: string; type: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.identity.publicId).toBe(fixtureIdentityPublicId);
    const publicIds = body.organizations.map((o) => o.publicId);
    expect(publicIds).toContain(fixtureGroupPublicId);
    expect(publicIds).toContain(fixtureCompanyPublicId);
  });

  it("GET /api/v1/portal/context sem cookie -> 401 SESSION_INVALID", async () => {
    const res = await fetch(`${baseUrl}/api/v1/portal/context`);
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("SESSION_INVALID");
  });

  it("GET /api/v1/me continua 200 para a mesma sessão, sem consultar PCTEC_PORTAL/Membership/Organization", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` }
    });
    expect(res.status).toBe(200);
  });

  it("real: Application real PCTEC_PORTAL permanece intacta (não modificada por este teste)", async () => {
    const applicationRepository = new MariaDbApplicationRepository(pool);
    const stillThere = await applicationRepository.findByCode(ApplicationCode.create(PCTEC_PORTAL_APPLICATION_CODE));
    expect(stillThere?.getPublicId().toString()).toBe(realPortalApplicationPublicId);
    expect(stillThere?.isActive()).toBe(true);
  });
});
