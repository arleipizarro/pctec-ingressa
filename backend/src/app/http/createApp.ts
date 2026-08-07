import express, { type Express, type NextFunction, type Request, type Response } from "express";

/**
 * Payload fixo de `GET /health`, conforme especificado na v0.4.1 —
 * Runtime Bootstrap. Deliberadamente estático: não consulta banco, não
 * depende de migration, não expõe hostname/IP/memória/versão do Node ou
 * qualquer segredo. `version` é mantido manualmente em sincronia com
 * `package.json` nesta fatia (não há import de `package.json` em tempo de
 * execução aqui, para manter o endpoint com zero dependências de
 * infraestrutura além do próprio Express).
 */
const HEALTH_PAYLOAD = Object.freeze({
  status: "ok",
  service: "pctec-ingressa",
  version: "0.4.1"
});

/**
 * Cria a aplicação Express, sem abrir porta nenhuma — quem decide
 * `listen()` é `server.ts`. Separar `createApp` de `server.ts` permite
 * testar toda a camada HTTP (via supertest-like `app.request`, aqui feito
 * com `fetch` contra um servidor efêmero nos testes) sem depender de uma
 * porta de rede real fixa.
 *
 * Escopo desta fatia: somente `GET /health`. Nenhuma outra rota, nenhuma
 * autenticação, nenhum middleware de CORS/rate-limit/trust-proxy — todos
 * fora de escopo aqui (não há Nginx na frente ainda).
 */
export function createApp(): Express {
  const app = express();

  // Não anunciar a tecnologia do servidor em nenhuma resposta.
  app.disable("x-powered-by");

  // /health não usa body, mas mantemos um limite pequeno e explícito para
  // qualquer JSON recebido por engano, em vez de aceitar o padrão do
  // Express (100kb) sem uma decisão deliberada.
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json(HEALTH_PAYLOAD);
  });

  // Qualquer outra rota ou método (incluindo métodos diferentes de GET em
  // /health) cai aqui — decisão desta fatia: 404 uniforme, nunca 405,
  // para não revelar quais métodos existiriam em rotas que ainda nem
  // existem publicamente.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  // Handler de erro mínimo: nunca vaza stack trace, mensagem de driver,
  // ou qualquer detalhe interno na resposta. `_next` é mantido na
  // assinatura porque o Express só reconhece um handler de erro pela
  // aridade de 4 parâmetros.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "INTERNAL_ERROR" });
  });

  return app;
}
