import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { IdentityRepository } from "../../domain/IdentityRepository.js";
import { Identity } from "../../domain/Identity.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import { ActorPublicId } from "../../domain/value-objects/ActorPublicId.js";

const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000004";

class InMemoryIdentityRepository implements IdentityRepository {
  public readonly stored = new Map<string, Identity>();

  public async findByPublicId(publicId: PublicId): Promise<Identity | undefined> {
    return this.stored.get(publicId.toString());
  }

  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }

  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }

  public async countAll(): Promise<number> {
    return this.stored.size;
  }

  public async insert(identity: Identity): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
  }

  public async update(identity: Identity): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
  }
}

/** Simula uma falha inesperada (bug, driver, etc.) — não um DomainError — para exercitar o handler de erro 500 genérico. */
class BrokenIdentityRepository implements IdentityRepository {
  public async findByPublicId(): Promise<Identity | undefined> {
    throw new Error("ECONNREFUSED 127.0.0.1:3306 (mensagem de driver simulada, nunca deveria vazar)");
  }

  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }

  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }

  public async countAll(): Promise<number> {
    return 0;
  }

  public async insert(): Promise<void> {
    /* não usado nestes testes */
  }

  public async update(): Promise<void> {
    /* não usado nestes testes */
  }
}

function createValidIdentity() {
  return Identity.create({
    type: "HUMAN",
    fullName: "Maria da Silva",
    email: "maria@example.com",
    actor: SYSTEM_ACTOR,
    correlationId: CORRELATION_ID
  });
}

