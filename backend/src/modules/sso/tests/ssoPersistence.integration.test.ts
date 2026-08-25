import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { createPool } from "../../../shared/database/Pool.js";
import { loadEnv } from "../../../app/config/env.js";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { fixtureRunId } from "../../../shared/types/integration-database-guard.js";
import { MariaDbAuthorizationCodeRepository } from "../infrastructure/persistence/MariaDbAuthorizationCodeRepository.js";
import { MariaDbInvitationRepository } from "../../invitation/infrastructure/persistence/MariaDbInvitationRepository.js";
import { AuthorizationCode } from "../domain/AuthorizationCode.js";
import { Invitation } from "../../invitation/domain/Invitation.js";
import { PCTEC_PORTAL_APPLICATION_PUBLIC_ID } from "../../application/domain/value-objects/ApplicationCodes.js";
import { hashAuthorizationCode } from "../infrastructure/token/hashAuthorizationCode.js";
import { hashInvitationToken } from "../../invitation/infrastructure/token/invitationToken.js";

/**
 * Integração real das duas tabelas novas (0022 e 0023).
 *
 * O que só um banco de verdade prova, e os testes unitários não podem:
 * que o consumo é ATÔMICO. `consumeByCodeHash`/`consumeByTokenHash` são
 * um `UPDATE` condicional seguido de leitura — os duplos em memória
 * imitam essa semântica, mas quem a garante sob concorrência é o
 * `WHERE consumed_at IS NULL` executado pelo InnoDB.
 *
 * Isolamento: `shouldRunIntegrationTests()` exige `DB_NAME` terminado em
 * `_test` e recusa bancos de uso real. Toda fixture leva um prefixo
 * único de execução e é removida no teardown.
 */
const executar = shouldRunIntegrationTests();

