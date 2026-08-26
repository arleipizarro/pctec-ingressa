import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbOrganizationRepository } from "../../organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbMembershipRepository } from "../../organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbApplicationRepository } from "../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateIdentityService } from "../../identity/application/CreateIdentityService.js";
import { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import { Identity } from "../../identity/domain/Identity.js";
import { Organization } from "../../organization/domain/Organization.js";
import { ProvisionOrganizationUserService } from "../application/ProvisionOrganizationUserService.js";

/**
 * Rollback do provisionamento contra MariaDB REAL.
 *
 * Os testes de unidade provam a atomicidade contra um `UnitOfWork` que
 * MODELA rollback restaurando mapas em memória. Isso é suficiente para
 * travar o desenho — mas não prova que o InnoDB desfaz de fato o que já
 * foi escrito quando a transação estoura no meio.
 *
 * Aqui a falha é injetada DEPOIS que a segunda concessão realmente
 * inseriu a linha: Identity, Membership e DOIS `ApplicationAccess` já
 * existem fisicamente dentro da transação quando o erro sobe. Se o
 * `runInTransaction` não estivesse cobrindo tudo, sobraria pelo menos a
 * Identity — que é exatamente o estado parcial que esta entrega proíbe,
 * e o que aconteceria se cada Application Service abrisse a própria
 * transação em vez de participar da de fora.
 *
 * **Só roda com `RUN_INTEGRATION_TESTS=true` e `DB_NAME` terminando em
 * `_test`** — `shouldRunIntegrationTests()` lança antes da primeira
 * escrita se apontarem para outro banco. A guarda existe por um
 * incidente real: identidades sintéticas de suíte de integração ficaram
 * no DEV e passaram a aparecer na tela administrativa como se fossem
 * gente.
 *
 * **Fixtures próprias e sintéticas.** A Identity que atua como ADMIN e a
 * Organization são criadas por este arquivo e removidas no fim; nenhuma
 * pessoa ou organização real é tocada. As Applications são as já
 * semeadas por migration (`PCTEC_PORTAL`, `PCTEC_HELPDESK`), lidas,
 * nunca criadas.
 *
 * O ator precisa ser uma Identity de verdade: `application_accesses`
 * tem FK `fk_app_access_granted_by` para `identities.public_id`. Um UUID
 * inventado faria a segunda concessão estourar na constraint ANTES da
 * falha que este teste quer injetar — o teste passaria pelo motivo
 * errado, provando o rollback de um erro diferente do descrito.
 */
const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("Provisionamento de usuário — rollback (integração, MariaDB real)", () => {
  let pool: Pool;
  let organizationPublicId: string;
  let adminPublicId: string;

  // E-mail sintético e único por execução: o teste não pode depender de
  // o banco estar limpo, nem sujar a próxima execução.
  const EMAIL = `rollback.${randomUUID().slice(0, 8)}@example.invalid`;

  beforeAll(async () => {
    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });

    // `createFoundational` porque não existe ator anterior a esta
    // fixture — mesmo caminho do bootstrap da plataforma. Os eventos de
    // domínio dela são descartados: a fixture não é o que se audita.
    const admin = Identity.createFoundational({
      fullName: "Administrador De Teste",
      email: `admin.rollback.${randomUUID().slice(0, 8)}@example.invalid`,
      correlationId: randomUUID()
    });
    await new MariaDbIdentityRepository(pool).insert(admin);
    adminPublicId = admin.getPublicId().toString();

    const organizacao = Organization.create({
      type: "COMPANY",
      legalName: `EMPRESA DE TESTE ${randomUUID().slice(0, 8)}`,
      actorPublicId: adminPublicId,
      correlationId: randomUUID()
    });
    await new MariaDbOrganizationRepository(pool).insert(organizacao);
    organizationPublicId = organizacao.getPublicId().toString();
  });

  afterAll(async () => {
    if (pool !== undefined) {
      // Limpeza específica por public_id, nunca DELETE genérico.
      if (organizationPublicId !== undefined) {
        await pool.execute("DELETE FROM organizations WHERE public_id = ?", [organizationPublicId]);
      }
      if (adminPublicId !== undefined) {
        await pool.execute("DELETE FROM audit_events WHERE actor_public_id = ?", [adminPublicId]);
        await pool.execute("DELETE FROM identities WHERE public_id = ?", [adminPublicId]);
      }
      await pool.end();
    }
  });

  it("falha ao conceder o segundo acesso não deixa NADA no banco", async () => {
    let concessoes = 0;

    const service = new ProvisionOrganizationUserService({
      unitOfWork: new MariaDbUnitOfWork(pool),
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
      // Serviço REAL, com uma falha pendurada DEPOIS do insert da
      // segunda concessão: a linha existe fisicamente na transação
      // quando o erro sobe. É o que torna este teste diferente do de
      // unidade — aqui quem precisa desfazer é o InnoDB.
      grantApplicationAccessServiceFactory: (uow) => {
        const real = new GrantApplicationAccessService(
          uow,
          (c) => new MariaDbApplicationRepository(c),
          (c) => new MariaDbIdentityRepository(c),
          (c) => new MariaDbApplicationAccessRepository(c),
          (c) => new MariaDbAuditEventRepository(c)
        );
        return {
          execute: async (request: Parameters<GrantApplicationAccessService["execute"]>[0]) => {
            const resultado = await real.execute(request);
            concessoes += 1;
            if (concessoes === 2) {
              throw new Error("falha simulada APÓS a segunda concessão já ter sido inserida");
            }
            return resultado;
          }
        } as GrantApplicationAccessService;
      }
    });

    await expect(
      service.execute({
        organizationPublicId,
        fullName: "Pessoa De Rollback",
        email: EMAIL,
        membershipProfile: "CUSTOMER",
        membershipScope: "ORGANIZATION_ONLY",
        applicationCodes: ["PCTEC_PORTAL", "PCTEC_HELPDESK"],
        actorPublicId: adminPublicId
      })
    ).rejects.toThrow(/APÓS a segunda concessão/);

    // As duas concessões chegaram a rodar de verdade — se não tivessem,
    // o teste provaria apenas que a validação barra cedo, não que o
    // banco desfaz.
    expect(concessoes).toBe(2);

    const [identidades] = await pool.execute(
      "SELECT public_id FROM identities WHERE email_normalized = ?",
      [EMAIL.toLowerCase()]
    );
    expect(identidades as unknown[]).toHaveLength(0);

    const [vinculos] = await pool.execute(
      "SELECT public_id FROM memberships WHERE organization_public_id = ?",
      [organizationPublicId]
    );
    expect(vinculos as unknown[]).toHaveLength(0);

    const [acessos] = await pool.execute(
      "SELECT public_id FROM application_accesses WHERE granted_by_identity_public_id = ?",
      [adminPublicId]
    );
    expect(acessos as unknown[]).toHaveLength(0);

    // Nem os eventos de auditoria sobrevivem: eles são gravados na
    // MESMA transação, e auditoria de algo que não aconteceu é pior que
    // auditoria nenhuma.
    const [eventos] = await pool.execute(
      "SELECT event_public_id FROM audit_events WHERE actor_public_id = ?",
      [adminPublicId]
    );
    expect(eventos as unknown[]).toHaveLength(0);
  });
});