describe("GET /api/v1/identities/:publicId", () => {
  let server: Server;
  let baseUrl: string;
  let repository: InMemoryIdentityRepository;

  beforeEach(async () => {
    repository = new InMemoryIdentityRepository();
    // Injeta o fake em memória — nenhum teste desta suíte toca MariaDB
    // real. Usar createApp({ identityRepository }) em vez do default é
    // exatamente o que a injeção existe para permitir.
    const app = createApp({ identityRepository: repository });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado do servidor de teste");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("retorna 200 quando a Identity existe", async () => {
    const identity = createValidIdentity();
    repository.stored.set(identity.getPublicId().toString(), identity);

    const res = await fetch(`${baseUrl}/api/v1/identities/${identity.getPublicId().toString()}`);

    expect(res.status).toBe(200);
  });

  it("retorna o payload exato documentado — nem mais nem menos campos", async () => {
    const identity = createValidIdentity();
    repository.stored.set(identity.getPublicId().toString(), identity);

    const res = await fetch(`${baseUrl}/api/v1/identities/${identity.getPublicId().toString()}`);
    const body = await res.json();

    expect(body).toEqual({
      publicId: identity.getPublicId().toString(),
      type: "HUMAN",
      fullName: "Maria da Silva",
      email: "maria@example.com",
      status: "PENDING",
      loginEnabled: false,
      version: 1,
      createdAt: identity.getCreatedAt().toISOString(),
      updatedAt: identity.getUpdatedAt().toISOString()
    });
  });

  it("[auditoria de segurança] payload 200 real via HTTP nunca contém nenhuma das propriedades proibidas, mesmo para uma Identity com CPF e exclusão lógica", async () => {
    const identity = createValidIdentity();
    identity.assignInternalIdFromPersistence(999);
    identity.activate({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID });
    repository.stored.set(identity.getPublicId().toString(), identity);

    const res = await fetch(`${baseUrl}/api/v1/identities/${identity.getPublicId().toString()}`);
    const body = (await res.json()) as Record<string, unknown>;

    const FORBIDDEN_PROPERTIES = [
      "id",
      "internalId",
      "emailNormalized",
      "normalizedEmail",
      "cpf",
      "normalizedCpf",
      "createdByPublicId",
      "updatedByPublicId",
      "deletedAt",
      "deletedByPublicId",
      "deletionReason"
    ];
    for (const property of FORBIDDEN_PROPERTIES) {
      expect(body, `propriedade proibida "${property}" não pode existir na resposta HTTP`).not.toHaveProperty(property);
    }
    expect(Object.keys(body).sort()).toEqual(
      ["publicId", "type", "fullName", "email", "status", "loginEnabled", "version", "createdAt", "updatedAt"].sort()
    );
  });

  it("retorna 404 quando a Identity não existe, com o envelope de erro padronizado (API-CONTRACT-V1.md)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identities/11111111-1111-1111-1111-111111111111`);
    const body = (await res.json()) as { error: { code: string; correlation_id: unknown; details: unknown } };

    expect(res.status).toBe(404);
    expect(body).toMatchObject({ error: { code: "IDENTITY_NOT_FOUND" } });
    expect(body.error.correlation_id).toBeTypeOf("string");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("retorna 422 quando o publicId não é um UUID sintaticamente válido", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identities/nao-e-um-uuid`);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toMatchObject({ error: { code: "IDENTITY_PUBLIC_ID_INVALID" } });
  });

  it("resposta 422 nunca ecoa o valor bruto inválido enviado na URL (docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md)", async () => {
    const suspiciousInput = "valor-suspeito-nao-deveria-aparecer-de-volta";
    const res = await fetch(`${baseUrl}/api/v1/identities/${suspiciousInput}`);
    const text = await res.text();

    expect(res.status).toBe(422);
    expect(text).not.toContain(suspiciousInput);
  });

  it("erro sanitizado: resposta nunca contém SQL, stack trace, nome de tabela/coluna ou mensagem de driver mysql2", async () => {
    const res = await fetch(`${baseUrl}/api/v1/identities/11111111-1111-1111-1111-111111111111`);
    const text = await res.text();

    expect(text).not.toMatch(/SELECT|FROM identities|mysql2|at\s+\S+\.ts:\d+|node_modules/i);
  });

  describe("X-Correlation-Id", () => {
    it("toda resposta de sucesso (200) possui o header X-Correlation-Id", async () => {
      const identity = createValidIdentity();
      repository.stored.set(identity.getPublicId().toString(), identity);

      const res = await fetch(`${baseUrl}/api/v1/identities/${identity.getPublicId().toString()}`);

      expect(res.headers.get("x-correlation-id")).toBeTruthy();
    });

    it("erro 404: correlation_id do corpo é EXATAMENTE o mesmo do header", async () => {
      const res = await fetch(`${baseUrl}/api/v1/identities/11111111-1111-1111-1111-111111111111`);
      const body = (await res.json()) as { error: { correlation_id: string } };

      expect(res.status).toBe(404);
      expect(body.error.correlation_id).toBe(res.headers.get("x-correlation-id"));
    });

    it("erro 422: correlation_id do corpo é EXATAMENTE o mesmo do header", async () => {
      const res = await fetch(`${baseUrl}/api/v1/identities/nao-e-um-uuid`);
      const body = (await res.json()) as { error: { correlation_id: string } };

      expect(res.status).toBe(422);
      expect(body.error.correlation_id).toBe(res.headers.get("x-correlation-id"));
    });

    it("erro 500 sanitizado: correlation_id do corpo é o mesmo do header, e nenhuma mensagem de driver/infra vaza", async () => {
      const brokenApp = createApp({ identityRepository: new BrokenIdentityRepository() });
      const brokenServer = brokenApp.listen(0);
      await new Promise<void>((resolve) => brokenServer.once("listening", resolve));
      const address = brokenServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("endereço inesperado do servidor de teste");
      }

      try {
        const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/identities/11111111-1111-1111-1111-111111111111`);
        const text = await res.text();
        const body = JSON.parse(text) as { error: { code: string; correlation_id: string; message: string } };

        expect(res.status).toBe(500);
        expect(body.error.code).toBe("INTERNAL_ERROR");
        expect(body.error.correlation_id).toBe(res.headers.get("x-correlation-id"));
        expect(text).not.toMatch(/ECONNREFUSED|3306|mysql2|mensagem de driver simulada/i);
      } finally {
        await new Promise<void>((resolve, reject) => brokenServer.close((err) => (err ? reject(err) : resolve())));
      }
    });

    it("um X-Correlation-Id válido (UUID) enviado pelo cliente é ecoado de volta sem alteração (API-CONTRACT-V1.md: 'se o cliente não enviar, o servidor gera um')", async () => {
      const clientCorrelationId = "b3f2c1a0-1111-2222-3333-444455556666";

      const res = await fetch(`${baseUrl}/health`, { headers: { "X-Correlation-Id": clientCorrelationId } });

      expect(res.headers.get("x-correlation-id")).toBe(clientCorrelationId);
    });

    it("um X-Correlation-Id inválido (não-UUID) enviado pelo cliente é IGNORADO — o servidor gera um novo, nunca ecoa o valor recebido sem validar", async () => {
      const invalidClientValue = "<script>alert(1)</script>";

      const res = await fetch(`${baseUrl}/health`, { headers: { "X-Correlation-Id": invalidClientValue } });
      const echoed = res.headers.get("x-correlation-id");

      expect(echoed).not.toBe(invalidClientValue);
      expect(echoed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("o valor do correlation_id nunca expõe informação sensível — é sempre um UUID gerado, nunca dado de configuração/segredo", async () => {
      const res = await fetch(`${baseUrl}/api/v1/identities/11111111-1111-1111-1111-111111111111`);
      const body = (await res.json()) as { error: { correlation_id: string } };

      expect(body.error.correlation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  it("/health continua funcionando normalmente com a rota de identities registrada", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", service: "pctec-ingressa", version: "0.5.0" });
  });

  it("rota desconhecida continua 404 (não quebrou com a rota nova registrada)", async () => {
    const res = await fetch(`${baseUrl}/rota-que-nao-existe`);
    expect(res.status).toBe(404);
  });

  it("nunca expõe internalId/normalizedEmail/normalizedCpf/cpf no payload HTTP de verdade (ponta a ponta) — verificado pela CHAVE, não por substring de valor (evita falso positivo com dígitos de data)", async () => {
    const identity = createValidIdentity();
    identity.assignInternalIdFromPersistence(555);
    repository.stored.set(identity.getPublicId().toString(), identity);

    const res = await fetch(`${baseUrl}/api/v1/identities/${identity.getPublicId().toString()}`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body)).not.toContain("internalId");
    expect(Object.keys(body)).not.toContain("normalizedEmail");
    expect(Object.keys(body)).not.toContain("cpf");
    expect(Object.keys(body)).not.toContain("id");
  });
});
