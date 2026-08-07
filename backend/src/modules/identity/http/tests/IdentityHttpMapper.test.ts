import { describe, it, expect } from "vitest";
import { toIdentityHttpResponse } from "../IdentityHttpMapper.js";
import { Identity } from "../../domain/Identity.js";
import { ActorPublicId } from "../../domain/value-objects/ActorPublicId.js";

const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000003";

function createValidIdentity() {
  return Identity.create({
    type: "HUMAN",
    fullName: "Maria da Silva",
    email: "maria@example.com",
    cpf: "52998224725",
    actor: SYSTEM_ACTOR,
    correlationId: CORRELATION_ID
  });
}

describe("toIdentityHttpResponse", () => {
  it("expõe exatamente os campos públicos documentados, nem mais nem menos", () => {
    const identity = createValidIdentity();

    const response = toIdentityHttpResponse(identity);

    expect(Object.keys(response).sort()).toEqual(
      ["createdAt", "email", "fullName", "loginEnabled", "publicId", "status", "type", "updatedAt", "version"].sort()
    );
  });

  it("[auditoria de segurança] a resposta 200 NUNCA contém nenhuma das propriedades proibidas (lista exata da revisão)", () => {
    const identity = createValidIdentity();
    identity.assignInternalIdFromPersistence(999);
    identity.logicallyDelete({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID, deletionReason: "teste" });

    const response = toIdentityHttpResponse(identity) as unknown as Record<string, unknown>;
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
      expect(response, `propriedade proibida "${property}" não pode existir na resposta`).not.toHaveProperty(property);
    }
  });

  it("nunca expõe internalId (BIGINT interno)", () => {
    const identity = createValidIdentity();
    identity.assignInternalIdFromPersistence(42);

    const response = toIdentityHttpResponse(identity) as unknown as Record<string, unknown>;

    expect(response["internalId"]).toBeUndefined();
    // Verifica pela CHAVE, não por substring do valor — checar substring
    // de um número específico no JSON inteiro é frágil (pode coincidir
    // por acaso com dígitos de uma data ISO gerada dinamicamente).
    expect(Object.keys(response)).not.toContain("internalId");
    expect(Object.keys(response)).not.toContain("id");
  });

  it("nunca expõe normalizedEmail — só o e-mail de exibição", () => {
    const identity = createValidIdentity();

    const response = toIdentityHttpResponse(identity) as unknown as Record<string, unknown>;

    expect(response["normalizedEmail"]).toBeUndefined();
    expect(response["emailNormalized"]).toBeUndefined();
    expect(response["email"]).toBe("maria@example.com");
  });

  it("nunca expõe normalizedCpf", () => {
    const identity = createValidIdentity();

    const response = toIdentityHttpResponse(identity) as unknown as Record<string, unknown>;

    expect(response["normalizedCpf"]).toBeUndefined();
    expect(response["cpfNormalized"]).toBeUndefined();
  });

  it("nunca expõe CPF nesta primeira API, mesmo quando a Identity tem um CPF cadastrado", () => {
    const identity = createValidIdentity();

    const response = toIdentityHttpResponse(identity) as unknown as Record<string, unknown>;

    expect(response["cpf"]).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain("52998224725");
  });

  it("nunca expõe dados de auditoria interna (createdByPublicId/updatedByPublicId/deletedByPublicId/deletionReason)", () => {
    const identity = createValidIdentity();

    const response = toIdentityHttpResponse(identity) as unknown as Record<string, unknown>;

    expect(response["createdByPublicId"]).toBeUndefined();
    expect(response["updatedByPublicId"]).toBeUndefined();
    expect(response["deletedByPublicId"]).toBeUndefined();
    expect(response["deletionReason"]).toBeUndefined();
  });

  it("datas são serializadas como string ISO-8601, nunca como objeto Date bruto", () => {
    const identity = createValidIdentity();

    const response = toIdentityHttpResponse(identity);

    expect(typeof response.createdAt).toBe("string");
    expect(typeof response.updatedAt).toBe("string");
    expect(response.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
