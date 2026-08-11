import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbOrganizationRepository } from "../infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbMembershipRepository } from "../infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { CreateOrganizationService } from "../application/CreateOrganizationService.js";
import { CreateMembershipService } from "../application/CreateMembershipService.js";
import { GetMembershipsByIdentityService } from "../application/GetMembershipsByIdentityService.js";
import { CreateOrganizationExternalReferenceService } from "../application/CreateOrganizationExternalReferenceService.js";
import { GetOrganizationExternalReferenceService } from "../application/GetOrganizationExternalReferenceService.js";
import { MembershipAlreadyExistsError } from "../domain/errors/MembershipErrors.js";
import { OrganizationExternalReferenceAlreadyExistsError } from "../domain/errors/OrganizationExternalReferenceErrors.js";

/**
 * Teste de integração real de Organization Membership — G2, v0.6.x.
 * Prova a cadeia completa contra um MariaDB de verdade: criar Identity
 * fixture -> criar Organization fixture -> criar Membership real ->
 * ler de volta -> segunda tentativa do MESMO Membership falha
 * (uk_membership_unique) -> criar OrganizationExternalReference real ->
 * segunda tentativa da MESMA referência ACTIVE falha
 * (uk_org_ext_ref_active_match — coluna gerada, garante no máximo 1
 * ACTIVE por chave lógica sob concorrência real, migration 0013).
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, mesmo padrão de
 * `OrganizationFoundation.integration.test.ts` (G1).
 *
 * **Fixtures próprias, nenhuma dependência de dado real pré-existente:**
 * `Identity` e `Organization` são criadas por este arquivo (não usa a
 * Identity real do Product Owner nem nenhuma Organization real).
 * `Membership`/`OrganizationExternalReference` são domínios inteiramente
 * novos — nenhuma linha real existe antes deste teste rodar.
 *
 * **Nenhum dado real de HUB/Portal/Helpdesk** — o `legacyId`/`systemCode`/
 * `entityType` usados são valores sintéticos de teste (`PCTEC_HUB`,
 * `clientes`, um `legacyId` grande e improvável de colidir com dado
 * real), nunca uma leitura de fato dos bancos legados.
 *
 * **Sem migration automática dentro do teste** — pressupõe que as
 * migrations 0012/0013 já foram aplicadas manualmente ao banco de teste
 * antes da execução.
 *
 * **Cleanup específico por `public_id`, nunca `DELETE` genérico** —
 * ordem de remoção respeita FKs: `memberships`/
 * `organization_external_references` antes de `organizations`/
 * `identities` (ambas RESTRICT).
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("OrganizationMembership (integração - requer MariaDB real, G2)", () => {
  let pool: Pool;
  let fixtureIdentityPublicId: string | undefined;
  let fixtureOrganizationPublicId: string | undefined;
  let fixtureMembershipPublicId: string | undefined;
  let fixtureExternalReferencePublicId: string | undefined;

  const FIXTURE_SYSTEM_ACTOR = ActorPublicId.system();
  // legacyId sintético, improvável de colidir com dado real (nunca lido
  // de HUB/Helpdesk/Portal de verdade).
  const FIXTURE_LEGACY_ID = 900000000 + Math.floor(Math.random() * 99999);

  beforeAll(async () => {
    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });
  });

  afterAll(async () => {
    // Ordem de remoção respeita as FKs: memberships e
    // organization_external_references primeiro (RESTRICT sobre
    // identities/organizations), depois organizations, depois
    // identities, depois os audit_events de cada aggregate — nunca um
    // DELETE amplo por tabela inteira.
    if (fixtureMembershipPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureMembershipPublicId]);
      await pool.execute(`DELETE FROM memberships WHERE public_id = ?`, [fixtureMembershipPublicId]);
    }
    if (fixtureExternalReferencePublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [
        fixtureExternalReferencePublicId
      ]);
      await pool.execute(`DELETE FROM organization_external_references WHERE public_id = ?`, [
        fixtureExternalReferencePublicId
      ]);
    }
    if (fixtureOrganizationPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureOrganizationPublicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureOrganizationPublicId]);
    }
    if (fixtureIdentityPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureIdentityPublicId]);
      await pool.execute(`DELETE FROM identities WHERE public_id = ?`, [fixtureIdentityPublicId]);
    }
    await pool.end();
  });

  it("cria Identity fixture real (via Identity.create + MariaDbIdentityRepository, sem passar pelo bootstrap)", async () => {
    const identityRepository = new MariaDbIdentityRepository(pool);
    const fixtureIdentity = Identity.create({
      type: "HUMAN",
      fullName: "Fixture de Integracao - Organization Membership v0.6.x",
      email: `organization-membership-integration-${Date.now()}@example.invalid`,
      actor: FIXTURE_SYSTEM_ACTOR,
      correlationId: "00000000-0000-0000-0000-000000000000"
    });
    await identityRepository.insert(fixtureIdentity);
    fixtureIdentityPublicId = fixtureIdentity.getPublicId().toString();

    expect(fixtureIdentityPublicId).toBeDefined();
  });

  it("cria Organization fixture real via CreateOrganizationService", async () => {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    const result = await service.execute({
      type: "COMPANY",
      legalName: `Empresa Fixture Integração G2 ${Date.now()}`,
      actorPublicId: fixtureIdentityPublicId ?? FIXTURE_SYSTEM_ACTOR.toString()
    });

    fixtureOrganizationPublicId = result.publicId;
    expect(result.status).toBe("ACTIVE");
  });

  it("cria Membership real via CreateMembershipService, ligando a Identity fixture à Organization fixture", async () => {
    if (fixtureIdentityPublicId === undefined || fixtureOrganizationPublicId === undefined) {
      throw new Error("fixtures de Identity/Organization precisam existir antes deste teste (ordem de execução).");
    }
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateMembershipService(
      unitOfWork,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbMembershipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    const result = await service.execute({
      identityPublicId: fixtureIdentityPublicId,
      organizationPublicId: fixtureOrganizationPublicId,
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: fixtureIdentityPublicId
    });

    fixtureMembershipPublicId = result.publicId;
    expect(result.status).toBe("ACTIVE");
  });

  it("lê o Membership de volta via GetMembershipsByIdentityService", async () => {
    if (fixtureIdentityPublicId === undefined) {
      throw new Error("fixture de Identity precisa existir antes deste teste.");
    }
    const membershipRepository = new MariaDbMembershipRepository(pool);
    const service = new GetMembershipsByIdentityService(membershipRepository);

    const memberships = await service.execute(fixtureIdentityPublicId);

    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.getPublicId().toString()).toBe(fixtureMembershipPublicId);
  });

  it("uk_membership_unique real: segunda tentativa do MESMO Membership (identity+organization+profile) falha", async () => {
    if (fixtureIdentityPublicId === undefined || fixtureOrganizationPublicId === undefined) {
      throw new Error("fixtures precisam existir antes deste teste.");
    }
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateMembershipService(
      unitOfWork,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbMembershipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    await expect(
      service.execute({
        identityPublicId: fixtureIdentityPublicId,
        organizationPublicId: fixtureOrganizationPublicId,
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: fixtureIdentityPublicId
      })
    ).rejects.toThrow(MembershipAlreadyExistsError);
  });

  it("cria OrganizationExternalReference real via CreateOrganizationExternalReferenceService", async () => {
    if (fixtureOrganizationPublicId === undefined) {
      throw new Error("fixture de Organization precisa existir antes deste teste.");
    }
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateOrganizationExternalReferenceService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    const result = await service.execute({
      organizationPublicId: fixtureOrganizationPublicId,
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: FIXTURE_LEGACY_ID,
      actorPublicId: fixtureIdentityPublicId ?? FIXTURE_SYSTEM_ACTOR.toString()
    });

    fixtureExternalReferencePublicId = result.publicId;
    expect(result.systemCode).toBe("PCTEC_HUB");
  });

  it("lê a OrganizationExternalReference de volta via GetOrganizationExternalReferenceService", async () => {
    if (fixtureExternalReferencePublicId === undefined) {
      throw new Error("fixture de OrganizationExternalReference precisa existir antes deste teste.");
    }
    const referenceRepository = new MariaDbOrganizationExternalReferenceRepository(pool);
    const service = new GetOrganizationExternalReferenceService(referenceRepository);

    const reference = await service.execute(fixtureExternalReferencePublicId);

    expect(reference).toBeDefined();
    expect(reference?.getLegacyId().toNumber()).toBe(FIXTURE_LEGACY_ID);
  });

  it("uk_org_ext_ref_active_match real: segunda tentativa da MESMA (systemCode, entityType, legacyId) ACTIVE falha", async () => {
    if (fixtureOrganizationPublicId === undefined) {
      throw new Error("fixture de Organization precisa existir antes deste teste.");
    }
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateOrganizationExternalReferenceService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    await expect(
      service.execute({
        organizationPublicId: fixtureOrganizationPublicId,
        systemCode: "PCTEC_HUB",
        entityType: "clientes",
        legacyId: FIXTURE_LEGACY_ID,
        actorPublicId: fixtureIdentityPublicId ?? FIXTURE_SYSTEM_ACTOR.toString()
      })
    ).rejects.toThrow(OrganizationExternalReferenceAlreadyExistsError);
  });
});
