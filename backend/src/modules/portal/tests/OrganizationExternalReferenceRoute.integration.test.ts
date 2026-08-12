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
import { MariaDbOrganizationExternalReferenceRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
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
import { RequireOrganizationAccessService } from "../application/RequireOrganizationAccessService.js";
import { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import { CreateOrganizationService } from "../../organization/application/CreateOrganizationService.js";
import { CreateOrganizationRelationshipService } from "../../organization/application/CreateOrganizationRelationshipService.js";
import { CreateOrganizationExternalReferenceService } from "../../organization/application/CreateOrganizationExternalReferenceService.js";
import { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import { CryptoSessionTokenGenerator } from "../../security/infrastructure/token/SessionTokenGenerator.js";
import { hashSessionToken } from "../../security/infrastructure/token/hashSessionToken.js";
import { SESSION_COOKIE_NAME } from "../../security/http/sessionCookie.js";
import { PublicId } from "../../organization/domain/value-objects/PublicId.js";

/**
 * Teste de integração real da rota
 * `GET /api/v1/portal/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`
 * — P1 Portal (v0.7.x), primeira prova real de `requireOrganizationAccess`
 * montado em produção de código.
 *
 * NÃO roda como parte de `npm test`. Só via `RUN_INTEGRATION_TESTS=true`.
 * **NÃO EXECUTADO nesta entrega** — preparado apenas, mesmo padrão de
 * `PortalContext.integration.test.ts` (G3).
 *
 * **Fixtures 100% próprias, nunca dependem da AFIP real** — Identity,
 * Session, ApplicationAccess, Organization (BUSINESS_GROUP + COMPANY),
 * OrganizationRelationship, Membership e OrganizationExternalReference
 * são todas criadas e removidas por este arquivo, com `Date.now()` nos
 * nomes para evitar colisão entre execuções. Cleanup específico por
 * `public_id`, ordem respeitando FKs, nunca `DELETE` genérico.
 *
 * **Revisão pré-commit (correção factual):** o fixture do grupo
 * (`fixtureGroupPublicId`) recebe deliberadamente uma
 * `OrganizationExternalReference` `ACTIVE` de `entityType='clientes_grupo'`
 * — não zero referências — para reproduzir com precisão o estado real
 * já confirmado no MariaDB DEV (BUSINESS_GROUP AFIP tem
 * `PCTEC_PORTAL/clientes_grupo/27`, nunca `clientes`). Prova
 * discriminação real por `entityType`, não apenas "nada cadastrado".
 * As 4 `COMPANY`s reais da AFIP (`BOSQUE`/`BELGICA`/`CLEMENTINO`/
 * `SANTANA`) têm cada uma sua própria `PCTEC_PORTAL/clientes/<id>` —
 * o código não distingue entre Organizations específicas (nenhum
 * branch por `legacyId`/nome), então o fixture único de COMPANY aqui
 * (`fixtureCompanyPublicId`) já prova o mesmo caminho de código que
 * qualquer uma das 4 exercitaria.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("OrganizationExternalReference route (integração - requer MariaDB real, P1)", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;
  let fixtureIdentityPublicId: string | undefined;
  let fixtureSessionPublicId: string | undefined;
  let fixtureApplicationAccessPublicId: string | undefined;
  let fixtureGroupPublicId: string | undefined;
  let fixtureCompanyPublicId: string | undefined;
  let fixtureRelationshipPublicId: string | undefined;
  let fixtureMembershipPublicId: string | undefined;
  let fixtureExternalReferencePublicId: string | undefined;
  let fixtureGroupExternalReferencePublicId: string | undefined;
  let fixtureOutsiderOrganizationPublicId: string | undefined;
  let fixtureRawToken: string;

  const FIXTURE_SYSTEM_ACTOR = ActorPublicId.system();
  const FIXTURE_LEGACY_ID = 999999; // nunca colide com legacyId real (75 é AFIP/BOSQUE real)

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

    const identityRepository = new MariaDbIdentityRepository(pool);
    const fixtureIdentity = Identity.create({
      type: "HUMAN",
      fullName: "Fixture de Integracao - External Reference Route v0.7.x",
      email: `external-reference-route-integration-${Date.now()}@example.invalid`,
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

    // --- Organization fixtures: BUSINESS_GROUP + COMPANY filha + COMPANY "de fora" (nunca autorizada) ---
    const createOrganizationService = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const groupResult = await createOrganizationService.execute({
      type: "BUSINESS_GROUP",
      legalName: `Grupo Fixture External Reference ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureGroupPublicId = groupResult.publicId;

    const companyResult = await createOrganizationService.execute({
      type: "COMPANY",
      legalName: `Empresa Fixture External Reference ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureCompanyPublicId = companyResult.publicId;

    const outsiderResult = await createOrganizationService.execute({
      type: "COMPANY",
      legalName: `Empresa Fora Do Contexto ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureOutsiderOrganizationPublicId = outsiderResult.publicId;

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

    // --- OrganizationExternalReference fixture: PCTEC_PORTAL/clientes/999999 -> fixtureCompanyPublicId ---
    const createOrganizationExternalReferenceService = new CreateOrganizationExternalReferenceService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const externalReferenceResult = await createOrganizationExternalReferenceService.execute({
      organizationPublicId: fixtureCompanyPublicId,
      systemCode: PCTEC_PORTAL_APPLICATION_CODE,
      entityType: "clientes",
      legacyId: FIXTURE_LEGACY_ID,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureExternalReferencePublicId = externalReferenceResult.publicId;

    // --- OrganizationExternalReference fixture do GRUPO: PCTEC_PORTAL/clientes_grupo/888888 -> fixtureGroupPublicId.
    // Reproduz precisamente o estado real confirmado no MariaDB DEV (revisão
    // pré-commit): o BUSINESS_GROUP AFIP tem uma referência ACTIVE, mas
    // entityType='clientes_grupo' — nunca 'clientes'. A rota (entityType
    // fixado internamente como 'clientes') deve continuar 404 mesmo com
    // essa referência existindo, provando discriminação real por
    // entityType, não apenas "nenhuma referência cadastrada".
    const groupExternalReferenceResult = await createOrganizationExternalReferenceService.execute({
      organizationPublicId: fixtureGroupPublicId,
      systemCode: PCTEC_PORTAL_APPLICATION_CODE,
      entityType: "clientes_grupo",
      legacyId: 888888,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureGroupExternalReferencePublicId = groupExternalReferenceResult.publicId;

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
    const requireOrganizationAccessService = new RequireOrganizationAccessService(getPortalContextService);
    const getActiveOrganizationExternalReferenceService = new GetActiveOrganizationExternalReferenceService(
      new MariaDbOrganizationExternalReferenceRepository(pool)
    );
    const app = createApp({
      validateSessionService,
      authorizeApplicationAccessService,
      getPortalContextService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService,
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

    if (fixtureGroupExternalReferencePublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
        fixtureGroupExternalReferencePublicId
      ]);
      await pool.execute(`DELETE FROM organization_external_references WHERE public_id = ?`, [
        fixtureGroupExternalReferencePublicId
      ]);
    }
    if (fixtureExternalReferencePublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
        fixtureExternalReferencePublicId
      ]);
      await pool.execute(`DELETE FROM organization_external_references WHERE public_id = ?`, [
        fixtureExternalReferencePublicId
      ]);
    }
    if (fixtureMembershipPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureMembershipPublicId]);
      await pool.execute(`DELETE FROM memberships WHERE public_id = ?`, [fixtureMembershipPublicId]);
    }
    if (fixtureRelationshipPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureRelationshipPublicId]);
      await pool.execute(`DELETE FROM organization_relationships WHERE public_id = ?`, [fixtureRelationshipPublicId]);
    }
    if (fixtureOutsiderOrganizationPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
        fixtureOutsiderOrganizationPublicId
      ]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureOutsiderOrganizationPublicId]);
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

  it("D/E) Organization autorizada (via AND_DESCENDANTS) + referência ACTIVE real -> 200, legacyId correto", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/portal/organizations/${fixtureCompanyPublicId}/external-references/PCTEC_PORTAL`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` } }
    );
    const body = (await res.json()) as {
      organization: { publicId: string };
      externalReference: { systemCode: string; entityType: string; legacyId: number };
    };

    expect(res.status).toBe(200);
    expect(body.organization.publicId).toBe(fixtureCompanyPublicId);
    expect(body.externalReference).toEqual({
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: FIXTURE_LEGACY_ID
    });
  });

  it("C) Organization real, mas fora do PortalContext da Identity fixture -> 403 ORGANIZATION_ACCESS_DENIED", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/portal/organizations/${fixtureOutsiderOrganizationPublicId}/external-references/PCTEC_PORTAL`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` } }
    );
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("G) Organization autorizada, com referência ACTIVE só de entityType='clientes_grupo' (mesmo estado real confirmado da AFIP/DEV) -> 404 ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND — a rota exige 'clientes', nunca 'clientes_grupo'", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/portal/organizations/${fixtureGroupPublicId}/external-references/PCTEC_PORTAL`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${fixtureRawToken}` } }
    );
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  it("A) sem cookie -> 401 SESSION_INVALID", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/portal/organizations/${fixtureCompanyPublicId}/external-references/PCTEC_PORTAL`
    );
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("SESSION_INVALID");
  });

  it("real: fixtures permanecem íntegras — nunca tocamos dado da AFIP real", async () => {
    const organizationRepository = new MariaDbOrganizationRepository(pool);
    const fixtureCompany = await organizationRepository.findByPublicId(PublicId.fromString(fixtureCompanyPublicId!));
    expect(fixtureCompany?.getLegalName()).toContain("Empresa Fixture External Reference");
  });
});
