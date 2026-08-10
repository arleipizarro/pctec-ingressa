import { SESSION_COOKIE_NAME } from "./sessionCookie.js";

/**
 * Extrai o token bruto de sessão do header `Cookie` — v0.6.x, Fase E.
 *
 * **Sem dependência de `cookie-parser`** — deliberado. O parsing
 * necessário aqui é mínimo (um único cookie nomeado, valor opaco sem
 * caracteres especiais esperados) e não justifica uma dependência
 * externa nova só para isto; `cookie-parser` resolveria um problema bem
 * mais genérico (múltiplos cookies, atributos, `signed cookies`) que
 * esta fatia não precisa.
 *
 * Requisitos (task, seção 9; revisão crítica, item 3 — cookie duplicado
 * corrigido para fail closed):
 * - nome centralizado (`SESSION_COOKIE_NAME`, `sessionCookie.ts`);
 * - cookie ausente → retorna `undefined` (nunca lança) — o chamador
 *   decide "não autenticado";
 * - **cookie duplicado (`Cookie` com o nome canônico mais de uma vez —
 *   tecnicamente inválido por HTTP, mas alguns proxies/clientes
 *   malformados, ou um ataque de "cookie injection" via subdomínio,
 *   podem produzir isso) → FAIL CLOSED: retorna `undefined`
 *   (equivalente a "ausente"), NUNCA escolhe entre os valores — nem o
 *   primeiro, nem o último.** Motivo: escolher qualquer um dos dois
 *   tornaria a autenticação dependente de uma precedência/ordem
 *   ambígua de cookies, uma superfície de ambiguidade que não deveria
 *   existir para uma decisão de segurança (ADR-030, "Cookie duplicado —
 *   fail closed"). Nenhum dos dois valores é logado.
 * - valor vazio (`ingressa_session=`) → retorna string vazia (o
 *   chamador, `ValidateSessionService`, já trata string vazia como
 *   inválida);
 * - header `Cookie` malformado (não é uma lista `nome=valor; ...`
 *   sintaticamente razoável) → nunca lança, nunca 500 — na pior
 *   hipótese, não encontra o cookie esperado e retorna `undefined`.
 *
 * Nunca loga o valor do header nem do token extraído.
 */
export function extractSessionTokenFromCookieHeader(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined || cookieHeader.trim().length === 0) {
    return undefined;
  }

  const pairs = cookieHeader.split(";");
  let occurrenceCount = 0;
  let decodedValue: string | undefined;
  let hadDecodeError = false;

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue; // segmento sem "=" — ignorado, nunca lança
    }
    const name = pair.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      occurrenceCount += 1;
      const rawValue = pair.slice(separatorIndex + 1).trim();
      try {
        decodedValue = decodeURIComponent(rawValue);
      } catch {
        // valor com percent-encoding malformado — nunca lança; marca o
        // erro mas continua contando ocorrências (uma duplicata com um
        // lado malformado ainda precisa ser fail closed, não
        // silenciosamente resolvida para a outra ocorrência).
        hadDecodeError = true;
      }
    }
  }

  if (occurrenceCount === 0) {
    return undefined;
  }
  if (occurrenceCount > 1) {
    // Fail closed — nunca escolhe entre os valores, mesmo que só um
    // deles tenha erro de decode.
    return undefined;
  }
  if (hadDecodeError) {
    return undefined;
  }

  return decodedValue;
}
