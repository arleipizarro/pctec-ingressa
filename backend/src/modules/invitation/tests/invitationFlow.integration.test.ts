import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createApp } from "../../../app/http/createApp.js";
import { createPool } from "../../../shared/database/Pool.js";
import { loadEnv } from "../../../app/config/env.js";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { fixtureRunId } from "../../../shared/types/integration-database-guard.js";
import { SESSION_COOKIE_NAME } from "../../security/http/sessionCookie.js";
import {
  PCTEC_INGRESSA_APPLICATION_PUBLIC_ID,
  PCTEC_PORTAL_APPLICATION_PUBLIC_ID
} from "../../application/domain/value-objects/ApplicationCodes.js";
import { deriveCodeChallengeS256 } from "../../sso/infrastructure/token/pkce.js";

/**
 * Jornada completa do usuário federado, contra MariaDB real:
 *
 *   ADMIN emite convite → pessoa define a senha → entra com a senha nova
 *   → `/apps` mostra o card do Portal → o SSO abre.
 *
 * É a prova de que os quatro pedaços desta entrega se encaixam: convite,
 * credencial, launcher e SSO. Nenhuma senha do Helpdesk é lida ou
 * alterada em ponto algum — a senha nasce aqui, escolhida pela pessoa.
 *
 * Fixtures sintéticas com prefixo único; banco `_test` obrigatório.
 */
const executar = shouldRunIntegrationTests();

const REDIRECT_URI = "https://portal.example.invalid/api/auth/ingressa/callback";
const SENHA_ESCOLHIDA = "senha-sintetica-do-convite";

