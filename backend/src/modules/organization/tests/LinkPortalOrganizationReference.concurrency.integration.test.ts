import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbOrganizationRepository } from "../infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateOrganizationExternalReferenceService } from "../application/CreateOrganizationExternalReferenceService.js";
import {
  LinkPortalOrganizationReferenceService,
  type LinkPortalOrganizationReferenceResult
} from "../application/LinkPortalOrganizationReferenceService.js";
import { Identity } from "../../identity/domain/Identity.js";
import { Organization } from "../domain/Organization.js";
import { PortalReferenceAlreadyLinkedDifferentError } from "../domain/errors/PortalOrganizationReferenceErrors.js";

/**
 * A CORRIDA, contra MariaDB real, com DUAS conexões.
 *
 * ## O defeito que este teste existe para impedir
 *
 * A versão anterior deste serviço lia a referência ativa numa consulta e,
 * se não achasse nada, chamava o serviço de criação — que abria OUTRA
 * transação. Entre a leitura e a escrita havia uma janela.
 *
 * A `UNIQUE KEY uk_org_ext_ref_active_match` (migration 0013) não fecha
 * essa janela: ela cobre `(system_code, entity_type, legacy_id)` e
 * impede duas ORGANIZAÇÕES de reivindicarem o mesmo `clientes.id`. Ela
 * não diz nada sobre a mesma organização ganhar duas referências ACTIVE
 * com `legacyId` DIFERENTES — e era exatamente esse o caso: dois
 * pedidos simultâneos para a mesma COMPANY, com 71 e 99, ambos liam
 * "não existe nenhuma" e ambos criavam. Depois disso, qualquer
 * `LIMIT 1` escolheria uma delas em silêncio.
 *
 * ## Por que um mock sequencial não provaria nada
 *
 * Um duplo em memória executa uma chamada de cada vez: a segunda sempre
 * enxerga o efeito da primeira, independentemente de haver bloqueio. Só
 * duas conexões reais, disputando a MESMA linha ao mesmo tempo, provam
 * que quem serializa é o InnoDB — e não a ordem em que o teste chamou.
 *
 * ## O que se espera
 *
 * As duas chamadas partem juntas. Uma obtém o `FOR UPDATE` da linha da
 * Organization e cria; a outra espera nele, relê DEPOIS do commit da
 * primeira, encontra a referência recém-criada e recusa com
 * `PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT`. Ao fim: **uma** referência
 * ACTIVE e **um** evento de auditoria.
 *
 * **Só roda com `RUN_INTEGRATION_TESTS=true` e `DB_NAME` terminando em
 * `_test`** — `shouldRunIntegrationTests()` lança antes da primeira
 * escrita se apontarem para outro banco.
 *
 * Fixtures próprias e sintéticas, removidas no fim. O ator precisa ser
 * uma Identity real: `organization_external_references` audita por
 * `actor_public_id`, e `audit_events` tem integridade referencial a
 * respeitar.
 */
const shouldRun = shouldRunIntegrationTests();

const SYSTEM_CODE = "PCTEC_PORTAL";
const ENTITY_TYPE = "clientes";

