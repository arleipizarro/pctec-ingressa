import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import { createRequireServiceCredential, SERVICE_CREDENTIAL_HEADER_NAME } from "../requireServiceCredential.js";
import { ServiceCredentialInvalidError } from "../../domain/errors/PortalErrors.js";

function fakeRequest(headers: Record<string, string | string[] | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

describe("createRequireServiceCredential", () => {
  it("A) header ausente -> next(ServiceCredentialInvalidError), mesmo com credencial configurada", () => {
    const middleware = createRequireServiceCredential("segredo-real-de-teste");
    const req = fakeRequest({});
    let receivedError: unknown;

    middleware(req, {} as Response, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(ServiceCredentialInvalidError);
  });

  it("B) header presente mas valor incorreto -> next(ServiceCredentialInvalidError)", () => {
    const middleware = createRequireServiceCredential("segredo-real-de-teste");
    const req = fakeRequest({ [SERVICE_CREDENTIAL_HEADER_NAME]: "valor-errado" });
    let receivedError: unknown;

    middleware(req, {} as Response, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(ServiceCredentialInvalidError);
  });

  it("valor com comprimento DIFERENTE do configurado -> ainda ServiceCredentialInvalidError, nunca lança exceção de timingSafeEqual por tamanho de buffer (prova do digest SHA-256)", () => {
    const middleware = createRequireServiceCredential("segredo-curto");
    const req = fakeRequest({ [SERVICE_CREDENTIAL_HEADER_NAME]: "um-valor-de-comprimento-completamente-diferente-e-bem-mais-longo" });
    let receivedError: unknown;

    expect(() => {
      middleware(req, {} as Response, (error?: unknown) => {
        receivedError = error;
      });
    }).not.toThrow();
    expect(receivedError).toBeInstanceOf(ServiceCredentialInvalidError);
  });

  it("C) header presente com o valor correto -> next() sem erro", () => {
    const middleware = createRequireServiceCredential("segredo-real-de-teste");
    const req = fakeRequest({ [SERVICE_CREDENTIAL_HEADER_NAME]: "segredo-real-de-teste" });
    let receivedError: unknown = "não chamado";

    middleware(req, {} as Response, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeUndefined();
  });

  it("credencial configurada como string vazia -> SEMPRE ServiceCredentialInvalidError, mesmo com um header presente (fail-closed absoluto — nunca 'sem configuração = aceita qualquer coisa')", () => {
    const middleware = createRequireServiceCredential("");
    const req = fakeRequest({ [SERVICE_CREDENTIAL_HEADER_NAME]: "qualquer-valor" });
    let receivedError: unknown;

    middleware(req, {} as Response, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(ServiceCredentialInvalidError);
  });

  it("credencial configurada como só espaços em branco ('   ') -> SEMPRE ServiceCredentialInvalidError, tratada exatamente como não configurada (revisão pré-commit)", () => {
    const middleware = createRequireServiceCredential("   ");
    const req = fakeRequest({ [SERVICE_CREDENTIAL_HEADER_NAME]: "qualquer-valor" });
    let receivedError: unknown;

    middleware(req, {} as Response, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(ServiceCredentialInvalidError);
  });

  it("header vazio ('') -> tratado como ausente, ServiceCredentialInvalidError", () => {
    const middleware = createRequireServiceCredential("segredo-real-de-teste");
    const req = fakeRequest({ [SERVICE_CREDENTIAL_HEADER_NAME]: "" });
    let receivedError: unknown;

    middleware(req, {} as Response, (error?: unknown) => {
      receivedError = error;
    });

    expect(receivedError).toBeInstanceOf(ServiceCredentialInvalidError);
  });

  it("header duplicado (array) usa só o primeiro valor — nunca lança por tipo inesperado", () => {
    const middleware = createRequireServiceCredential("segredo-real-de-teste");
    const req = fakeRequest({ [SERVICE_CREDENTIAL_HEADER_NAME]: ["segredo-real-de-teste", "outro-valor"] });
    let receivedError: unknown = "não chamado";

    expect(() => {
      middleware(req, {} as Response, (error?: unknown) => {
        receivedError = error;
      });
    }).not.toThrow();
    expect(receivedError).toBeUndefined();
  });

  it("estrutural: usa crypto.timingSafeEqual sobre digests, nunca comparação direta de string (=== / ==)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("../requireServiceCredential.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).toContain("timingSafeEqual");
    expect(source).toContain("createHash");
    expect(source).toContain("sha256");
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // Nunca compara os valores crus diretamente (só os digests).
    expect(sourceWithoutComments).not.toMatch(/receivedCredential\s*===\s*configuredCredential/);
  });
});
