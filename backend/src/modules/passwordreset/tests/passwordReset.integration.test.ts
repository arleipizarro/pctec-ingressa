import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadEnv } from "../../../app/config/env.js";
import { createPool } from "../../../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { fixtureRunId } from "../../../shared/types/integration-database-guard.js";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { MariaDbAuditEventRepository } from "../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { MariaDbIdentityRepository } from "../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { Argon2PasswordHasher } from "../../security/infrastructure/hashing/Argon2PasswordHasher.js";
import { MariaDbCredentialRepository } from "../../security/infrastructure/persistence/MariaDbCredentialRepository.js";
import { MariaDbSessionRepository } from "../../security/infrastructure/persistence/MariaDbSessionRepository.js";
import { CompletePasswordResetService } from "../application/CompletePasswordResetService.js";
import { RequestPasswordResetService } from "../application/RequestPasswordResetService.js";
import { PasswordResetNotUsableError } from "../domain/errors/PasswordResetErrors.js";
import { MariaDbPasswordResetTokenRepository } from "../infrastructure/persistence/MariaDbPasswordResetTokenRepository.js";
import { CryptoPasswordResetTokenGenerator } from "../infrastructure/token/passwordResetTokenHash.js";
import { CapturingDelivery } from "./passwordResetTestSupport.js";

/**
 * "Esqueci minha senha" contra MariaDB real (banco `_test` obrigatório):
 * pedido → link → troca → reuso recusado → expiração recusada, mais o
 * titular com login desabilitado. Exige a migration 0034 aplicada.
 *
 * Hash Argon2id de verdade — é a prova de que a senha nova AUTENTICA,
 * não só de que a coluna mudou.
 */
const executar = shouldRunIntegrationTests();

const SENHA_ANTIGA = "senha-antiga-sintetica-longa";
const SENHA_NOVA = "senha-nova-sintetica-longa";

