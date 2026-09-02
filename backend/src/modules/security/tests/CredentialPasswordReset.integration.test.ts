/**
 * Integração do reset de senha — MariaDB real, schema ISOLADO.
 *
 * Prova o que o teste de SQL não alcança: depois de `resetPassword` +
 * `update`, o hash LIDO DE VOLTA do banco é o novo. Era exatamente aqui
 * que o bug de v0.9.1 morava — tudo indicava sucesso e a linha continuava
 * com o hash antigo.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e `DB_NAME` de teste, nunca DEV.
 * Todos os valores são sintéticos (`999994`) e removidos ao final.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { MariaDbCredentialRepository } from "../infrastructure/persistence/MariaDbCredentialRepository.js";
import { Credential } from "../domain/Credential.js";
import { CredentialType } from "../domain/value-objects/CredentialType.js";
import { PasswordHash } from "../domain/value-objects/PasswordHash.js";

const DB_CONFIG = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "root",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? "pctec_ingressa_test"
};

const EMAIL_SINTETICO = "reset.999994@example.invalid";
// Hashes PHC sintéticos — formato válido, nunca derivados de senha real.
const HASH_ANTIGO = "$argon2id$v=19$m=65536,t=3,p=4$c2ludGV0aWNvQUFBQQ$c2ludGV0aWNvSGFzaEFudGlnb0FBQUFBQUFBQUFBQUFBQQ";
const HASH_NOVO = "$argon2id$v=19$m=65536,t=3,p=4$c2ludGV0aWNvQkJCQg$c2ludGV0aWNvSGFzaE5vdm9CQkJCQkJCQkJCQkJCQg";

const shouldRun = shouldRunIntegrationTests();

describe.skipIf(!shouldRun)("reset de senha — persistência real do hash", () => {
  let pool: Pool;
  let identityPublicId: string;
  let credentialPublicId: string;

  async function limpar(): Promise<void> {
    await pool.execute(`DELETE FROM credentials WHERE identity_public_id IN (SELECT public_id FROM identities WHERE email_normalized = ?)`, [EMAIL_SINTETICO]);
    await pool.execute(`DELETE FROM identities WHERE email_normalized = ?`, [EMAIL_SINTETICO]);
  }

  beforeEach(async () => {
    pool = createPool(DB_CONFIG);
    await limpar();
    identityPublicId = randomUUID();
    await pool.execute(
      `INSERT INTO identities (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', 'Reset Sintetico', ?, ?, 'ACTIVE', 1, 1, NOW(3), NOW(3))`,
      [identityPublicId, EMAIL_SINTETICO, EMAIL_SINTETICO]
    );

    const credential = Credential.createFoundational({
      identityPublicId,
      passwordHash: PasswordHash.fromPhcString(HASH_ANTIGO),
      correlationId: randomUUID()
    });
    credentialPublicId = credential.getPublicId().toString();
    await new MariaDbCredentialRepository(pool).insert(credential);
  });

  afterEach(async () => {
    await limpar();
    await pool.end();
  });

  async function hashArmazenadoMudou(esperadoNovo: boolean): Promise<boolean> {
    const [rows] = await pool.execute(`SELECT password_hash FROM credentials WHERE public_id = ?`, [
      credentialPublicId
    ]);
    const armazenado = (rows as { password_hash: string }[])[0]?.password_hash ?? "";
    // Comparação por igualdade; o valor nunca é impresso.
    return esperadoNovo ? armazenado === HASH_NOVO : armazenado === HASH_ANTIGO;
  }

  it("o hash lido de volta é o NOVO após resetPassword + update", async () => {
    const repository = new MariaDbCredentialRepository(pool);
    const credencial = await repository.findByIdentityAndType(identityPublicId, CredentialType.localPassword());
    expect(credencial).toBeDefined();
    expect(await hashArmazenadoMudou(false)).toBe(true);

    const versaoOriginal = credencial!.getVersion();
    credencial!.resetPassword({
      newPasswordHash: PasswordHash.fromPhcString(HASH_NOVO),
      actorPublicId: identityPublicId,
      reasonCode: "ADMIN_PASSWORD_RECOVERY",
      expectedVersion: versaoOriginal,
      correlationId: randomUUID()
    });
    await repository.update(credencial!, versaoOriginal);

    expect(await hashArmazenadoMudou(true)).toBe(true);
  });

  it("a versão sobe junto — trava otimista continua valendo", async () => {
    const repository = new MariaDbCredentialRepository(pool);
    const credencial = await repository.findByIdentityAndType(identityPublicId, CredentialType.localPassword());
    const versaoOriginal = credencial!.getVersion();

    credencial!.resetPassword({
      newPasswordHash: PasswordHash.fromPhcString(HASH_NOVO),
      actorPublicId: identityPublicId,
      reasonCode: "ADMIN_PASSWORD_RECOVERY",
      expectedVersion: versaoOriginal,
      correlationId: randomUUID()
    });
    await repository.update(credencial!, versaoOriginal);

    const relido = await repository.findByIdentityAndType(identityPublicId, CredentialType.localPassword());
    expect(relido!.getVersion()).toBe(versaoOriginal + 1);
  });

  it("um segundo update com a versão antiga é recusado", async () => {
    const repository = new MariaDbCredentialRepository(pool);
    const credencial = await repository.findByIdentityAndType(identityPublicId, CredentialType.localPassword());
    const versaoOriginal = credencial!.getVersion();

    credencial!.resetPassword({
      newPasswordHash: PasswordHash.fromPhcString(HASH_NOVO),
      actorPublicId: identityPublicId,
      reasonCode: "ADMIN_PASSWORD_RECOVERY",
      expectedVersion: versaoOriginal,
      correlationId: randomUUID()
    });
    await repository.update(credencial!, versaoOriginal);

    await expect(repository.update(credencial!, versaoOriginal)).rejects.toThrow();
  });
});
