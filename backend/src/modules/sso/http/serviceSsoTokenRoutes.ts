import { Router, type NextFunction, type Request, type Response } from "express";
import type { ExchangeAuthorizationCodeService } from "../application/ExchangeAuthorizationCodeService.js";
import { SsoAuthorizationCodeExchangeFailedError } from "../domain/errors/SsoErrors.js";
import type { SsoClientRegistry } from "../domain/SsoClientRegistry.js";

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/**
 * `POST /api/v1/service/sso/token` — etapa 4/5 do fluxo SSO.
 *
 * **Fronteira service-to-service**, protegida por
 * `requireServiceCredential` (montado em `createApp.ts`, ANTES deste
 * router) com a credencial que o Portal já usa desde P1A.1 — nenhuma
 * credencial nova foi criada para o SSO: é o mesmo canal, o mesmo
 * segredo e o mesmo header. Um navegador nunca chega aqui.
 *
 * **Resposta deliberadamente mínima** (contrato, etapa 5):
 * `identityPublicId`, nome, aplicação/perfil e o identificador de
 * correlação. Nunca token, nunca cookie, nunca hash, nunca senha, nunca
 * memberships — o contexto empresarial continua vindo dos serviços que
 * já existem (`/api/v1/service/portal/...`), consultados pelo cliente
 * depois, com a identidade em mãos.
 */
export function createServiceSsoTokenRoutes(
  exchangeAuthorizationCodeService: ExchangeAuthorizationCodeService,
  registry: SsoClientRegistry,
  requiredProfileByClientId: Readonly<Record<string, string>>
): Router {
  const router = Router();

  router.post("/token", (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as Record<string, unknown> | undefined;
    const clientId = texto(body?.["client_id"]);
    const code = texto(body?.["code"]);
    const codeVerifier = texto(body?.["code_verifier"]);
    const redirectUri = texto(body?.["redirect_uri"]);

    // O cliente precisa existir no registro E o `redirect_uri`
    // apresentado precisa continuar sendo um dos dele. A comparação com o
    // `redirect_uri` gravado no código acontece depois, no service — as
    // duas checagens respondem coisas diferentes: esta diz "isso é um
    // destino legítimo deste cliente", aquela diz "é o MESMO destino da
    // emissão".
    let client;
    try {
      client = registry.requireClientWithRedirectUri(clientId, redirectUri);
    } catch {
      next(new SsoAuthorizationCodeExchangeFailedError("CLIENT_OR_REDIRECT_URI_NOT_REGISTERED"));
      return;
    }

    if (code.length === 0 || codeVerifier.length === 0) {
      next(new SsoAuthorizationCodeExchangeFailedError("MISSING_PARAMETERS"));
      return;
    }

    exchangeAuthorizationCodeService
      .execute({
        code,
        codeVerifier,
        redirectUri,
        clientId: client.clientId,
        requiredProfile: requiredProfileByClientId[client.clientId] ?? "USER"
      })
      .then((resultado) => {
        res.status(200).json({
          identity: { publicId: resultado.identityPublicId, fullName: resultado.fullName },
          application: { code: resultado.applicationCode },
          access: { profile: resultado.accessProfile },
          correlationId: resultado.correlationId
        });
      })
      .catch(next);
  });

  return router;
}