describe.skipIf(!executar)("convite → senha → launcher → SSO (integração)", () => {
  const execucao = fixtureRunId();
  const adminPublicId = randomUUID();
  const convidadoPublicId = randomUUID();
  /** Segundo convidado, exclusivo do teste de uso único — assim ele não
   *  depende da ordem em que os testes anteriores rodaram. */
  const segundoConvidadoPublicId = randomUUID();
  const organizationPublicId = randomUUID();
  const referenciaPublicId = randomUUID();
  const tokenDeSessaoDoAdmin = randomBytes(32).toString("base64url");
  const emailConvidado = `convidado-${execucao}@example.invalid`;

  let pool: ReturnType<typeof createPool>;
  let server: Server;
  let baseUrl: string;
  let origem: string;

  beforeAll(async () => {
    process.env["SSO_PORTAL_REDIRECT_URIS"] = REDIRECT_URI;
    process.env["INVITATION_DELIVERY_MODE"] = "MANUAL_DEV";
    process.env["INGRESSA_PUBLIC_BASE_URL"] = "https://ingressa.example.invalid";
    // A rota administrativa é mutável e autenticada por cookie, logo
    // exige origem confiável. A porta do servidor efêmero só é conhecida
    // depois do `listen`, então a lista é fixada aqui e o mesmo valor vai
    // no cabeçalho `Origin` das requisições — é a origem declarada que a
    // guarda compara, não o endereço do socket.
    process.env["ALLOWED_ORIGINS"] = "https://ingressa.example.invalid";

    const env = loadEnv();
    pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });

    // ADMIN que emite o convite.
    await pool.execute(
      `INSERT INTO identities (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', 1, 1, NOW(3), NOW(3))`,
      [adminPublicId, `Admin ${execucao}`, `admin-${execucao}@example.invalid`, `admin-${execucao}@example.invalid`]
    );
    await pool.execute(
      `INSERT INTO application_accesses (public_id, identity_public_id, application_public_id, access_profile, status, granted_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'ADMIN', 'GRANTED', NOW(3), 1, NOW(3), NOW(3))`,
      [randomUUID(), adminPublicId, PCTEC_INGRESSA_APPLICATION_PUBLIC_ID]
    );
    await pool.execute(
      `INSERT INTO sessions (public_id, identity_public_id, token_hash, status, created_at, expires_at, version)
       VALUES (?, ?, ?, 'ACTIVE', NOW(3), DATE_ADD(NOW(3), INTERVAL 1 HOUR), 1)`,
      [randomUUID(), adminPublicId, createHash("sha256").update(tokenDeSessaoDoAdmin, "utf8").digest("hex")]
    );

    // Convidado: federado, ACTIVE, SEM credencial e com login desabilitado
    // — exatamente o estado em que a importação do Helpdesk o deixa.
    await pool.execute(
      `INSERT INTO identities (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', 0, 1, NOW(3), NOW(3))`,
      [convidadoPublicId, `Convidado ${execucao}`, emailConvidado, emailConvidado]
    );
    await pool.execute(
      `INSERT INTO identity_external_references
         (public_id, identity_public_id, system_code, entity_type, legacy_id, status, match_method, created_at, updated_at)
       VALUES (?, ?, 'PCTEC_HELPDESK', 'users', ?, 'ACTIVE', 'MATCHED_BY_EMAIL', NOW(3), NOW(3))`,
      [referenciaPublicId, convidadoPublicId, Math.floor(Math.random() * 1_000_000) + 900_000]
    );
    await pool.execute(
      `INSERT INTO application_accesses (public_id, identity_public_id, application_public_id, access_profile, status, granted_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', 'GRANTED', NOW(3), 1, NOW(3), NOW(3))`,
      [randomUUID(), convidadoPublicId, PCTEC_PORTAL_APPLICATION_PUBLIC_ID]
    );
    await pool.execute(
      `INSERT INTO organizations (public_id, type, legal_name, status, version, created_at, updated_at)
       VALUES (?, 'COMPANY', ?, 'ACTIVE', 1, NOW(3), NOW(3))`,
      [organizationPublicId, `Empresa do Convidado ${execucao}`]
    );
    await pool.execute(
      `INSERT INTO memberships (public_id, identity_public_id, organization_public_id, profile, scope, status, started_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'CUSTOMER', 'ORGANIZATION_ONLY', 'ACTIVE', NOW(3), 1, NOW(3), NOW(3))`,
      [randomUUID(), convidadoPublicId, organizationPublicId]
    );

    // Segundo convidado — mesmo estado inicial, para o teste de uso único.
    await pool.execute(
      `INSERT INTO identities (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', 0, 1, NOW(3), NOW(3))`,
      [
        segundoConvidadoPublicId,
        `Convidado 2 ${execucao}`,
        `convidado2-${execucao}@example.invalid`,
        `convidado2-${execucao}@example.invalid`
      ]
    );
    await pool.execute(
      `INSERT INTO identity_external_references
         (public_id, identity_public_id, system_code, entity_type, legacy_id, status, match_method, created_at, updated_at)
       VALUES (?, ?, 'PCTEC_HELPDESK', 'users', ?, 'ACTIVE', 'MATCHED_BY_EMAIL', NOW(3), NOW(3))`,
      [randomUUID(), segundoConvidadoPublicId, Math.floor(Math.random() * 1_000_000) + 1_900_000]
    );
    await pool.execute(
      `INSERT INTO application_accesses (public_id, identity_public_id, application_public_id, access_profile, status, granted_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', 'GRANTED', NOW(3), 1, NOW(3), NOW(3))`,
      [randomUUID(), segundoConvidadoPublicId, PCTEC_PORTAL_APPLICATION_PUBLIC_ID]
    );

    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const endereco = server.address();
    if (endereco === null || typeof endereco === "string") {
      throw new Error("endereço inesperado do servidor de teste");
    }
    baseUrl = `http://127.0.0.1:${endereco.port}`;
    origem = "https://ingressa.example.invalid";
  });

  afterAll(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool !== undefined) {
      for (const publicId of [adminPublicId, convidadoPublicId, segundoConvidadoPublicId]) {
        for (const sql of [
          "DELETE FROM sso_authorization_codes WHERE identity_public_id = ?",
          "DELETE FROM identity_invitations WHERE identity_public_id = ?",
          "DELETE FROM identity_invitations WHERE invited_by_public_id = ?",
          "DELETE FROM credentials WHERE identity_public_id = ?",
          "DELETE FROM sessions WHERE identity_public_id = ?",
          "DELETE FROM application_accesses WHERE identity_public_id = ?",
          "DELETE FROM memberships WHERE identity_public_id = ?",
          "DELETE FROM identity_external_references WHERE identity_public_id = ?",
          "DELETE FROM audit_events WHERE actor_public_id = ?",
          "DELETE FROM identities WHERE public_id = ?"
        ]) {
          await pool.execute(sql, [publicId]).catch(() => undefined);
        }
      }
      await pool.execute("DELETE FROM organizations WHERE public_id = ?", [organizationPublicId]).catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
    delete process.env["SSO_PORTAL_REDIRECT_URIS"];
    delete process.env["INVITATION_DELIVERY_MODE"];
    delete process.env["INGRESSA_PUBLIC_BASE_URL"];
    delete process.env["ALLOWED_ORIGINS"];
  });

  async function emitirConvite(alvo: string = convidadoPublicId): Promise<{ link: string; resposta: Response }> {
    const resposta = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: origem,
        cookie: `${SESSION_COOKIE_NAME}=${tokenDeSessaoDoAdmin}`
      },
      body: JSON.stringify({ identityPublicIds: [alvo] })
    });
    if (resposta.status !== 201) {
      return { link: "", resposta };
    }
    const corpo = (await resposta.clone().json()) as Record<string, any>;
    return { link: corpo["results"][0]["manualLink"] as string, resposta };
  }

  function tokenDoLink(link: string): string {
    return decodeURIComponent(link.slice(link.indexOf("#") + 1));
  }

  it("ADMIN emite o convite e recebe o link uma única vez, no modo manual", async () => {
    const { link, resposta } = await emitirConvite();

    expect(resposta.status).toBe(201);
    expect(link.startsWith("https://ingressa.example.invalid/convite#")).toBe(true);

    // Só o hash no banco — o token bruto não existe em nenhuma coluna.
    const token = tokenDoLink(link);
    const [linhas] = await pool.execute(
      `SELECT * FROM identity_invitations WHERE identity_public_id = ? AND token_hash = ?`,
      [convidadoPublicId, createHash("sha256").update(token, "utf8").digest("hex")]
    );
    expect((linhas as unknown[]).length).toBe(1);
    expect(JSON.stringify(linhas)).not.toContain(token);
  });

  it("jornada completa: define a senha, entra, vê o Portal em /apps e abre o SSO", async () => {
    const { link } = await emitirConvite();
    const token = tokenDoLink(link);

    // 1. A tela do convite se apresenta sem gastar o convite.
    const previa = await fetch(`${baseUrl}/api/v1/invitations/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    expect(previa.status).toBe(200);

    // 2. A pessoa define a PRÓPRIA senha.
    const definicao = await fetch(`${baseUrl}/api/v1/invitations/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: SENHA_ESCOLHIDA, passwordConfirmation: SENHA_ESCOLHIDA })
    });
    expect(definicao.status).toBe(201);
    expect(((await definicao.json()) as Record<string, any>)["loginEnabled"]).toBe(true);

    // 3. Entra com a senha nova. Nenhuma senha do Helpdesk envolvida.
    const login = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailConvidado, password: SENHA_ESCOLHIDA })
    });
    expect(login.status).toBe(201);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);

    // 4. `/apps` mostra o Portal — e NÃO mostra a administração.
    const apps = await fetch(`${baseUrl}/api/v1/apps`, { headers: { cookie } });
    expect(apps.status).toBe(200);
    const painel = (await apps.json()) as Record<string, any>;
    const codigos = (painel["applications"] as Array<Record<string, string>>).map((a) => a["code"]);
    expect(codigos).toContain("PCTEC_PORTAL");
    expect(codigos).not.toContain("PCTEC_INGRESSA");

    // 5. O SSO abre para o Portal.
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: "PCTEC_PORTAL",
      redirect_uri: REDIRECT_URI,
      state: "estado-sintetico-do-piloto",
      code_challenge: deriveCodeChallengeS256(verifier),
      code_challenge_method: "S256"
    });
    const autorizacao = await fetch(`${baseUrl}/api/v1/sso/authorize?${query.toString()}`, {
      redirect: "manual",
      headers: { cookie }
    });
    expect(autorizacao.status).toBe(302);
    const destino = new URL(autorizacao.headers.get("location") ?? "");
    expect(destino.origin + destino.pathname).toBe(REDIRECT_URI);
    expect(destino.searchParams.get("code")).toEqual(expect.any(String));
  });

  it("o convite é de USO ÚNICO: a segunda apresentação do token falha", async () => {
    // Identidade própria deste teste: sem ela, a ordem dos testes
    // anteriores (que já criaram credencial) decidiria o resultado.
    const { link, resposta } = await emitirConvite(segundoConvidadoPublicId);
    expect(resposta.status).toBe(201);
    const token = tokenDoLink(link);
    const corpo = JSON.stringify({ token, password: SENHA_ESCOLHIDA, passwordConfirmation: SENHA_ESCOLHIDA });
    const cabecalhos = { "content-type": "application/json" };

    const primeira = await fetch(`${baseUrl}/api/v1/invitations/redeem`, { method: "POST", headers: cabecalhos, body: corpo });
    const segunda = await fetch(`${baseUrl}/api/v1/invitations/redeem`, { method: "POST", headers: cabecalhos, body: corpo });

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(401);

    const [credenciais] = await pool.execute(
      `SELECT COUNT(*) AS total FROM credentials WHERE identity_public_id = ?`,
      [segundoConvidadoPublicId]
    );
    expect(Number((credenciais as Array<Record<string, unknown>>)[0]?.["total"])).toBe(1);
  });

  it("emitir de novo REVOGA o convite anterior — nunca dois links válidos", async () => {
    // Identidade própria e descartável: as anteriores já definiram senha
    // nos testes acima e, com credencial, deixam de ser elegíveis — o que
    // faria este teste medir a coisa errada.
    const alvo = randomUUID();
    await pool.execute(
      `INSERT INTO identities (public_id, type, full_name, email, email_normalized, status, login_enabled, version, created_at, updated_at)
       VALUES (?, 'HUMAN', ?, ?, ?, 'ACTIVE', 0, 1, NOW(3), NOW(3))`,
      [alvo, `Convidado 3 ${execucao}`, `convidado3-${execucao}@example.invalid`, `convidado3-${execucao}@example.invalid`]
    );
    await pool.execute(
      `INSERT INTO identity_external_references
         (public_id, identity_public_id, system_code, entity_type, legacy_id, status, match_method, created_at, updated_at)
       VALUES (?, ?, 'PCTEC_HELPDESK', 'users', ?, 'ACTIVE', 'MATCHED_BY_EMAIL', NOW(3), NOW(3))`,
      [randomUUID(), alvo, Math.floor(Math.random() * 1_000_000) + 2_900_000]
    );
    await pool.execute(
      `INSERT INTO application_accesses (public_id, identity_public_id, application_public_id, access_profile, status, granted_at, version, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', 'GRANTED', NOW(3), 1, NOW(3), NOW(3))`,
      [randomUUID(), alvo, PCTEC_PORTAL_APPLICATION_PUBLIC_ID]
    );

    try {
      const primeiro = await emitirConvite(alvo);
      const segundo = await emitirConvite(alvo);
      const corpoPrimeiro = (await primeiro.resposta.json()) as Record<string, any>;
      const corpoSegundo = (await segundo.resposta.json()) as Record<string, any>;
      expect(corpoPrimeiro["results"][0]["outcome"]).toBe("CREATED");
      expect(corpoSegundo["results"][0]["outcome"]).toBe("CREATED");

      const [pendentes] = await pool.execute(
        `SELECT COUNT(*) AS total FROM identity_invitations WHERE identity_public_id = ? AND status = 'PENDING'`,
        [alvo]
      );
      expect(Number((pendentes as Array<Record<string, unknown>>)[0]?.["total"])).toBe(1);

      const [revogados] = await pool.execute(
        `SELECT revocation_reason FROM identity_invitations WHERE identity_public_id = ? AND status = 'REVOKED'`,
        [alvo]
      );
      expect((revogados as Array<Record<string, unknown>>)[0]?.["revocation_reason"]).toBe("SUPERSEDED");
    } finally {
      for (const sql of [
        "DELETE FROM identity_invitations WHERE identity_public_id = ?",
        "DELETE FROM application_accesses WHERE identity_public_id = ?",
        "DELETE FROM identity_external_references WHERE identity_public_id = ?",
        "DELETE FROM audit_events WHERE actor_public_id = ?",
        "DELETE FROM identities WHERE public_id = ?"
      ]) {
        await pool.execute(sql, [alvo]).catch(() => undefined);
      }
    }
  });

  it("sem sessão de ADMIN, a emissão é recusada", async () => {
    const resposta = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: origem },
      body: JSON.stringify({ identityPublicIds: [convidadoPublicId] })
    });
    expect(resposta.status).toBe(401);
  });

  it("origem não confiável é recusada mesmo com sessão de ADMIN válida", async () => {
    const resposta = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://atacante.example.invalid",
        cookie: `${SESSION_COOKIE_NAME}=${tokenDeSessaoDoAdmin}`
      },
      body: JSON.stringify({ identityPublicIds: [convidadoPublicId] })
    });
    expect(resposta.status).toBe(403);
  });
});
