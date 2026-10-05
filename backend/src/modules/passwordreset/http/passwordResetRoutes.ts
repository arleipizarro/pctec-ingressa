import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import type { CompletePasswordResetService } from "../application/CompletePasswordResetService.js";
import type { RequestPasswordResetService } from "../application/RequestPasswordResetService.js";

/** A ÚNICA resposta do pedido — exista o e-mail ou não. */
export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  "Se este e-mail estiver cadastrado, enviaremos instruções para redefinir sua senha.";

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

export interface PasswordResetRoutesDeps {
  readonly requestPasswordResetService: RequestPasswordResetService;
  readonly completePasswordResetService: CompletePasswordResetService;
  /** Limitador por IP e por IP+e-mail do pedido — roda ANTES de qualquer consulta. */
  readonly requestRateLimit: RequestHandler;
  /** Limitador por IP da conclusão (cada tentativa custa um Argon2id). */
  readonly completeRateLimit: RequestHandler;
  /**
   * Para onde vai uma falha INESPERADA do pedido em segundo plano. Nunca
   * recebe o e-mail; a resposta ao navegador já saiu.
   */
  readonly onBackgroundError?: (erro: unknown) => void;
}

/**
 * Rotas PÚBLICAS do "Esqueci minha senha" — `/api/v1/password-reset`.
 *
 * ## `POST /request` responde ANTES de trabalhar
 *
 * `202` com a frase neutra sai imediatamente, e só então o pedido é
 * processado. Se a resposta esperasse, o tempo dela contaria a quem
 * mede se o e-mail existe: e-mail inexistente responderia em uma
 * consulta, e-mail cadastrado em uma transação mais um envio SMTP. Com
 * a resposta desacoplada, o corpo, o status e o tempo são os mesmos nos
 * dois casos — o desfecho fica só na auditoria.
 *
 * O limitador roda antes da resposta, e ele também não sabe se o e-mail
 * existe (os contadores são o digest do que foi enviado).
 *
 * ## Token no CORPO, nunca na URL
 *
 * Mesmo desenho do convite: o link leva o token no FRAGMENTO
 * (`/redefinir-senha#<token>`), que o navegador nunca envia ao servidor;
 * a página o lê e o manda por `POST`.
 *
 * ## Sem `requireSafeOrigin`
 *
 * Pelo mesmo motivo de `invitationRoutes`: não há autoridade ambiente
 * (cookie) a proteger. Sem o token, `/confirm` não faz nada; e `/request`
 * só pode mandar um e-mail ao próprio titular.
 */
export function createPasswordResetRoutes(deps: PasswordResetRoutesDeps): Router {
  const router = Router();
  const reportar = deps.onBackgroundError ?? ((): void => undefined);

  router.post("/request", deps.requestRateLimit, (req: RequestWithCorrelationId, res: Response) => {
    const email = texto((req.body as Record<string, unknown> | undefined)?.["email"]);
    res.status(202).json({ message: PASSWORD_RESET_NEUTRAL_MESSAGE });
    // Depois da resposta, de propósito — ver o cabeçalho deste arquivo.
    void deps.requestPasswordResetService
      .execute({ email, correlationId: req.correlationId })
      .catch((erro: unknown) => reportar(erro));
  });

  router.post("/preview", deps.completeRateLimit, (req: Request, res: Response, next: NextFunction) => {
    const token = texto((req.body as Record<string, unknown> | undefined)?.["token"]);
    deps.completePasswordResetService
      .preview(token)
      .then((resultado) => {
        res.status(200).json(resultado);
      })
      .catch(next);
  });

  router.post("/confirm", deps.completeRateLimit, (req: RequestWithCorrelationId, res: Response, next: NextFunction) => {
    const body = req.body as Record<string, unknown> | undefined;
    deps.completePasswordResetService
      .execute({
        token: texto(body?.["token"]),
        password: texto(body?.["password"]),
        passwordConfirmation: texto(body?.["passwordConfirmation"]),
        correlationId: req.correlationId
      })
      .then(() => {
        // Nem publicId, nem contagem de sessões: quem chama ainda não se
        // autenticou, e não precisa saber nada além de "deu certo".
        // Nenhum cookie: o próximo passo é o login com a senha nova.
        res.status(200).json({ passwordReset: true });
      })
      .catch(next);
  });

  return router;
}
