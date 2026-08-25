import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ServiceCredentialInvalidError } from "../domain/errors/PortalErrors.js";

export const SERVICE_CREDENTIAL_HEADER_NAME = "x-portal-service-credential";

/**
 * Header do consumidor Helpdesk. Cabeçalho PRÓPRIO, e não um genérico
 * compartilhado: com dois consumidores, um header único faria a
 * credencial do Helpdesk ser aceita no namespace do Portal e vice-versa
 * — exatamente o acoplamento que o contrato
 * (`docs/import/CONTRATO-SERVICE-HELPDESK.md`, "Credencial própria")
 * existe para impedir.
 */
export const HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME = "x-helpdesk-service-credential";

/**
 * Middleware — P1A.1 (v0.7.x). Protege a fronteira service-to-service
 * `/api/v1/service/portal/...`, **completamente separada** da fronteira
 * browser-facing `/api/v1/portal/...` (nunca a mesma rota, nunca o
 * mesmo pipeline — decisão do Product Owner). Chamador esperado: o
 * backend do `pctec-portal`, nunca um browser.
 *
 * **Comparação por digest SHA-256, não pela string direto** —
 * `crypto.timingSafeEqual` exige buffers do MESMO TAMANHO; comparar
 * segredos de comprimentos potencialmente diferentes lançaria uma
 * exceção (vazamento de informação por erro, além de quebrar o
 * middleware). Hashear ambos os lados para um digest de tamanho fixo
 * (32 bytes, SHA-256) antes de `timingSafeEqual` elimina essa classe de
 * problema por completo — nunca `===`/`==` em segredo algum.
 *
 * **Falha sempre com `ServiceCredentialInvalidError` (401), nunca
 * diferenciado** — header ausente, valor incorreto, e variável de
 * ambiente `INGRESSA_PORTAL_SERVICE_CREDENTIAL` ausente/vazia/só
 * espaços em branco (fail-closed absoluto: rota fica indisponível,
 * nunca "sem credencial configurada = aceita qualquer coisa")
 * resultam TODOS no mesmo erro externo — decisão deliberada do
 * Product Owner, nunca ensinar ao chamador qual das situações ocorreu.
 *
 * **Importante (revisão pré-commit): isto é fail-closed DA ROTA, nunca
 * fail-stop DA APLICAÇÃO.** `INGRESSA_PORTAL_SERVICE_CREDENTIAL`
 * ausente/vazia NUNCA impede o Ingressa de subir, nem afeta
 * `/health`/login/`/me`/`/portal/context`/qualquer outra rota — o
 * schema em `env.ts` (`z.string().default("")`) garante que
 * `loadEnv()` sempre resolve com sucesso independente desta variável;
 * só esta rota específica fica indisponível quando ela não está
 * configurada.
 */
export function createRequireServiceCredential(
  configuredCredential: string,
  headerName: string = SERVICE_CREDENTIAL_HEADER_NAME
) {
  // Pré-computa o digest do segredo configurado uma única vez (não a
  // cada requisição) — o valor em si nunca muda durante a vida do
  // processo, só o header recebido varia por chamada.
  const configuredDigest = createHash("sha256").update(configuredCredential, "utf8").digest();
  // Fail-closed: string vazia OU só espaços em branco são tratadas
  // exatamente como "não configurada" — nunca um segredo funcional
  // válido por omissão. `.trim()` cobre o caso real de um `.env` com
  // `INGRESSA_PORTAL_SERVICE_CREDENTIAL=   ` (só espaços, por engano
  // operacional) — sem isso, esse valor passaria despercebido como
  // "configurado", mas nunca bateria com nenhum header real, tornando
  // a rota silenciosamente inutilizável sem um sinal claro do motivo.
  const isConfigured = configuredCredential.trim().length > 0;

  return function requireServiceCredential(req: Request, _res: Response, next: NextFunction): void {
    if (!isConfigured) {
      next(new ServiceCredentialInvalidError());
      return;
    }

    const receivedHeader = req.headers[headerName];
    const receivedCredential = Array.isArray(receivedHeader) ? receivedHeader[0] : receivedHeader;
    if (receivedCredential === undefined || receivedCredential.length === 0) {
      next(new ServiceCredentialInvalidError());
      return;
    }

    const receivedDigest = createHash("sha256").update(receivedCredential, "utf8").digest();
    // Ambos os digests SHA-256 têm sempre 32 bytes — timingSafeEqual
    // nunca lança por tamanho divergente aqui, por construção.
    if (!timingSafeEqual(configuredDigest, receivedDigest)) {
      next(new ServiceCredentialInvalidError());
      return;
    }

    next();
  };
}
