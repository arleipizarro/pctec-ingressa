import { Router, type NextFunction, type Request, type Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import type { RedeemIdentityInvitationService } from "../application/RedeemIdentityInvitationService.js";

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/**
 * Rotas PÚBLICAS do convite — `/api/v1/invitations`.
 *
 * Públicas por necessidade: quem abre um convite ainda não tem
 * credencial, então não há sessão para exigir. A autorização é o próprio
 * token de 256 bits, apresentado no CORPO da requisição — nunca na URL.
 *
 * **Por que o token vem no corpo, e não em `GET /invitations/:token`:**
 * um token em caminho de URL entra no access log do Nginx, no `Referer`
 * de qualquer recurso carregado pela página e no histórico do
 * navegador. O link entregue à pessoa leva o token no FRAGMENTO
 * (`/convite#<token>`), que o navegador nunca envia ao servidor; a
 * página o lê em JavaScript e o manda por `POST`.
 *
 * **`requireSafeOrigin` NÃO é aplicado aqui, deliberadamente.** A guarda
 * de origem existe contra CSRF, e CSRF depende de autoridade ambiente
 * (um cookie que o navegador anexa sozinho). Estas rotas não têm
 * nenhuma: sem o token, nada acontece — e com o token, o atacante não
 * precisaria da vítima. Exigir origem aqui só criaria um modo de falha
 * novo, dependente de `ALLOWED_ORIGINS` estar correto, para uma tela que
 * precisa funcionar no primeiro acesso de alguém.
 */
export function createInvitationRoutes(
  redeemIdentityInvitationService: RedeemIdentityInvitationService
): Router {
  const router = Router();

  router.post("/preview", (req: Request, res: Response, next: NextFunction) => {
    const token = texto((req.body as Record<string, unknown> | undefined)?.["token"]);
    redeemIdentityInvitationService
      .preview(token)
      .then((resultado) => {
        res.status(200).json(resultado);
      })
      .catch(next);
  });

  router.post("/redeem", (req: RequestWithCorrelationId, res: Response, next: NextFunction) => {
    const body = req.body as Record<string, unknown> | undefined;
    redeemIdentityInvitationService
      .execute({
        token: texto(body?.["token"]),
        password: texto(body?.["password"]),
        passwordConfirmation: texto(body?.["passwordConfirmation"]),
        correlationId: req.correlationId
      })
      .then((resultado) => {
        // Nenhuma sessão é criada aqui: definir a senha e entrar são
        // dois atos distintos, e o segundo passa pelo login normal, com
        // a senha que a pessoa acabou de escolher. Emitir cookie aqui
        // faria do link de convite um caminho de autenticação — que é
        // exatamente o que ele não deve ser depois de usado.
        res.status(201).json({
          identity: { publicId: resultado.identityPublicId },
          loginEnabled: resultado.loginEnabled
        });
      })
      .catch(next);
  });

  return router;
}
