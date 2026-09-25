/**
 * Persistência MariaDB da Central de Serviços contra `pctec_ingressa_test`.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e `DB_NAME` terminado em `_test`
 * (`shouldRunIntegrationTests` → `assertIsolatedIntegrationDatabase`).
 * Fixtures sintéticas (`@example.invalid`), removidas ao final.
 */
import { createHash } from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID } from "../../application/domain/value-objects/ApplicationCodes.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { CentralServicosService } from "../application/CentralServicosService.js";
import { DelegationAssertionAlreadyIssuedError } from "../application/errors/CentralServicosErrors.js";
import { MariaDbCentralServicosPersistence } from "../infrastructure/persistence/MariaDbCentralServicosPersistence.js";

const shouldRun = shouldRunIntegrationTests();

const PESSOA = "c0ffee00-0000-4000-8000-000000999931";
const EMAIL = "operador.central.999931@example.invalid";
const ACESSO = "c0ffee00-0000-4000-8000-000000999932";
const PAPEL = "c0ffee00-0000-4000-8000-000000999933";

const acao = (n: number) => ({
  ticketId: 999900 + n,
  idempotencyKey: `n1:teste-integracao-${n}`,
  actionKind: "ANDAMENTO_INTERNO",
  contentSha256: createHash("sha256").update(`conteudo ${n}`).digest("hex")
});