describe.skipIf(!executar)("persistência do SSO e dos convites (integração)", () => {
  const execucao = fixtureRunId();
  const identityPublicId = randomUUID();
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });

    // Identity sintética — as duas tabelas novas têm FK para
    // identities.public_id, então a fixture é obrigatória.
    await pool.execute(
      `INSERT INTO identities
         (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', 1, 1, NOW(3), NOW(3))`,
      [
        identityPublicId,
        `Fixture SSO ${execucao}`,
        `sso-${execucao}@example.invalid`,
        `sso-${execucao}@example.invalid`
      ]
    );
  });

  afterAll(async () => {
    if (pool === undefined) {
      return;
    }
    // Ordem inversa das FKs. Erros de limpeza nunca são relançados —
    // mascarariam a falha real do teste.
    for (const sql of [
      "DELETE FROM sso_authorization_codes WHERE identity_public_id = ?",
      "DELETE FROM identity_invitations WHERE identity_public_id = ?",
      "DELETE FROM identities WHERE public_id = ?"
    ]) {
      await pool.execute(sql, [identityPublicId]).catch(() => undefined);
    }
    await pool.end().catch(() => undefined);
  });

  function novoCodigo(codigoBruto: string, ttlSeconds = 60): AuthorizationCode {
    return AuthorizationCode.issue({
      identityPublicId,
      audienceApplicationPublicId: PCTEC_PORTAL_APPLICATION_PUBLIC_ID,
      audienceApplicationCode: "PCTEC_PORTAL",
      codeHash: hashAuthorizationCode(codigoBruto),
      redirectUri: "https://portal.example.invalid/api/auth/ingressa/callback",
      codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      ttlSeconds,
      correlationId: randomUUID()
    });
  }

  it("insere o código e persiste SOMENTE o hash", async () => {
    const bruto = `codigo-${execucao}-1`;
    const repositorio = new MariaDbAuthorizationCodeRepository(pool);
    await repositorio.insert(novoCodigo(bruto));

    const [linhas] = await pool.execute(
      `SELECT code_hash FROM sso_authorization_codes WHERE identity_public_id = ? AND code_hash = ?`,
      [identityPublicId, hashAuthorizationCode(bruto)]
    );
    expect((linhas as unknown[]).length).toBe(1);

    // O valor bruto não existe em nenhuma coluna da linha.
    const [bruta] = await pool.execute(
      `SELECT * FROM sso_authorization_codes WHERE code_hash = ?`,
      [hashAuthorizationCode(bruto)]
    );
    expect(JSON.stringify(bruta)).not.toContain(bruto);
  });

  it("consumo é ATÔMICO: sob concorrência real, só uma chamada leva o código", async () => {
    const bruto = `codigo-${execucao}-2`;
    const repositorio = new MariaDbAuthorizationCodeRepository(pool);
    await repositorio.insert(novoCodigo(bruto));

    const agora = new Date();
    const resultados = await Promise.all([
      repositorio.consumeByCodeHash(hashAuthorizationCode(bruto), agora),
      repositorio.consumeByCodeHash(hashAuthorizationCode(bruto), agora),
      repositorio.consumeByCodeHash(hashAuthorizationCode(bruto), agora)
    ]);

    expect(resultados.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("replay depois de consumido devolve undefined", async () => {
    const bruto = `codigo-${execucao}-3`;
    const repositorio = new MariaDbAuthorizationCodeRepository(pool);
    await repositorio.insert(novoCodigo(bruto));

    await expect(repositorio.consumeByCodeHash(hashAuthorizationCode(bruto), new Date())).resolves.toBeDefined();
    await expect(repositorio.consumeByCodeHash(hashAuthorizationCode(bruto), new Date())).resolves.toBeUndefined();
  });

  it("código expirado não é consumível", async () => {
    const bruto = `codigo-${execucao}-4`;
    const repositorio = new MariaDbAuthorizationCodeRepository(pool);
    await repositorio.insert(novoCodigo(bruto, 1));

    const futuro = new Date(Date.now() + 5_000);
    await expect(repositorio.consumeByCodeHash(hashAuthorizationCode(bruto), futuro)).resolves.toBeUndefined();
  });

  it("o hash do código é ÚNICO no banco", async () => {
    const bruto = `codigo-${execucao}-5`;
    const repositorio = new MariaDbAuthorizationCodeRepository(pool);
    await repositorio.insert(novoCodigo(bruto));

    await expect(repositorio.insert(novoCodigo(bruto))).rejects.toThrow();
  });

  function novoConvite(tokenBruto: string, ttlSeconds = 86_400): Invitation {
    return Invitation.create({
      identityPublicId,
      tokenHash: hashInvitationToken(tokenBruto),
      invitedByPublicId: identityPublicId,
      deliveryMode: "MANUAL_DEV",
      ttlSeconds,
      correlationId: randomUUID()
    });
  }

  it("convite: consumo atômico sob concorrência real", async () => {
    const token = `token-${execucao}-1`;
    const repositorio = new MariaDbInvitationRepository(pool);
    await repositorio.insert(novoConvite(token));

    const agora = new Date();
    const resultados = await Promise.all([
      repositorio.consumeByTokenHash(hashInvitationToken(token), agora),
      repositorio.consumeByTokenHash(hashInvitationToken(token), agora)
    ]);

    expect(resultados.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("convite novo revoga os anteriores PENDING da mesma identidade", async () => {
    const repositorio = new MariaDbInvitationRepository(pool);
    const antigo = `token-${execucao}-2`;
    await repositorio.insert(novoConvite(antigo));

    const revogados = await repositorio.revokePendingByIdentity(identityPublicId, new Date(), "SUPERSEDED");
    expect(revogados.length).toBeGreaterThanOrEqual(1);

    await expect(
      repositorio.findUsableByTokenHash(hashInvitationToken(antigo), new Date())
    ).resolves.toBeUndefined();
  });

  it("findUsableByTokenHash NÃO consome", async () => {
    const token = `token-${execucao}-3`;
    const repositorio = new MariaDbInvitationRepository(pool);
    await repositorio.insert(novoConvite(token));

    await expect(repositorio.findUsableByTokenHash(hashInvitationToken(token), new Date())).resolves.toBeDefined();
    await expect(repositorio.findUsableByTokenHash(hashInvitationToken(token), new Date())).resolves.toBeDefined();
    await expect(repositorio.consumeByTokenHash(hashInvitationToken(token), new Date())).resolves.toBeDefined();
  });

  it("o hash do token de convite é ÚNICO no banco", async () => {
    const token = `token-${execucao}-4`;
    const repositorio = new MariaDbInvitationRepository(pool);
    await repositorio.insert(novoConvite(token));

    await expect(repositorio.insert(novoConvite(token))).rejects.toThrow();
  });
});
