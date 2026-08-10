import { describe, it, expect } from "vitest";
import { extractSessionTokenFromCookieHeader } from "../http/sessionCookieParser.js";
import { SESSION_COOKIE_NAME } from "../http/sessionCookie.js";

describe("extractSessionTokenFromCookieHeader", () => {
  it("extrai o token quando o cookie está presente sozinho", () => {
    const result = extractSessionTokenFromCookieHeader(`${SESSION_COOKIE_NAME}=meu-token-aqui`);
    expect(result).toBe("meu-token-aqui");
  });

  it("extrai o token quando há outros cookies junto", () => {
    const result = extractSessionTokenFromCookieHeader(
      `outro_cookie=valor1; ${SESSION_COOKIE_NAME}=meu-token-aqui; terceiro=valor3`
    );
    expect(result).toBe("meu-token-aqui");
  });

  it("cookie ausente -> undefined (nunca lança)", () => {
    expect(extractSessionTokenFromCookieHeader(undefined)).toBeUndefined();
    expect(extractSessionTokenFromCookieHeader("")).toBeUndefined();
    expect(extractSessionTokenFromCookieHeader("outro_cookie=valor")).toBeUndefined();
  });

  it("A) um ingressa_session válido -> retorna o token", () => {
    const result = extractSessionTokenFromCookieHeader(`${SESSION_COOKIE_NAME}=token-unico-valido`);
    expect(result).toBe("token-unico-valido");
  });

  it("B/C) [REVISÃO CRÍTICA, item 3] cookie duplicado -> FAIL CLOSED (undefined), nunca escolhe entre os valores", () => {
    const result = extractSessionTokenFromCookieHeader(
      `${SESSION_COOKIE_NAME}=primeiro-token; ${SESSION_COOKIE_NAME}=segundo-token`
    );
    expect(result).toBeUndefined();
  });

  it("cookie duplicado nunca retorna nem o primeiro nem o último valor", () => {
    const result = extractSessionTokenFromCookieHeader(
      `${SESSION_COOKIE_NAME}=valor-A; ${SESSION_COOKIE_NAME}=valor-B; ${SESSION_COOKIE_NAME}=valor-C`
    );
    expect(result).not.toBe("valor-A");
    expect(result).not.toBe("valor-B");
    expect(result).not.toBe("valor-C");
    expect(result).toBeUndefined();
  });

  it("cookie duplicado onde uma ocorrência tem percent-encoding malformado ainda é fail closed (não resolve silenciosamente para a outra)", () => {
    const result = extractSessionTokenFromCookieHeader(
      `${SESSION_COOKIE_NAME}=%E0%A4%A; ${SESSION_COOKIE_NAME}=token-valido`
    );
    expect(result).toBeUndefined();
  });

  it("D) nenhum dos valores duplicados aparece em nenhuma forma observável do retorno", () => {
    const result = extractSessionTokenFromCookieHeader(
      `${SESSION_COOKIE_NAME}=segredo-A-nao-deveria-vazar; ${SESSION_COOKIE_NAME}=segredo-B-nao-deveria-vazar`
    );
    expect(String(result)).not.toContain("segredo-A-nao-deveria-vazar");
    expect(String(result)).not.toContain("segredo-B-nao-deveria-vazar");
  });

  it("E) cookies com OUTROS nomes duplicados não interferem, desde que ingressa_session apareça exatamente uma vez", () => {
    const result = extractSessionTokenFromCookieHeader(
      `outro_nome=x; outro_nome=y; ${SESSION_COOKIE_NAME}=token-correto; terceiro=z; terceiro=w`
    );
    expect(result).toBe("token-correto");
  });

  it("valor vazio -> string vazia (nunca undefined, nunca lança)", () => {
    const result = extractSessionTokenFromCookieHeader(`${SESSION_COOKIE_NAME}=`);
    expect(result).toBe("");
  });

  it("header malformado (sem '=' em nenhum segmento) -> undefined, nunca lança", () => {
    expect(() => extractSessionTokenFromCookieHeader("isso-nao-e-um-cookie-valido")).not.toThrow();
    expect(extractSessionTokenFromCookieHeader("isso-nao-e-um-cookie-valido")).toBeUndefined();
  });

  it("header malformado (segmentos mistos, alguns sem '=') -> nunca lança, ainda encontra o cookie válido", () => {
    const result = extractSessionTokenFromCookieHeader(`lixo-sem-igual; ${SESSION_COOKIE_NAME}=token-valido`);
    expect(result).toBe("token-valido");
  });

  it("valor com percent-encoding malformado -> undefined, nunca lança (nunca 500)", () => {
    expect(() => extractSessionTokenFromCookieHeader(`${SESSION_COOKIE_NAME}=%E0%A4%A`)).not.toThrow();
    expect(extractSessionTokenFromCookieHeader(`${SESSION_COOKIE_NAME}=%E0%A4%A`)).toBeUndefined();
  });

  it("espaços ao redor do nome/valor são tolerados (trim)", () => {
    const result = extractSessionTokenFromCookieHeader(`  ${SESSION_COOKIE_NAME}  =  token-com-espacos  `);
    expect(result).toBe("token-com-espacos");
  });

  it("nunca loga o valor extraído — função é pura, sem side effects observáveis além do retorno", () => {
    // Prova estrutural: a função não recebe nenhum logger/console
    // injetado, e não há nenhuma chamada a console.* no módulo.
    expect(extractSessionTokenFromCookieHeader.toString()).not.toContain("console.");
  });
});