describe.skipIf(!shouldRun)("Central de Serviços — MariaDB", () => {
  let pool: Pool;
  let service: CentralServicosService;

  async function limpar(): Promise<void> {
    await pool.execute("DELETE FROM delegation_assertions WHERE identity_public_id = ?", [PESSOA]);
    await pool.execute("DELETE FROM application_role_assignments WHERE identity_public_id = ?", [PESSOA]);
    await pool.execute("DELETE FROM application_accesses WHERE identity_public_id = ?", [PESSOA]);
    await pool.execute("DELETE FROM identities WHERE public_id = ?", [PESSOA]);
  }

  beforeAll(async () => {
    pool = createPool({
      host: process.env["DB_HOST"] ?? "127.0.0.1",
      port: Number(process.env["DB_PORT"] ?? 3306),
      user: process.env["DB_USER"] ?? "root",
      password: process.env["DB_PASSWORD"] ?? "",
      database: process.env["DB_NAME"] ?? "pctec_ingressa_test",
      timezone: "Z"
    });
    service = new CentralServicosService({
      persistencia: new MariaDbCentralServicosPersistence(pool, new MariaDbUnitOfWork(pool), (c) => new MariaDbAuditEventRepository(c)),
      validadeAssercaoSegundos: 600
    });
  });

  beforeEach(async () => {
    await limpar();
    await pool.execute(
      `INSERT INTO identities (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', 'Operador Sintetico', ?, ?, 'ACTIVE', 1, 1, NOW(3), NOW(3))`,
      [PESSOA, EMAIL, EMAIL]
    );
    await pool.execute(
      `INSERT INTO application_accesses
         (public_id, identity_public_id, application_public_id, access_profile, status, granted_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', 'GRANTED', NOW(3), 1, NOW(3), NOW(3))`,
      [ACESSO, PESSOA, PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID]
    );
    await pool.execute(
      `INSERT INTO application_role_assignments
         (public_id, identity_public_id, application_public_id, role_code, status, granted_at, granted_by_label, version, created_at, updated_at)
       VALUES (?, ?, ?, 'N1_OPERADOR', 'GRANTED', NOW(3), 'TESTE_INTEGRACAO', 1, NOW(3), NOW(3))`,
      [PAPEL, PESSOA, PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID]
    );
  });

  afterAll(async () => {
    if (pool) {
      await limpar();
      await pool.end();
    }
  });

  it("catálogo: Application e os dois perfis semeados por 0030/0031", async () => {
    const [linhas] = await pool.execute(
      "SELECT code, status FROM application_roles WHERE application_public_id = ? ORDER BY sort_order",
      [PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID]
    );
    expect(linhas).toEqual([
      { code: "N1_OPERADOR", status: "ACTIVE" },
      { code: "APROVADOR_TI", status: "ACTIVE" }
    ]);
  });

  it("autorização lê camada 1 e 2 e reflete revogação imediatamente", async () => {
    expect(await service.autorizacao(PESSOA)).toMatchObject({ accessProfile: "USER", roles: ["N1_OPERADOR"] });
    await pool.execute("UPDATE application_role_assignments SET status = 'REVOKED', revoked_at = NOW(3) WHERE public_id = ?", [PAPEL]);
    expect(await service.autorizacao(PESSOA)).toMatchObject({ accessProfile: "USER", roles: [] });
    await pool.execute("UPDATE identities SET status = 'BLOCKED' WHERE public_id = ?", [PESSOA]);
    expect(await service.autorizacao(PESSOA)).toMatchObject({ accessProfile: null, roles: [] });
  });

  it("emissão grava só o hash, é única por ação e deixa auditoria sem o token", async () => {
    const r = await service.emitirAssercao({ identityPublicId: PESSOA, ...acao(1) });
    const [linhas] = await pool.execute("SELECT * FROM delegation_assertions WHERE identity_public_id = ?", [PESSOA]);
    const texto = JSON.stringify(linhas);
    expect(texto).not.toContain(r.assertion);
    expect(texto).toContain(createHash("sha256").update(r.assertion).digest("hex"));
    await expect(service.emitirAssercao({ identityPublicId: PESSOA, ...acao(1) })).rejects.toBeInstanceOf(DelegationAssertionAlreadyIssuedError);

    const [eventos] = await pool.execute("SELECT event_type, payload_json FROM audit_events WHERE aggregate_public_id = ?", [r.assertionPublicId]);
    expect((eventos as { event_type: string }[]).map((e) => e.event_type)).toEqual(["delegation-assertion.issued"]);
    expect(JSON.stringify(eventos)).not.toContain(r.assertion);
  });

  it("verificação consome uma vez, recusa amarração diferente e perfil revogado", async () => {
    const verificar = (assertion: string, extra: Record<string, unknown> = {}) =>
      service.verificarAssercao({ assertion, audience: "PCTEC_HELPDESK", consumer: "PCTEC_HELPDESK", ...acao(2), ...extra });

    const { assertion } = await service.emitirAssercao({ identityPublicId: PESSOA, ...acao(2) });
    expect(await verificar(assertion, { ticketId: 1 })).toEqual({ status: "INVALID", reason: "BINDING_MISMATCH" });
    expect(await verificar(assertion)).toMatchObject({ status: "VALID", identityPublicId: PESSOA, issuerApplicationCode: "PCTEC_CENTRAL_SERVICOS" });
    expect(await verificar(assertion)).toMatchObject({ status: "ALREADY_USED" });

    const outra = await service.emitirAssercao({ identityPublicId: PESSOA, ...acao(3) });
    await pool.execute("UPDATE application_role_assignments SET status = 'REVOKED', revoked_at = NOW(3) WHERE public_id = ?", [PAPEL]);
    expect(await service.verificarAssercao({ assertion: outra.assertion, audience: "PCTEC_HELPDESK", consumer: "PCTEC_HELPDESK", ...acao(3) })).toEqual({
      status: "REVOKED"
    });
  });

  it("verificações simultâneas da mesma asserção: exatamente uma VALID", async () => {
    const { assertion } = await service.emitirAssercao({ identityPublicId: PESSOA, ...acao(4) });
    const r = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.verificarAssercao({ assertion, audience: "PCTEC_HELPDESK", consumer: "PCTEC_HELPDESK", ...acao(4) })
      )
    );
    expect(r.filter((x) => x.status === "VALID")).toHaveLength(1);
    expect(r.filter((x) => x.status === "ALREADY_USED")).toHaveLength(3);
  });
});
