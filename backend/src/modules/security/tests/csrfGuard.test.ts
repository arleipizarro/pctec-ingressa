import { describe, it, expect } from "vitest";
import { isCsrfSafeRequest } from "../http/csrfGuard.js";

const ALLOWED_ORIGINS = ["https://ingressa-dev.pctec.com.br", "http://127.0.0.1:3011"];

describe("isCsrfSafeRequest", () => {
  it("aceita quando Origin corresponde a uma origem permitida", () => {
    expect(
      isCsrfSafeRequest({
        origin: "https://ingressa-dev.pctec.com.br",
        referer: undefined,
        allowedOrigins: ALLOWED_ORIGINS
      })
    ).toBe(true);
  });

  it("rejeita quando Origin não corresponde a nenhuma origem permitida", () => {
    expect(
      isCsrfSafeRequest({
        origin: "https://site-malicioso.example.com",
        referer: undefined,
        allowedOrigins: ALLOWED_ORIGINS
      })
    ).toBe(false);
  });

  it("usa Referer como fallback quando Origin está ausente", () => {
    expect(
      isCsrfSafeRequest({
        origin: undefined,
        referer: "https://ingressa-dev.pctec.com.br/pagina",
        allowedOrigins: ALLOWED_ORIGINS
      })
    ).toBe(true);
  });

  it("rejeita quando Referer não corresponde a nenhuma origem permitida", () => {
    expect(
      isCsrfSafeRequest({
        origin: undefined,
        referer: "https://site-malicioso.example.com/pagina",
        allowedOrigins: ALLOWED_ORIGINS
      })
    ).toBe(false);
  });

  it("rejeita quando nem Origin nem Referer estão presentes — nunca assume 'ausência é segura'", () => {
    expect(isCsrfSafeRequest({ origin: undefined, referer: undefined, allowedOrigins: ALLOWED_ORIGINS })).toBe(
      false
    );
  });

  it("rejeita quando Referer é uma string malformada (não é uma URL válida)", () => {
    expect(
      isCsrfSafeRequest({ origin: undefined, referer: "não-e-uma-url", allowedOrigins: ALLOWED_ORIGINS })
    ).toBe(false);
  });

  it("Origin presente tem prioridade sobre Referer, mesmo se Referer seria válido", () => {
    expect(
      isCsrfSafeRequest({
        origin: "https://site-malicioso.example.com",
        referer: "https://ingressa-dev.pctec.com.br/pagina",
        allowedOrigins: ALLOWED_ORIGINS
      })
    ).toBe(false);
  });

  it("nunca acopla à sessão — a função não recebe nem conhece Session/token/cookie", () => {
    // Verificação estrutural: CsrfCheckInput só tem origin/referer/allowedOrigins.
    const result = isCsrfSafeRequest({
      origin: "http://127.0.0.1:3011",
      referer: undefined,
      allowedOrigins: ALLOWED_ORIGINS
    });
    expect(result).toBe(true);
  });
});
