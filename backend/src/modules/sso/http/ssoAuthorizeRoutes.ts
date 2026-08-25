import { Router, type NextFunction, type Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import type { ValidateSessionService } from "../../security/application/ValidateSessionService.js";
import { extractSessionTokenFromCookieHeader } from "../../security/http/sessionCookieParser.js";
import type { SsoClientRegistry } from "../domain/SsoClientRegistry.js";
import { SsoAuthorizationRequestInvalidError } from "../domain/errors/SsoErrors.js";
import { isValidCodeChallenge, PKCE_METHOD_S256 } from "../infrastructure/token/pkce.js";
import type { IssueAuthorizationCodeService } from "../application/IssueAuthorizationCodeService.js";

/**
 * Caminho (relativo) da tela de login da UI do Ingressa e do launcher.
 * Relativos de propósito: são os ÚNICOS destinos para os quais esta rota
 * devolve o navegador quando algo impede a emissão, e um caminho
 * relativo não pode virar um host de terceiro por mais criativa que
 * seja a entrada.
 */
const LOGIN_PATH = "/login";
const LAUNCHER_PATH = "/apps";

/** `state` é opaco para o Ingressa; só limitamos tamanho e alfabeto de URL. */
const STATE_PATTERN = /^[A-Za-z0-9\-._~]{8,256}$/;

function primeiroValor(valor: unknown): string | undefined {
  if (typeof valor === "string") {
    return valor;
  }
  if (Array.isArray(valor) && typeof valor[0] === "string") {
    return valor[0] as string;
  }
  return undefined;
}

/**
 * `GET /api/v1/sso/authorize` — etapa 1→3 do fluxo SSO first-party.
 *
 * Recebe o navegador vindo do cliente (Portal), exige sessão válida no
 * Ingressa, verifica autorização e devolve o navegador ao
 * `redirect_uri` com `code` e `state`.
 *
 * **Nada de identidade, sessão, contexto empresarial ou JWT vai na
 * URL** — só um `code` opaco de uso único e o `state` que o próprio
 * cliente mandou. É a diferença entre entregar uma chave e entregar um
 * comprovante de retirada.
 *
 * **Ordem das checagens, e por que ela é essa:**
 *
 * 1. `client_id` + `redirect_uri` contra o registro fechado. Enquanto
 *    esse par não estiver provado, NENHUM redirect acontece — a
 *    resposta é 400 no próprio Ingressa. Redirecionar antes de validar
 *    é precisamente o open redirect.
 * 2. PKCE presente, método `S256`, desafio no formato certo. `plain` e
 *    ausência são recusados: sem PKCE, quem interceptar o código no
 *    redirect consegue trocá-lo.
 * 3. `state` presente e bem formado — devolvido depois SEM ALTERAÇÃO.
 * 4. Sessão válida. Sem sessão, o navegador vai para o login do
 *    Ingressa carregando `next` com o caminho RELATIVO desta mesma
 *    requisição, para retomar o fluxo depois de autenticar.
 * 5. Emissão. Negativa de autorização devolve a pessoa ao launcher com
 *    um marcador de erro — nunca ao `redirect_uri`, mesmo ele sendo
 *    válido: não há motivo para contar ao cliente por que a pessoa foi
 *    barrada.
 */
export function createSsoAuthorizeRoutes(
  registry: SsoClientRegistry,
  validateSessionService: ValidateSessionService,
  issueAuthorizationCodeService: IssueAuthorizationCodeService,
  requiredProfileByClientId: Readonly<Record<string, string>>
): Router {
  const router = Router();

  router.get("/authorize", (req: RequestWithCorrelationId, res: Response, next: NextFunction) => {
    const clientId = primeiroValor(req.query["client_id"]) ?? "";
    const redirectUri = primeiroValor(req.query["redirect_uri"]) ?? "";
    const state = primeiroValor(req.query["state"]) ?? "";
    const codeChallenge = primeiroValor(req.query["code_challenge"]) ?? "";
    const codeChallengeMethod = primeiroValor(req.query["code_challenge_method"]) ?? "";

    const recusar = (reason: string): void => {
      next(new SsoAuthorizationRequestInvalidError(reason));
    };

    let client;
    try {
      client = registry.requireClientWithRedirectUri(clientId, redirectUri);
    } catch (erro) {
      next(erro);
      return;
    }

    if (codeChallengeMethod !== PKCE_METHOD_S256) {
      recusar("CODE_CHALLENGE_METHOD_UNSUPPORTED");
      return;
    }
    if (!isValidCodeChallenge(codeChallenge)) {
      recusar("CODE_CHALLENGE_INVALID");
      return;
    }
    if (!STATE_PATTERN.test(state)) {
      recusar("STATE_INVALID");
      return;
    }

    const rawToken = extractSessionTokenFromCookieHeader(req.header("cookie"));
    if (rawToken === undefined) {
      res.redirect(302, `${LOGIN_PATH}?next=${encodeURIComponent(caminhoDeRetomada(req))}`);
      return;
    }

    validateSessionService
      .execute({ rawSessionToken: rawToken })
      .catch(() => undefined)
      .then((principal) => {
        if (principal === undefined) {
          res.redirect(302, `${LOGIN_PATH}?next=${encodeURIComponent(caminhoDeRetomada(req))}`);
          return undefined;
        }

        return issueAuthorizationCodeService
          .execute({
            identityPublicId: principal.identityPublicId,
            applicationCode: client.clientId,
            requiredProfile: requiredProfileByClientId[client.clientId] ?? "USER",
            redirectUri,
            codeChallenge,
            correlationId: req.correlationId
          })
          .then((emissao) => {
            const destino = new URL(redirectUri);
            destino.searchParams.set("code", emissao.code);
            // `state` volta EXATAMENTE como veio — o cliente compara com o
            // que ele mesmo guardou; qualquer normalização nossa quebraria
            // essa comparação e, com ela, a proteção contra CSRF de login.
            destino.searchParams.set("state", state);
            res.redirect(302, destino.toString());
          })
          .catch(() => {
            // Toda negativa (acesso revogado, identidade inativa, sem
            // vínculo) vira o MESMO marcador. Quem foi barrado descobre
            // com o administrador, não pela URL.
            res.redirect(302, `${LAUNCHER_PATH}?sso_erro=acesso_negado&app=${encodeURIComponent(client.clientId)}`);
          });
      })
      .catch(next);
  });

  return router;
}

/**
 * Caminho RELATIVO desta mesma requisição, para o login retomar o fluxo.
 *
 * Montado a partir de `req.originalUrl`, nunca de um parâmetro enviado
 * pelo cliente: é por isso que o `next` do login nunca pode apontar para
 * fora do Ingressa.
 */
function caminhoDeRetomada(req: RequestWithCorrelationId): string {
  return req.originalUrl;
}
