import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbOrganizationRepository } from "../infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateOrganizationService } from "../application/CreateOrganizationService.js";
import { CreateOrganizationRelationshipService } from "../application/CreateOrganizationRelationshipService.js";
import { GetOrganizationByPublicIdService } from "../application/GetOrganizationByPublicIdService.js";
import { OrganizationRelationshipChildAlreadyLinkedError } from "../domain/errors/OrganizationRelationshipErrors.js";

/**
 * Teste de integração real de Organization Foundation — G1, v0.6.x.
 * Prova a cadeia completa contra um MariaDB de verdade: criar
 * BUSINESS_GROUP fixture -> criar COMPANY fixture -> vincular via
 * OrganizationRelationship -> ler de volta pelos repositories -> segunda
 * tentativa de vínculo da mesma COMPANY falha (uk_org_rel_child).
 *
 * NÃO roda como parte de `npm test`. Só via `npm run test:integration`,
 * com `RUN_INTEGRATION_TESTS=true`. **NÃO EXECUTADO nesta entrega** —
 * preparado apenas, mesmo padrão de
 * `ApplicationAccessEnforcement.integration.test.ts` (Fase F).
 *
 * **Diferença deliberada em relação a Fase F:** este teste NÃO depende
 * de nenhum dado real pré-existente (Fase F precisava ler a
 * `Application PCTEC_INGRESSA` real, pois `Application` não tem comando
 * de criação). `Organization` é um domínio inteiramente novo — nenhuma
 * linha real existe em `organizations`/`organization_relationships`
 * antes deste teste rodar, então TUDO aqui é fixture própria, criada e
 * removida por este arquivo. Nenhum hardcode de `public_id` real do DEV.
 *
 * **Sem migration automática dentro do teste** — pressupõe que as
 * migrations 0010/0011 já foram aplicadas manualmente ao banco de teste
 * antes da execução (mesmo pressuposto de todo teste de integração
 * existente neste repositório, nenhum deles roda `migrate:up` sozinho).
 *
 * **Cleanup específico por `public_id`, nunca `DELETE` genérico** — cada
 * `DELETE` filtra por um `public_id` gerado nesta execução. Ordem de
 * remoção respeita as FKs (`organization_relationships` antes de
 * `organizations`, pois `organization_relationships` referencia
 * `organizations.public_id` com `ON DELETE RESTRICT`).
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("OrganizationFoundation (integração - requer MariaDB real, G1)", () => {
  let pool: Pool;
  let fixtureGroupPublicId: string | undefined;
  let fixtureCompanyPublicId: string | undefined;
  let fixtureSecondGroupPublicId: string | undefined;
  let fixtureRelationshipPublicId: string | undefined;

  const FIXTURE_ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

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
    // Ordem de remoção respeita as FKs: organization_relationships
    // primeiro (referencia organizations.public_id, ON DELETE RESTRICT),
    // depois organizations, depois os audit_events de cada aggregate —
    // nunca um DELETE amplo por tabela inteira.
    if (fixtureRelationshipPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureRelationshipPublicId]);
      await pool.execute(`DELETE FROM organization_relationships WHERE public_id = ?`, [
        fixtureRelationshipPublicId
      ]);
    }
    if (fixtureCompanyPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureCompanyPublicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureCompanyPublicId]);
    }
    if (fixtureGroupPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureGroupPublicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureGroupPublicId]);
    }
    if (fixtureSecondGroupPublicId !== undefined) {
      await pool.execute(`DELETE FROM audit_events WHERE aggregate_public_id = ?`, [fixtureSecondGroupPublicId]);
      await pool.execute(`DELETE FROM organizations WHERE public_id = ?`, [fixtureSecondGroupPublicId]);
    }
    await pool.end();
  });

  it("cria BUSINESS_GROUP fixture real via CreateOrganizationService, contra MariaDB de verdade", async () => {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    const result = await service.execute({
      type: "BUSINESS_GROUP",
      legalName: `Grupo Fixture Integração G1 ${Date.now()}`,
      actorPublicId: FIXTURE_ACTOR_PUBLIC_ID
    });

    fixtureGroupPublicId = result.publicId;
    expect(result.type).toBe("BUSINESS_GROUP");
    expect(result.status).toBe("ACTIVE");
  });

  it("cria COMPANY fixture real via CreateOrganizationService, com documentNumber", async () => {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    // CNPJ sintético, sem dígito verificador real — suficiente para o
    // formato estrutural exigido por DocumentNumber (14 dígitos), nunca
    // um CNPJ real de terceiros.
    const syntheticCnpj = `11222333${String(Date.now()).slice(-6)}`.padEnd(14, "0").slice(0, 14);

    const result = await service.execute({
      type: "COMPANY",
      legalName: `Empresa Fixture Integração G1 ${Date.now()}`,
      documentNumber: syntheticCnpj,
      actorPublicId: FIXTURE_ACTOR_PUBLIC_ID
    });

    fixtureCompanyPublicId = result.publicId;
    expect(result.type).toBe("COMPANY");
  });

  it("cria o OrganizationRelationship GROUP -> COMPANY real via CreateOrganizationRelationshipService", async () => {
    if (fixtureGroupPublicId === undefined || fixtureCompanyPublicId === undefined) {
      throw new Error("fixtures de BUSINESS_GROUP/COMPANY precisam existir antes deste teste (ordem de execução).");
    }
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new CreateOrganizationRelationshipService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationRelationshipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    const result = await service.execute({
      parentOrganizationPublicId: fixtureGroupPublicId,
      childOrganizationPublicId: fixtureCompanyPublicId,
      actorPublicId: FIXTURE_ACTOR_PUBLIC_ID
    });

    fixtureRelationshipPublicId = result.publicId;
    expect(result.parentOrganizationPublicId).toBe(fixtureGroupPublicId);
    expect(result.childOrganizationPublicId).toBe(fixtureCompanyPublicId);
  });

  it("lê as duas Organizations de volta pelo GetOrganizationByPublicIdService, dados batendo com o que foi criado", async () => {
    if (fixtureGroupPublicId === undefined || fixtureCompanyPublicId === undefined) {
      throw new Error("fixtures precisam existir antes deste teste (ordem de execução).");
    }
    const organizationRepository = new MariaDbOrganizationRepository(pool);
    const getGroupService = new GetOrganizationByPublicIdService(organizationRepository);

    const group = await getGroupService.execute(fixtureGroupPublicId);
    const company = await getGroupService.execute(fixtureCompanyPublicId);

    expect(group.getType().toString()).toBe("BUSINESS_GROUP");
    expect(group.getDocumentNumber()).toBeUndefined();
    expect(company.getType().toString()).toBe("COMPANY");
    expect(company.getDocumentNumber()).toBeDefined();
  });

  it("existsByChildOrganizationPublicId (repository) confirma o vínculo real gravado", async () => {
    if (fixtureCompanyPublicId === undefined) {
      throw new Error("fixture de COMPANY precisa existir antes deste teste (ordem de execução).");
    }
    const relationshipRepository = new MariaDbOrganizationRelationshipRepository(pool);
    const { PublicId } = await import("../domain/value-objects/PublicId.js");

    const exists = await relationshipRepository.existsByChildOrganizationPublicId(
      PublicId.fromString(fixtureCompanyPublicId)
    );

    expect(exists).toBe(true);
  });

  it("uk_org_rel_child real: tentar vincular a MESMA COMPANY fixture a um SEGUNDO BUSINESS_GROUP falha com OrganizationRelationshipChildAlreadyLinkedError", async () => {
    if (fixtureCompanyPublicId === undefined) {
      throw new Error("fixture de COMPANY precisa existir antes deste teste (ordem de execução).");
    }
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const createOrganizationService = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const createRelationshipService = new CreateOrganizationRelationshipService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationRelationshipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    // Segundo BUSINESS_GROUP fixture, criado SÓ para este teste — cleanup
    // próprio em afterAll (fixtureSecondGroupPublicId), independente do
    // primeiro. Nunca reaproveita o primeiro grupo para não confundir
    // qual vínculo pertence a qual teste.
    const secondGroup = await createOrganizationService.execute({
      type: "BUSINESS_GROUP",
      legalName: `Segundo Grupo Fixture Integração G1 ${Date.now()}`,
      actorPublicId: FIXTURE_ACTOR_PUBLIC_ID
    });
    fixtureSecondGroupPublicId = secondGroup.publicId;

    await expect(
      createRelationshipService.execute({
        parentOrganizationPublicId: secondGroup.publicId,
        childOrganizationPublicId: fixtureCompanyPublicId,
        actorPublicId: FIXTURE_ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipChildAlreadyLinkedError);

    // Nenhum OrganizationRelationship novo deve ter sido criado por essa
    // tentativa rejeitada — nenhum public_id adicional para limpar além
    // do já registrado em fixtureRelationshipPublicId.
  });
});
