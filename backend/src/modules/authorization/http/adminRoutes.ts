import { Router, type Response, type NextFunction } from "express";
import type { RequestWithAuthorization } from "./requireApplicationAccess.js";
import type { GetIdentityByPublicIdService } from "../../identity/application/GetIdentityByPublicIdService.js";

/**
 * Rota HTTP `GET /api/v1/admin/whoami` — v0.6.x, Fase F.
 *
 * Primeira rota administrativa de prova: comprova que somente uma
 * Identity autenticada COM `ApplicationAccess` `ADMIN`/`GRANTED` para
 * `PCTEC_INGRESSA` passa. Protegida por `requireAuthenticatedSession` →
 * `requireApplicationAccess` (nessa ordem, montados em `createApp.ts`)
 * — quando este handler executa, `req.auth` E `req.authorization` já
 * estão garantidamente preenchidos.
 *
 * **Payload mínimo deliberado** (task, seção 13): identidade, código da
 * aplicação, perfil — nunca senha/Credential/token/Session token/dados
 * pessoais desnecessários.
 *
 * `fullName` entrou em v0.9.1 por uma razão de uso: o cabeçalho da UI
 * mostrava `Identidade 66231e51…`, e um UUID truncado não diz a ninguém
 * quem está logado. O nome é o dado MENOS revelador que responde à
 * pergunta "sou eu mesmo nesta sessão?" — menos que e-mail, que
 * identifica a pessoa fora do sistema. É opcional na resposta: se a
 * identidade não puder ser carregada, a rota continua respondendo 200
 * com o resto, e o cliente usa um rótulo neutro.
 */
export function createAdminWhoamiRoutes(
  getIdentityByPublicId?: GetIdentityByPublicIdService
): Router {
  const router = Router();

  router.get("/whoami", (req: RequestWithAuthorization, res: Response, next: NextFunction) => {
    const authorization = req.authorization;
    if (authorization === undefined) {
      res.status(403).json({
        error: {
          code: "APPLICATION_ACCESS_DENIED",
          message: "Acesso negado a esta aplicação.",
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }

    const responder = (fullName: string | null): void => {
      res.status(200).json({
        identity: { publicId: authorization.identityPublicId, fullName },
        application: { code: authorization.applicationCode },
        access: { profile: authorization.accessProfile }
      });
    };

    if (getIdentityByPublicId === undefined) {
      responder(null);
      return;
    }

    getIdentityByPublicId
      .execute(authorization.identityPublicId)
      .then((identity) => responder(identity.getFullName().toString()))
      // Falha ao carregar o nome não derruba o whoami: quem está
      // autenticado continua autenticado, e o cliente cai no rótulo
      // neutro. Só um erro inesperado sobe.
      .catch(() => responder(null));
    void next;
  });

  return router;
}
