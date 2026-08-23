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
import { ResolvePortalTenantScopeService } from "../application/ResolvePortalTenantScopeService.js";
import { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import { CreateOrganizationService } from "../../organization/application/CreateOrganizationService.js";
import { CreateOrganizationRelationshipService } from "../../organization/application/CreateOrganizationRelationshipService.js";
import { CreateOrganizationExternalReferenceService } from "../../organization/application/CreateOrganizationExternalReferenceService.js";
import { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../http/requireServiceCredential.js";

/**
 * Teste de integração real da rota service-to-service
 * `GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/tenant-scope`
 * — P1D (v0.7.x).
 *
 * NÃO roda como parte de `npm test`. Só via `RUN_INTEGRATION_TESTS=true`
 * e um MariaDB real configurado.
 *
 * **Todas as fixtures são próprias e removidas no `afterAll`** — nunca
 * toca a AFIP real do DEV, nunca depende dela, nunca altera nenhuma
 * `Organization`/`OrganizationExternalReference` existente. O grupo
 * fixture reproduz a MESMA FORMA do piloto (1 `BUSINESS_GROUP` +
 * `COMPANY` filhas, cada uma com referência `PCTEC_PORTAL/clientes`,
 * Membership `ORGANIZATION_AND_DESCENDANTS` no grupo), com `legacyId`s
 * fora da faixa real para nunca colidir com clientes de verdade.
 *
 * O que este teste prova, e que nenhum teste unitário pode provar:
 * a expansão do grupo funciona contra as **relações canônicas reais**
 * (`organization_relationships`) e contra as **referências reais**
 * (`organization_external_references`), pelo pipeline HTTP completo,
 * incluindo `requireServiceCredential`.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("ServicePortalTenantScope route (integração - requer MariaDB real, P1D)", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;
  let realServiceCredential: string;

  let identityPublicId: string | undefined;
  let applicationAccessPublicId: string | undefined;
  // Segunda Identity, com Membership ORGANIZATION_ONLY no MESMO grupo —
  // prova real do achado C-1 contra MariaDB.
  let restritaIdentityPublicId: string | undefined;
  let restritaApplicationAccessPublicId: string | undefined;
  let restritaMembershipPublicId: string | undefined;
  let groupPublicId: string | undefined;
  let companyAPublicId: string | undefined;
  let companyBPublicId: string | undefined;
  let outsiderCompanyPublicId: string | undefined;
  let membershipPublicId: string | undefined;
  const relationshipPublicIds: string[] = [];
  const externalReferencePublicIds: string[] = [];

  const FIXTURE_SYSTEM_ACTOR = ActorPublicId.system();
  // Fora de qualquer faixa real de `clientes.id` do Portal — nunca colide
  // com um cliente de verdade, mesmo se o teste rodar contra o DEV.
  const LEGACY_ID_A = 999901;
  const LEGACY_ID_B = 999902;

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
      fullName: "Fixture de Integracao - Tenant Scope v0.7.x",
      email: `tenant-scope-integration-${Date.now()}@example.invalid`,
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
    identityPublicId = fixtureIdentity.getPublicId().toString();

    const unitOfWork = new MariaDbUnitOfWork(pool);

    const grantApplicationAccessService = new GrantApplicationAccessService(
      unitOfWork,
      (connection) => new MariaDbApplicationRepository(connection),
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbApplicationAccessRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const accessResult = await grantApplicationAccessService.execute({
      identityPublicId,
      applicationCode: PCTEC_PORTAL_APPLICATION_CODE,
      accessProfile: "USER",
      grantedByIdentityPublicId: identityPublicId
    });
    applicationAccessPublicId = accessResult.applicationAccessPublicId;

    const createOrganizationService = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const stamp = Date.now();
    groupPublicId = (
      await createOrganizationService.execute({
        type: "BUSINESS_GROUP",
        legalName: `Grupo Fixture Tenant Scope ${stamp}`,
        tradeName: `GRUPO FIXTURE ${stamp}`,
        actorPublicId: identityPublicId
      })
    ).publicId;
    companyAPublicId = (
      await createOrganizationService.execute({
        type: "COMPANY",
        legalName: `Empresa Fixture A ${stamp}`,
        tradeName: `FIXTURE - A ${stamp}`,
        actorPublicId: identityPublicId
      })
    ).publicId;
    companyBPublicId = (
      await createOrganizationService.execute({
        type: "COMPANY",
        legalName: `Empresa Fixture B ${stamp}`,
        tradeName: `FIXTURE - B ${stamp}`,
        actorPublicId: identityPublicId
      })
    ).publicId;
    outsiderCompanyPublicId = (
      await createOrganizationService.execute({
        type: "COMPANY",
        legalName: `Empresa Fora Do Grupo ${stamp}`,
        actorPublicId: identityPublicId
      })
    ).publicId;

    const createOrganizationRelationshipService = new CreateOrganizationRelationshipService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationRelationshipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    for (const childPublicId of [companyAPublicId, companyBPublicId]) {
      const relationship = await createOrganizationRelationshipService.execute({
        parentOrganizationPublicId: groupPublicId,
        childOrganizationPublicId: childPublicId,
        actorPublicId: identityPublicId
      });
      relationshipPublicIds.push(relationship.publicId);
    }

    const createOrganizationExternalReferenceService = new CreateOrganizationExternalReferenceService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    for (const [childPublicId, legacyId] of [
      [companyAPublicId, LEGACY_ID_A],
      [companyBPublicId, LEGACY_ID_B]
    ] as const) {
      const reference = await createOrganizationExternalReferenceService.execute({
        organizationPublicId: childPublicId,
        systemCode: PCTEC_PORTAL_APPLICATION_CODE,
        entityType: "clientes",
        legacyId,
        actorPublicId: identityPublicId
      });
      externalReferencePublicIds.push(reference.publicId);
    }

    // Membership no GRUPO, com escopo de descendentes — é o que coloca o
    // grupo E as filhas no PortalContext efetivo da Identity.
    const createMembershipService = new CreateMembershipService(
      unitOfWork,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbMembershipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    membershipPublicId = (
      await createMembershipService.execute({
        identityPublicId,
        organizationPublicId: groupPublicId,
        profile: "CUSTOMER",
        scope: "ORGANIZATION_AND_DESCENDANTS",
        actorPublicId: identityPublicId
      })
    ).publicId;

    // Identity RESTRITA: mesmo grupo, scope ORGANIZATION_ONLY. Pelo
    // design de MembershipScope, ela alcança o grupo e NENHUMA filha.
    const restrita = Identity.create({
      type: "HUMAN",
      fullName: "Fixture de Integracao - Tenant Scope Restrita v0.7.x",
      email: `tenant-scope-restrita-${Date.now()}@example.invalid`,
      actor: FIXTURE_SYSTEM_ACTOR,
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    await identityRepository.insert(restrita);
    restrita.activate({
      actor: FIXTURE_SYSTEM_ACTOR,
      expectedVersion: restrita.getVersion(),
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    await identityRepository.update(restrita, 1);
    restritaIdentityPublicId = restrita.getPublicId().toString();

    restritaApplicationAccessPublicId = (
      await grantApplicationAccessService.execute({
        identityPublicId: restritaIdentityPublicId,
        applicationCode: PCTEC_PORTAL_APPLICATION_CODE,
        accessProfile: "USER",
        grantedByIdentityPublicId: restritaIdentityPublicId
      })
    ).applicationAccessPublicId;

    restritaMembershipPublicId = (
      await createMembershipService.execute({
        identityPublicId: restritaIdentityPublicId,
        organizationPublicId: groupPublicId,
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: restritaIdentityPublicId
      })
    ).publicId;

    const authorizeApplicationAccessService = new AuthorizeApplicationAccessService(
      new MariaDbApplicationRepository(pool),
      new MariaDbApplicationAccessRepository(pool)
    );
    const getPortalContextService = new GetPortalContextService(
      new MariaDbMembershipRepository(pool),
      new MariaDbOrganizationRepository(pool),
      new MariaDbOrganizationRelationshipRepository(pool)
    );
    const getActiveOrganizationExternalReferenceService = new GetActiveOrganizationExternalReferenceService(
      new MariaDbOrganizationExternalReferenceRepository(pool)
    );
    const app = createApp({
      authorizeApplicationAccessService,
      getPortalContextService,
      requireOrganizationAccessService: new RequireOrganizationAccessService(getPortalContextService),
      getActiveOrganizationExternalReferenceService,
      resolvePortalTenantScopeService: new ResolvePortalTenantScopeService(
        new MariaDbOrganizationRepository(pool),
        new MariaDbOrganizationRelationshipRepository(pool),
        getActiveOrganizationExternalReferenceService
      ),
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

    // Ordem inversa da criação — nenhuma FK fica órfã.
    for (const publicId of externalReferencePublicIds) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [publicId]);
      await pool.execute(`DELETE FROM organization_external_references WHERE public_id = ?`, [publicId]);
    }
    for (const publicId of [restritaMembershipPublicId, membershipPublicId]) {
      if (publicId === undefined) continue;
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [publicId]);
      await pool.execute(`DELETE FROM memberships WHERE public_id = ?`, [publicId]);
    }
    for (const publicId of relationshipPublicIds) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [publicId]);
      await pool.execute(`DELETE FROM organization_relationships WHERE public_id = ?`, [publicId]);
    }
    for (const publicId of [outsiderCompanyPublicId, companyBPublicId, companyAPublicId, groupPublicId]) {
      if (publicId === undefined) continue;
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [publicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [publicId]);
    }
    for (const publicId of [restritaApplicationAccessPublicId, applicationAccessPublicId]) {
      if (publicId === undefined) continue;
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [publicId]);
      await pool.execute(`DELETE FROM application_accesses WHERE public_id = ?`, [publicId]);
    }
    for (const publicId of [restritaIdentityPublicId, identityPublicId]) {
      if (publicId === undefined) continue;
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [publicId]);
      await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [publicId]);
    }
    await pool.end();
  });

  function url(organizationPublicId: string | undefined, asIdentity: string | undefined = identityPublicId): string {
    return `${baseUrl}/api/v1/service/portal/identities/${asIdentity}/organizations/${organizationPublicId}/tenant-scope`;
  }

  interface ScopeBody {
    readonly selection: { publicId: string; type: string; legalName: string; tradeName: string | null };
    readonly organizations: ReadonlyArray<{
      publicId: string;
      type: string;
      legalName: string;
      tradeName: string | null;
      legacyId: number;
    }>;
  }

  it("BUSINESS_GROUP real -> 200 consolidando as COMPANY filhas com seus legacyIds reais", async () => {
    const res = await fetch(url(groupPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const body = (await res.json()) as ScopeBody;

    expect(res.status).toBe(200);
    expect(body.selection.publicId).toBe(groupPublicId);
    expect(body.selection.type).toBe("BUSINESS_GROUP");
    expect(body.organizations).toHaveLength(2);
    expect(body.organizations.map((o) => o.legacyId).sort((a, b) => a - b)).toEqual([LEGACY_ID_A, LEGACY_ID_B]);
    expect(body.organizations.map((o) => o.publicId).sort()).toEqual(
      [companyAPublicId, companyBPublicId].sort() as string[]
    );
    // O grupo nunca entra no próprio escopo comercial.
    expect(body.organizations.some((o) => o.publicId === groupPublicId)).toBe(false);
  });

  it("COMPANY filha real -> 200 com exatamente ela mesma (seleção individual preservada)", async () => {
    const res = await fetch(url(companyAPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const body = (await res.json()) as ScopeBody;

    expect(res.status).toBe(200);
    expect(body.selection.type).toBe("COMPANY");
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0]?.publicId).toBe(companyAPublicId);
    expect(body.organizations[0]?.legacyId).toBe(LEGACY_ID_A);
  });

  it("credencial ausente -> 401 SERVICE_CREDENTIAL_INVALID, mesmo com fixtures reais válidas", async () => {
    const res = await fetch(url(groupPublicId));
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("SERVICE_CREDENTIAL_INVALID");
  });

  it("credencial incorreta -> 401 SERVICE_CREDENTIAL_INVALID", async () => {
    const res = await fetch(url(groupPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: `${realServiceCredential}-errada` }
    });
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("SERVICE_CREDENTIAL_INVALID");
  });

  it("Organization real fora do PortalContext -> 403 ORGANIZATION_ACCESS_DENIED", async () => {
    const res = await fetch(url(outsiderCompanyPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("C-1: Membership ORGANIZATION_ONLY no grupo -> 403, nenhuma filha consolidada", async () => {
    const res = await fetch(url(groupPublicId, restritaIdentityPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const raw = await res.text();

    expect(res.status).toBe(403);
    expect((JSON.parse(raw) as { error: { code: string } }).error.code).toBe("ORGANIZATION_ACCESS_DENIED");
    // Nenhuma empresa do grupo é revelada junto com a negativa —
    // nem publicId, nem legacyId, nem nome.
    for (const vazamento of [companyAPublicId, companyBPublicId, String(LEGACY_ID_A), String(LEGACY_ID_B)]) {
      expect(raw).not.toContain(vazamento as string);
    }
    expect(raw).not.toContain("organizations");
  });

  it("C-1: a MESMA seleção com AND_DESCENDANTS continua consolidando — o scope é o que muda", async () => {
    const restrita = await fetch(url(groupPublicId, restritaIdentityPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const ampla = await fetch(url(groupPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });

    expect(restrita.status).toBe(403);
    expect(ampla.status).toBe(200);
    expect(((await ampla.json()) as ScopeBody).organizations).toHaveLength(2);
  });

  it("C-1: COMPANY filha selecionada por Identity ORGANIZATION_ONLY no grupo -> 403", async () => {
    // A filha não está no PortalContext dela — nem como seleção direta.
    const res = await fetch(url(companyAPublicId, restritaIdentityPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("resposta real nunca ecoa identityPublicId, internalId nem a service credential", async () => {
    const res = await fetch(url(groupPublicId), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: realServiceCredential }
    });
    const raw = await res.text();

    expect(raw).not.toContain(identityPublicId as string);
    expect(raw).not.toContain(realServiceCredential);
    expect(raw.toLowerCase()).not.toContain("internalid");
  });
});
