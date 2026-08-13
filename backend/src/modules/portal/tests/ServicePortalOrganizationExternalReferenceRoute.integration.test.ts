import type { Pool } from "mysql2/promise";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { createApp } from "../../../app/http/createApp.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbApplicationRepository } from "../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbOrganizationRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbMembershipRepository } from "../../organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import { PCTEC_PORTAL_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";
import { GetPortalContextService } from "../application/GetPortalContextService.js";
import { RequireOrganizationAccessService } from "../application/RequireOrganizationAccessService.js";
import { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import { CreateOrganizationService } from "../../organization/application/CreateOrganizationService.js";
import { CreateOrganizationExternalReferenceService } from "../../organization/application/CreateOrganizationExternalReferenceService.js";
import { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../http/requireServiceCredential.js";

/**
 * Teste de integração real da rota service-to-service
 * `GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`
 * — P1A.1 (v0.7.x).
 *
 * NÃO roda como parte de `npm test`. Só via `RUN_INTEGRATION_TESTS=true`.
 * **NÃO EXECUTADO nesta entrega** — preparado apenas.
 *
 * **Mais simples que `OrganizationExternalReferenceRoute.integration.test.ts`
 * (rota browser-facing)**: esta rota nunca usa Session/cookie — não há
 * fixture de `Session` aqui, só `Identity`/`ApplicationAccess`/
 * `Organization`/`Membership`/`OrganizationExternalReference`, todas
 * próprias, nunca dependem da AFIP real. A credencial de serviço usada
 * no teste (`INGRESSA_PORTAL_SERVICE_CREDENTIAL` do `.env` real do
 * ambiente de integração) nunca é logada nem comparada por string —
 * só passada como header, exatamente como o Portal faria.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("ServicePortalOrganizationExternalReference route (integração - requer MariaDB real, P1A.1)", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;
  let realServiceCredential: string;
  let fixtureIdentityPublicId: string | undefined;
  let fixtureApplicationAccessPublicId: string | undefined;
  let fixtureOrganizationPublicId: string | undefined;
  let fixtureOutsiderOrganizationPublicId: string | undefined;
  let fixtureMembershipPublicId: string | undefined;
  let fixtureExternalReferencePublicId: string | undefined;

  const FIXTURE_SYSTEM_ACTOR = ActorPublicId.system();
  const FIXTURE_LEGACY_ID = 999998; // distinto do fixture do teste browser-facing e do legacyId=75 real

  beforeAll(async () => {
    const env = loadEnv();
    if (env.INGRESSA_PORTAL_SERVICE_CREDENTIAL.length === 0) {
      throw new Error(
        "INGRESSA_PORTAL_SERVICE_CREDENTIAL não configurada — necessária para rodar este teste de integração."
      );
    }
    realServiceCredential = env.INGRESSA_PORTAL_SERVICE_CREDENTIAL;

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
      fullName: "Fixture de Integracao - Service Portal Route v0.7.x",
      email: `service-portal-route-integration-${Date.now()}@example.invalid`,
      actor: FIXTURE_SYSTEM_ACTOR,
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    await identityRepository.insert(fixtureIdentity);
    fixtureIdentity.activate({
      actor: FIXTURE_SYSTEM_ACTOR,
      expectedVersion: fixtureIdentity.getVersion(),
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    await identityRepository.update(fixtureIdentity, 1);
    fixtureIdentityPublicId = fixtureIdentity.getPublicId().toString();

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

    const createOrganizationService = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const organizationResult = await createOrganizationService.execute({
      type: "COMPANY",
      legalName: `Empresa Fixture Service Route ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureOrganizationPublicId = organizationResult.publicId;

    const outsiderResult = await createOrganizationService.execute({
      type: "COMPANY",
      legalName: `Empresa Fora Do Contexto Service Route ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureOutsiderOrganizationPublicId = outsiderResult.publicId;

    const createMembershipService = new CreateMembershipService(
      unitOfWork,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbMembershipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const membershipResult = await createMembershipService.execute({
      identityPublicId: fixtureIdentityPublicId,
      organizationPublicId: fixtureOrganizationPublicId,
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureMembershipPublicId = membershipResult.publicId;

    const createOrganizationExternalReferenceService = new CreateOrganizationExternalReferenceService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const externalReferenceResult = await createOrganizationExternalReferenceService.execute({
      organizationPublicId: fixtureOrganizationPublicId,
      systemCode: PCTEC_PORTAL_APPLICATION_CODE,
      entityType: "clientes",
      legacyId: FIXTURE_LEGACY_ID,
      actorPublicId: fixtureIdentityPublicId
    });
    fixtureExternalReferencePublicId = externalReferenceResult.publicId;

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
      authorizeApplicationAccessService,
      requireOrganizationAccessService,
      getActiveOrganizationExternalReferenceService,
      getPortalContextService,
      serviceCredential: realServiceCredential
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
    if (fixtureOutsiderOrganizationPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
        fixtureOutsiderOrganizationPublicId
      ]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureOutsiderOrganizationPublicId]);
    }
    if (fixtureOrganizationPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureOrganizationPublicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureOrganizationPublicId]);
    }
    if (fixtureApplicationAccessPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
        fixtureApplicationAccessPublicId
      ]);
      await pool.execute(`DELETE FROM application_accesses WHERE public_id = ?`, [
        fixtureApplicationAccessPublicId
      ]);
    }
    if (fixtureIdentityPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureIdentityPublicId]);
      await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentityPublicId]);
    }
    await pool.end();
  });

  function url(): string {
    return `${baseUrl}/api/v1/service/portal/identities/${fixtureIdentityPublicId}/organizations/${fixtureOrganizationPublicId}/external-references/PCTEC_PORTAL`;
  }

  it("credencial real correta + Identity/Organization autorizadas + referência ACTIVE real -> 200, legacyId correto", async () => {
    const res = await fetch(url(), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const body = (await res.json()) as { legacyId: number };

    expect(res.status).toBe(200);
    expect(body).toEqual({ legacyId: FIXTURE_LEGACY_ID });
  });

  it("credencial ausente -> 401 SERVICE_CREDENTIAL_INVALID, mesmo com Identity/Organization reais e válidas", async () => {
    const res = await fetch(url());
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("SERVICE_CREDENTIAL_INVALID");
  });

  it("credencial incorreta -> 401 SERVICE_CREDENTIAL_INVALID", async () => {
    const res = await fetch(url(), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: `${realServiceCredential}-errada` }
    });
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("SERVICE_CREDENTIAL_INVALID");
  });

  it("Organization real, mas fora do PortalContext da Identity fixture -> 403 ORGANIZATION_ACCESS_DENIED", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/portal/identities/${fixtureIdentityPublicId}/organizations/${fixtureOutsiderOrganizationPublicId}/external-references/PCTEC_PORTAL`,
      { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential } }
    );
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });
});
