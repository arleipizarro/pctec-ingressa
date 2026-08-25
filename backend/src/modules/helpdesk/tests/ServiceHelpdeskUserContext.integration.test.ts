/**
 * Integração da rota de contexto do Helpdesk — Ingressa DEV real,
 * SOMENTE LEITURA.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e `DB_*` apontando para um banco
 * com o piloto já aplicado. A rota não escreve nada: nenhuma linha é
 * criada, alterada ou removida por esta suíte.
 *
 * A credencial de serviço é injetada em `createApp` só para o processo
 * de teste — nenhum `.env` é lido ou alterado, e o processo em execução
 * sob PM2 não é tocado.
 */
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../app/http/createApp.js";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { existeLinha } from "../../../shared/types/integration-preconditions.js";
import { HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME } from "../../portal/http/requireServiceCredential.js";

const CREDENCIAL = "credencial-de-integracao-somente-deste-processo";
const CONFIG_DA_SONDA = {
  host: process.env["DB_HOST"] ?? "127.0.0.1",
  port: Number(process.env["DB_PORT"] ?? 3306),
  user: process.env["DB_USER"] ?? "",
  password: process.env["DB_PASSWORD"] ?? "",
  database: process.env["DB_NAME"] ?? ""
};

/**
 * Esta suíte é READ-ONLY sobre o piloto já importado. Num banco que não
 * tem o piloto (um schema de teste limpo, por exemplo) não há o que
 * verificar — pula, em vez de reportar 404 como se fosse regressão.
 */
const shouldRun =
  shouldRunIntegrationTests() &&
  (await existeLinha(
    CONFIG_DA_SONDA,
    "SELECT 1 FROM identity_external_references WHERE system_code = ? AND entity_type = ? AND status = ? LIMIT 1",
    ["PCTEC_HELPDESK", "users", "ACTIVE"]
  ));

/**
 * Ids do piloto vêm do ambiente, com default só para a suíte local.
 * Nenhum id de produção é fixado em código de produção — isto é teste.
 */
const USUARIO_A = Number(process.env["HELPDESK_PILOT_USER_A"] ?? 35);
const USUARIO_B = Number(process.env["HELPDESK_PILOT_USER_B"] ?? 44);
const USUARIO_NAO_GERENCIADO = Number(process.env["HELPDESK_PILOT_USER_C"] ?? 45);
const ORGANIZACAO_ESPERADA = process.env["HELPDESK_PILOT_ORG"] ?? "971ec096-e7de-4cc1-be06-2b4709565757";

describe.skipIf(!shouldRun)("contexto do Helpdesk — integração DEV (read-only)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({ helpdeskServiceCredential: CREDENCIAL });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function contexto(legacyUserId: number, headers: Record<string, string> = { [HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL }) {
    const resposta = await fetch(`${baseUrl}/api/v1/service/helpdesk/users/${legacyUserId}/context`, { headers });
    return { status: resposta.status, body: (await resposta.json()) as Record<string, unknown> };
  }

  /**
   * ESTADO REAL DO DEV, e é um bloqueio conhecido — não um defeito da
   * rota.
   *
   * As duas identidades do piloto foram criadas pelo importador e
   * nascem `PENDING`: no Ingressa, ACTIVE é estado de identidade
   * habilitada, e a habilitação pertence ao fluxo de credencial, que
   * este piloto deliberadamente não executou (nenhuma senha foi
   * importada). O contrato exige Identity ACTIVE, então a resposta
   * correta hoje é 403 — negar, nunca conceder por omissão.
   *
   * Quando as identidades forem ativadas por decisão explícita, este
   * teste passa a exigir 200 com exatamente uma organização (ver o
   * `it` seguinte, que já fixa a forma esperada da resposta).
   */
  it.each([
    ["primeiro usuário do piloto", USUARIO_A],
    ["segundo usuário do piloto", USUARIO_B]
  ])("%s: identidade importada ainda PENDING resulta em 403, nunca em contexto", async (_caso, legacyUserId) => {
    const { status, body } = await contexto(legacyUserId);

    expect(status).toBe(403);
    expect((body["error"] as { code: string }).code).toBe("HELPDESK_IDENTITY_NOT_ACTIVE");
  });

  it("quando houver contexto, ele traz só a organização do piloto — forma fixada", async () => {
    const { status, body } = await contexto(USUARIO_A);
    if (status !== 200) {
      // Ainda PENDING: nada a verificar além da negação, já coberta acima.
      expect(status).toBe(403);
      return;
    }
    const orgs = body["organizations"] as { publicId: string; type: string }[];
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.publicId).toBe(ORGANIZACAO_ESPERADA);
    expect(orgs[0]?.type).toBe("COMPANY");
  });

  it("o usuário não importado recebe 404 — sinal de 'ainda não gerenciado'", async () => {
    const { status, body } = await contexto(USUARIO_NAO_GERENCIADO);

    expect(status).toBe(404);
    expect((body["error"] as { code: string }).code).toBe("IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  it("nenhum outro contexto organizacional aparece para os usuários do piloto", async () => {
    for (const legacyUserId of [USUARIO_A, USUARIO_B]) {
      const { status, body } = await contexto(legacyUserId);
      if (status !== 200) {
        continue;
      }
      const orgs = body["organizations"] as { publicId: string; type: string }[];
      expect(orgs.every((o) => o.publicId === ORGANIZACAO_ESPERADA)).toBe(true);
      expect(orgs.some((o) => o.type === "BUSINESS_GROUP")).toBe(false);
    }
  });

  it("sem credencial, nem os usuários do piloto recebem contexto", async () => {
    const { status } = await contexto(USUARIO_A, {});
    expect(status).toBe(401);
  });

  it("nenhuma resposta carrega nome, e-mail ou identificador interno", async () => {
    const { body } = await contexto(USUARIO_A);
    const serializado = JSON.stringify(body).toLowerCase();

    for (const proibido of ["@", "identitypublicid", "membership", "cpf", "password", "senha", "token", "hash"]) {
      expect(serializado).not.toContain(proibido);
    }
  });
});
