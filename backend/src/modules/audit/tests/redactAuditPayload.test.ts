import { describe, expect, it } from "vitest";
import { redactAuditPayload } from "../application/redactAuditPayload.js";
import { REDACTED_MARKER } from "../../../shared/security/redactionPolicy.js";

/**
 * Redação do payload de auditoria.
 *
 * A tela de auditoria é o único lugar onde `payload_json` — coluna JSON
 * livre, alimentada por TODO evento de domínio — vira texto na tela de
 * alguém. Estes testes travam o que nunca pode chegar lá.
 */
describe("redactAuditPayload — o que nunca sai", () => {
  it.each([
    "token",
    "rawToken",
    "tokenHash",
    "password",
    "passwordHash",
    "senha",
    "bcrypt_hash",
    "salt",
    "secret",
    "credential",
    "apiKey",
    "authorization",
    "cookie",
    "sessionCookie",
    "internalId",
    "internal_id"
  ])("redige o campo %s", (campo) => {
    const saida = redactAuditPayload({ [campo]: "valor-sensivel-sintetico" });

    expect(saida.fields[campo]).toBe(REDACTED_MARKER);
    expect(saida.redactedFields).toContain(campo);
    expect(JSON.stringify(saida)).not.toContain("valor-sensivel-sintetico");
  });

  it("estrutura aninhada vira marcador — a política decide por NOME de campo", () => {
    // Um objeto aninhado esconderia nomes que a política não inspecionou.
    const saida = redactAuditPayload({ detalhe: { token: "escondido-sintetico" } });

    expect(saida.fields["detalhe"]).toBe(REDACTED_MARKER);
    expect(saida.redactedFields).toContain("detalhe");
    expect(JSON.stringify(saida)).not.toContain("escondido-sintetico");
  });

  it("array também vira marcador", () => {
    const saida = redactAuditPayload({ itens: ["a-sintetico", "b-sintetico"] });
    expect(saida.fields["itens"]).toBe(REDACTED_MARKER);
  });
});

describe("redactAuditPayload — o que passa", () => {
  it("preserva os campos legítimos de um evento de convite, sem o token", () => {
    // Payload real de `identity-invitation.created`: já é montado campo
    // a campo e nunca carrega o token. A redação confirma isso na saída.
    const saida = redactAuditPayload({
      invitationPublicId: "11111111-1111-4111-8111-111111111111",
      identityPublicId: "22222222-2222-4222-8222-222222222222",
      deliveryMode: "MANUAL_DEV",
      expiresAt: "2026-09-02T12:00:00.000Z"
    });

    expect(saida.redactedFields).toEqual([]);
    expect(saida.fields["deliveryMode"]).toBe("MANUAL_DEV");
    expect(saida.fields["invitationPublicId"]).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("preserva string, número, booleano e null", () => {
    const saida = redactAuditPayload({ texto: "a", numero: 1, booleano: true, vazio: null });
    expect(saida.fields).toEqual({ texto: "a", numero: 1, booleano: true, vazio: null });
    expect(saida.redactedFields).toEqual([]);
  });
});

describe("redactAuditPayload — entradas degeneradas", () => {
  it("aceita payload como string JSON (depende do driver)", () => {
    const saida = redactAuditPayload('{"deliveryMode":"MANUAL_DEV","token":"x-sintetico"}');
    expect(saida.fields["deliveryMode"]).toBe("MANUAL_DEV");
    expect(saida.fields["token"]).toBe(REDACTED_MARKER);
  });

  it("JSON inválido não derruba a página — vira payload vazio", () => {
    expect(redactAuditPayload("{isso nao e json")).toEqual({ fields: {}, redactedFields: [] });
  });

  it("null e undefined viram payload vazio", () => {
    expect(redactAuditPayload(null)).toEqual({ fields: {}, redactedFields: [] });
    expect(redactAuditPayload(undefined)).toEqual({ fields: {}, redactedFields: [] });
  });
});