describe.skipIf(!shouldRun)("Vínculo com o Portal — concorrência (integração, MariaDB real)", () => {
  let pool: Pool;
  let adminPublicId: string;
  const organizacoesCriadas: string[] = [];
  /** `legacyId` sintéticos e altos, para não colidir com fixture de outra suíte. */
  const legacyBase = 900_000 + Math.floor(Number(randomUUID().replace(/\D/g, "").slice(0, 5)) % 50_000);

  function servico(): LinkPortalOrganizationReferenceService {
    return new LinkPortalOrganizationReferenceService(
      new MariaDbUnitOfWork(pool),
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
  }

  async function novaEmpresa(): Promise<string> {
    const organizacao = Organization.create({
      type: "COMPANY",
      legalName: `EMPRESA CONCORRENCIA ${randomUUID().slice(0, 8)}`,
      actorPublicId: adminPublicId,
      correlationId: randomUUID()
    });
    await new MariaDbOrganizationRepository(pool).insert(organizacao);
    const publicId = organizacao.getPublicId().toString();
    organizacoesCriadas.push(publicId);
    return publicId;
  }

  async function referenciasAtivas(organizationPublicId: string) {
    const [linhas] = await pool.execute(
      `SELECT public_id, legacy_id FROM organization_external_references
        WHERE organization_public_id = ? AND system_code = ? AND entity_type = ? AND status = 'ACTIVE'`,
      [organizationPublicId, SYSTEM_CODE, ENTITY_TYPE]
    );
    return linhas as { public_id: string; legacy_id: number | string }[];
  }

  async function eventosDeCriacao(organizationPublicId: string) {
    const referencias = await referenciasAtivas(organizationPublicId);
    if (referencias.length === 0) {
      return [];
    }
    const marcadores = referencias.map(() => "?").join(", ");
    const [linhas] = await pool.execute(
      `SELECT id FROM audit_events
        WHERE event_type = 'organization-external-reference.created'
          AND aggregate_public_id IN (${marcadores})`,
      referencias.map((r) => r.public_id)
    );
    return linhas as { id: number }[];
  }

  beforeAll(async () => {
    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });

    const admin = Identity.createFoundational({
      fullName: "Administrador De Concorrencia",
      email: `admin.concorrencia.${randomUUID().slice(0, 8)}@example.invalid`,
      correlationId: randomUUID()
    });
    await new MariaDbIdentityRepository(pool).insert(admin);
    adminPublicId = admin.getPublicId().toString();
  });

  afterAll(async () => {
    if (pool !== undefined) {
      // Limpeza específica, nunca DELETE genérico.
      for (const publicId of organizacoesCriadas) {
        await pool.execute(
          `DELETE FROM audit_events WHERE aggregate_public_id IN (
             SELECT public_id FROM organization_external_references WHERE organization_public_id = ?
           )`,
          [publicId]
        );
        await pool.execute("DELETE FROM organization_external_references WHERE organization_public_id = ?", [publicId]);
        await pool.execute("DELETE FROM audit_events WHERE aggregate_public_id = ?", [publicId]);
        await pool.execute("DELETE FROM organizations WHERE public_id = ?", [publicId]);
      }
      if (adminPublicId !== undefined) {
        await pool.execute("DELETE FROM audit_events WHERE actor_public_id = ?", [adminPublicId]);
        await pool.execute("DELETE FROM identities WHERE public_id = ?", [adminPublicId]);
      }
      await pool.end();
    }
  });

  it("CENTRAL: duas chamadas simultâneas, legacyIds diferentes → uma referência, uma recusa, um evento", async () => {
    const empresa = await novaEmpresa();
    const primeiro = legacyBase + 1;
    const segundo = legacyBase + 2;

    // Partem juntas, em conexões diferentes do pool. Quem chega primeiro
    // ao bloqueio é indiferente — o que importa é que só uma escreva.
    const resultados = await Promise.allSettled([
      servico().execute({
        organizationPublicId: empresa,
        legacyId: primeiro,
        actorPublicId: adminPublicId,
        correlationId: randomUUID()
      }),
      servico().execute({
        organizationPublicId: empresa,
        legacyId: segundo,
        actorPublicId: adminPublicId,
        correlationId: randomUUID()
      })
    ]);

    const criadas = resultados.filter((r) => r.status === "fulfilled");
    const recusadas = resultados.filter((r) => r.status === "rejected");

    expect(criadas).toHaveLength(1);
    expect(recusadas).toHaveLength(1);
    expect((recusadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PortalReferenceAlreadyLinkedDifferentError
    );

    // O banco é a prova final: uma linha ACTIVE, não duas.
    const ativas = await referenciasAtivas(empresa);
    expect(ativas).toHaveLength(1);
    expect([primeiro, segundo]).toContain(Number(ativas[0]?.legacy_id));

    // E exatamente um evento de auditoria — a recusa não gera evento.
    expect(await eventosDeCriacao(empresa)).toHaveLength(1);
  });

  it("duas chamadas simultâneas com o MESMO legacyId: uma cria, a outra é idempotente", async () => {
    const empresa = await novaEmpresa();
    const legacyId = legacyBase + 11;

    const resultados = await Promise.allSettled([
      servico().execute({ organizationPublicId: empresa, legacyId, actorPublicId: adminPublicId }),
      servico().execute({ organizationPublicId: empresa, legacyId, actorPublicId: adminPublicId })
    ]);

    // Nenhuma das duas falha: a segunda encontra a referência idêntica e
    // devolve `alreadyLinked`.
    const cumpridas = resultados.filter(
      (r): r is PromiseFulfilledResult<LinkPortalOrganizationReferenceResult> => r.status === "fulfilled"
    );
    expect(cumpridas).toHaveLength(2);
    expect(cumpridas.filter((r) => r.value.alreadyLinked === false)).toHaveLength(1);
    expect(cumpridas.filter((r) => r.value.alreadyLinked === true)).toHaveLength(1);

    expect(await referenciasAtivas(empresa)).toHaveLength(1);
    // Idempotente também na auditoria: um evento, não dois.
    expect(await eventosDeCriacao(empresa)).toHaveLength(1);
  });

  it("sequencial: mesmo legacyId é idempotente e não grava evento novo", async () => {
    const empresa = await novaEmpresa();
    const legacyId = legacyBase + 21;

    const primeira = await servico().execute({
      organizationPublicId: empresa,
      legacyId,
      actorPublicId: adminPublicId
    });
    const segunda = await servico().execute({
      organizationPublicId: empresa,
      legacyId,
      actorPublicId: adminPublicId
    });

    expect(primeira.alreadyLinked).toBe(false);
    expect(segunda.alreadyLinked).toBe(true);
    expect(segunda.publicId).toBe(primeira.publicId);
    expect(await referenciasAtivas(empresa)).toHaveLength(1);
    expect(await eventosDeCriacao(empresa)).toHaveLength(1);
  });

  it("sequencial: legacyId diferente é recusado e nada é escrito", async () => {
    const empresa = await novaEmpresa();

    await servico().execute({
      organizationPublicId: empresa,
      legacyId: legacyBase + 31,
      actorPublicId: adminPublicId
    });
    await expect(
      servico().execute({
        organizationPublicId: empresa,
        legacyId: legacyBase + 32,
        actorPublicId: adminPublicId
      })
    ).rejects.toBeInstanceOf(PortalReferenceAlreadyLinkedDifferentError);

    const ativas = await referenciasAtivas(empresa);
    expect(ativas).toHaveLength(1);
    expect(Number(ativas[0]?.legacy_id)).toBe(legacyBase + 31);
    expect(await eventosDeCriacao(empresa)).toHaveLength(1);
  });

  it("legacyId já usado por OUTRA organização continua recusado pela invariante global", async () => {
    const primeira = await novaEmpresa();
    const segunda = await novaEmpresa();
    const legacyId = legacyBase + 41;

    await servico().execute({ organizationPublicId: primeira, legacyId, actorPublicId: adminPublicId });

    await expect(
      servico().execute({ organizationPublicId: segunda, legacyId, actorPublicId: adminPublicId })
    ).rejects.toMatchObject({ code: "ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS" });

    expect(await referenciasAtivas(segunda)).toHaveLength(0);
  });

  it("empresas DIFERENTES não esperam uma pela outra: as duas são vinculadas", async () => {
    // O bloqueio é de linha. Se fosse de tabela, ou se o desenho
    // serializasse tudo, este teste ficaria lento ou falharia.
    const primeira = await novaEmpresa();
    const segunda = await novaEmpresa();

    const resultados = await Promise.all([
      servico().execute({
        organizationPublicId: primeira,
        legacyId: legacyBase + 51,
        actorPublicId: adminPublicId
      }),
      servico().execute({
        organizationPublicId: segunda,
        legacyId: legacyBase + 52,
        actorPublicId: adminPublicId
      })
    ]);

    expect(resultados.every((r) => r.alreadyLinked === false)).toBe(true);
    expect(await referenciasAtivas(primeira)).toHaveLength(1);
    expect(await referenciasAtivas(segunda)).toHaveLength(1);
  });
});