describe.skipIf(!executar)("Esqueci minha senha (integração)", () => {
  const execucao = fixtureRunId();
  const ativoPublicId = randomUUID();
  const desabilitadoPublicId = randomUUID();
  /** Titular exclusivo do teste de revogação — os anteriores já gastaram o teto por hora. */
  const substituidoPublicId = randomUUID();
  const emailAtivo = `reset-ativo-${execucao}@example.invalid`;
  const emailDesabilitado = `reset-desabilitado-${execucao}@example.invalid`;
  const emailSubstituido = `reset-substituido-${execucao}@example.invalid`;
  const hasher = new Argon2PasswordHasher();

  let pool: ReturnType<typeof createPool>;
  let entrega: CapturingDelivery;
  let pedido: RequestPasswordResetService;
  let conclusao: CompletePasswordResetService;

  async function inserirTitular(publicId: string, email: string, loginEnabled: 0 | 1): Promise<void> {
    await pool.execute(
      `INSERT INTO identities (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', ?, 1, NOW(3), NOW(3))`,
      [publicId, `Titular ${execucao}`, email, email, loginEnabled]
    );
    const { PlainPassword } = await import("../../security/domain/value-objects/PlainPassword.js");
    const hash = await hasher.hash(PlainPassword.create(SENHA_ANTIGA));
    await pool.execute(
      `INSERT INTO credentials (public_id, identity_public_id, type, password_hash, status, version, created_at, updated_at)
       VALUES (?, ?, 'LOCAL_PASSWORD', ?, 'ACTIVE', 1, NOW(3), NOW(3))`,
      [randomUUID(), publicId, hash.toString()]
    );
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

    await inserirTitular(ativoPublicId, emailAtivo, 1);
    await inserirTitular(desabilitadoPublicId, emailDesabilitado, 0);
    await inserirTitular(substituidoPublicId, emailSubstituido, 1);
    for (let i = 0; i < 2; i += 1) {
      await pool.execute(
        `INSERT INTO sessions (public_id, identity_public_id, token_hash, status, created_at, expires_at, version)
         VALUES (?, ?, ?, 'ACTIVE', NOW(3), DATE_ADD(NOW(3), INTERVAL 1 HOUR), 1)`,
        [randomUUID(), ativoPublicId, createHash("sha256").update(randomBytes(32)).digest("hex")]
      );
    }

    const unitOfWork = new MariaDbUnitOfWork(pool);
    entrega = new CapturingDelivery();
    pedido = new RequestPasswordResetService({
      unitOfWork,
      identityRepository: new MariaDbIdentityRepository(pool),
      credentialRepository: new MariaDbCredentialRepository(pool),
      passwordResetTokenRepositoryFactory: (c) => new MariaDbPasswordResetTokenRepository(c),
      auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c),
      auditEventRepository: new MariaDbAuditEventRepository(pool),
      tokenGenerator: new CryptoPasswordResetTokenGenerator(),
      delivery: entrega,
      ttlSeconds: 1_800,
      publicBaseUrl: "https://ingressa.example.invalid"
    });
    conclusao = new CompletePasswordResetService({
      unitOfWork,
      passwordResetTokenRepositoryFactory: (c) => new MariaDbPasswordResetTokenRepository(c),
      identityRepositoryFactory: (c) => new MariaDbIdentityRepository(c),
      credentialRepositoryFactory: (c) => new MariaDbCredentialRepository(c),
      sessionRepositoryFactory: (c) => new MariaDbSessionRepository(c),
      auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c),
      passwordHasher: hasher,
      readOnlyPasswordResetTokenRepository: new MariaDbPasswordResetTokenRepository(pool),
      readOnlyIdentityRepository: new MariaDbIdentityRepository(pool)
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function linhas<T>(sql: string, params: unknown[]): Promise<T[]> {
    const [rows] = await pool.execute(sql, params as never);
    return rows as T[];
  }

  it("titular ativo: pede, recebe o link, troca a senha — e a senha nova autentica", async () => {
    const resultado = await pedido.execute({ email: emailAtivo.toUpperCase() });
    expect(resultado).toEqual({ outcome: "ISSUED", delivered: true });

    const token = entrega.ultimoToken();
    const [salvo] = await linhas<{ token_hash: string; status: string }>(
      "SELECT token_hash, status FROM password_reset_tokens WHERE identity_public_id = ?",
      [ativoPublicId]
    );
    expect(salvo!.status).toBe("PENDING");
    expect(salvo!.token_hash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));

    await expect(conclusao.preview(token)).resolves.toHaveProperty("expiresAt");
    const troca = await conclusao.execute({ token, password: SENHA_NOVA, passwordConfirmation: SENHA_NOVA });
    expect(troca.revokedSessions).toBe(2);

    const [credencial] = await linhas<{ password_hash: string; version: number }>(
      "SELECT password_hash, version FROM credentials WHERE identity_public_id = ?",
      [ativoPublicId]
    );
    const { PlainPassword } = await import("../../security/domain/value-objects/PlainPassword.js");
    const { PasswordHash } = await import("../../security/domain/value-objects/PasswordHash.js");
    const hashSalvo = PasswordHash.fromPersistence(credencial!.password_hash);
    expect(await hasher.verify(PlainPassword.forVerification(SENHA_NOVA), hashSalvo)).toBe(true);
    expect(await hasher.verify(PlainPassword.forVerification(SENHA_ANTIGA), hashSalvo)).toBe(false);
    expect(Number(credencial!.version)).toBe(2);

    const sessoes = await linhas<{ status: string; revocation_reason: string }>(
      "SELECT status, revocation_reason FROM sessions WHERE identity_public_id = ?",
      [ativoPublicId]
    );
    expect(sessoes.every((s) => s.status === "REVOKED" && s.revocation_reason === "PASSWORD_RESET")).toBe(true);

    const [consumido] = await linhas<{ status: string; consumed_at: Date | null }>(
      "SELECT status, consumed_at FROM password_reset_tokens WHERE identity_public_id = ?",
      [ativoPublicId]
    );
    expect(consumido!.status).toBe("CONSUMED");
    expect(consumido!.consumed_at).not.toBeNull();

    const eventos = await linhas<{ event_type: string; payload_json: unknown }>(
      "SELECT event_type, payload_json FROM audit_events WHERE aggregate_public_id = ? ORDER BY id",
      [ativoPublicId]
    );
    expect(eventos.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(["password-reset.requested", "password-reset.completed"])
    );
    const serializado = JSON.stringify(eventos);
    expect(serializado).not.toContain(token);
    expect(serializado).not.toContain(SENHA_NOVA);
    expect(serializado).not.toContain(emailAtivo);

    // Reuso: o MESMO link não troca a senha de novo.
    await expect(
      conclusao.execute({ token, password: "outra-senha-sintetica", passwordConfirmation: "outra-senha-sintetica" })
    ).rejects.toBeInstanceOf(PasswordResetNotUsableError);
  });

  it("link expirado não permite troca", async () => {
    await pedido.execute({ email: emailAtivo });
    const token = entrega.ultimoToken();
    await pool.execute(
      "UPDATE password_reset_tokens SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE token_hash = ?",
      [createHash("sha256").update(token, "utf8").digest("hex")]
    );

    await expect(conclusao.preview(token)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    await expect(
      conclusao.execute({ token, password: SENHA_NOVA, passwordConfirmation: SENHA_NOVA })
    ).rejects.toBeInstanceOf(PasswordResetNotUsableError);
  });

  it("um pedido novo revoga o anterior ainda aberto", async () => {
    await pedido.execute({ email: emailSubstituido });
    const antigo = entrega.ultimoToken();
    await pedido.execute({ email: emailSubstituido });

    await expect(conclusao.preview(antigo)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    await expect(conclusao.preview(entrega.ultimoToken())).resolves.toHaveProperty("expiresAt");
    const abertos = await linhas<{ total: number }>(
      "SELECT COUNT(*) AS total FROM password_reset_tokens WHERE identity_public_id = ? AND status = 'PENDING'",
      [substituidoPublicId]
    );
    expect(Number(abertos[0]!.total)).toBe(1);
  });

  it("login desabilitado: nada é emitido, a senha não muda, a tentativa fica na auditoria", async () => {
    const enviadosAntes = entrega.enviados.length;
    const resultado = await pedido.execute({ email: emailDesabilitado });

    expect(resultado.outcome).toBe("IGNORED_LOGIN_DISABLED");
    expect(entrega.enviados.length).toBe(enviadosAntes);
    const tokens = await linhas<{ total: number }>(
      "SELECT COUNT(*) AS total FROM password_reset_tokens WHERE identity_public_id = ?",
      [desabilitadoPublicId]
    );
    expect(Number(tokens[0]!.total)).toBe(0);
    const [evento] = await linhas<{ payload_json: unknown }>(
      "SELECT payload_json FROM audit_events WHERE aggregate_public_id = ? AND event_type = 'password-reset.requested'",
      [desabilitadoPublicId]
    );
    const payload = typeof evento!.payload_json === "string" ? JSON.parse(evento!.payload_json) : evento!.payload_json;
    expect(payload).toEqual({ outcome: "IGNORED_LOGIN_DISABLED", identityPublicId: desabilitadoPublicId });
  });

  it("teto por titular: o quarto pedido na mesma hora não gera e-mail nem pedido", async () => {
    // O titular ativo já fez 2 pedidos nos testes acima; mais 1 chega ao teto.
    await pedido.execute({ email: emailAtivo });
    const enviadosAntes = entrega.enviados.length;

    const quarto = await pedido.execute({ email: emailAtivo });

    expect(quarto.outcome).toBe("THROTTLED");
    expect(entrega.enviados.length).toBe(enviadosAntes);
  });

  it("e-mail inexistente: nada é emitido e o endereço não vai para a auditoria", async () => {
    const inexistente = `ninguem-${execucao}@example.invalid`;
    const resultado = await pedido.execute({ email: inexistente });

    expect(resultado.outcome).toBe("IGNORED_UNKNOWN_EMAIL");
    const vazamentos = await linhas<{ total: number }>(
      "SELECT COUNT(*) AS total FROM audit_events WHERE payload_json LIKE ?",
      [`%${inexistente}%`]
    );
    expect(Number(vazamentos[0]!.total)).toBe(0);
  });
});
