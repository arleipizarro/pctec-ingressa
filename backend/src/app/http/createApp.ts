import express, { type Express, type NextFunction, type Response } from "express";

import { createPool } from "../../shared/database/Pool.js";
import { loadEnv } from "../config/env.js";
import { correlationIdMiddleware, type RequestWithCorrelationId } from "../../shared/http/correlationId.js";
import { isDomainError, mapDomainErrorToHttp } from "../../shared/http/mapDomainErrorToHttp.js";
import type { IdentityRepository } from "../../modules/identity/domain/IdentityRepository.js";
import { MariaDbIdentityRepository } from "../../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { GetIdentityByPublicIdService } from "../../modules/identity/application/GetIdentityByPublicIdService.js";
import { createIdentityRoutes } from "../../modules/identity/http/identityRoutes.js";

/**
 * Payload fixo de `GET /health`, conforme especificado na v0.4.1 —
 * Runtime Bootstrap. Deliberadamente estático: não consulta banco, não
 * depende de migration, não expõe hostname/IP/memória/versão do Node ou
 * qualquer segredo. `version` é mantido manualmente em sincronia com
 * `package.json` (ver README, seção "Versionamento", para a recomendação
 * de fonte única — não implementada silenciosamente nesta fatia).
 */
const HEALTH_PAYLOAD = Object.freeze({
  status: "ok",
  service: "pctec-ingressa",
  version: "0.5.0"
});

export interface CreateAppOptions {
  /**
   * Injetável para testes (fake/in-memory) — em produção, quando
   * omitido, `createApp()` constrói um `MariaDbIdentityRepository` real
   * a partir de `loadEnv()`. Criar o `Pool` aqui NUNCA abre uma conexão
   * de verdade (mysql2 conecta de forma preguiçosa, só no primeiro
   * `execute()`) — por isso `GET /health` continua funcionando mesmo sem
   * nenhum MariaDB acessível, e `npm test`/`typecheck`/`build` nunca
   * tocam rede.
   */
  readonly identityRepository?: IdentityRepository;
}

function defaultIdentityRepository(): IdentityRepository {
  const env = loadEnv();
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });
  return new MariaDbIdentityRepository(pool);
}

/**
 * Cria a aplicação Express, sem abrir porta nenhuma — quem decide
 * `listen()` é `server.ts`. Separar `createApp` de `server.ts` permite
 * testar toda a camada HTTP com `fetch` contra um servidor efêmero nos
 * testes, sem depender de uma porta de rede real fixa.
 *
 * Escopo desta fatia (v0.5.0 Slice 1): `GET /health` (já existente) +
 * `GET /api/v1/identities/:publicId` (novo, somente leitura). Nenhuma
 * outra rota, nenhuma autenticação, nenhum middleware de
 * CORS/rate-limit/trust-proxy — todos fora de escopo aqui (não há Nginx
 * na frente da API de Identity ainda; só `/health` é exposto pelo Nginx
 * DEV).
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const identityRepository = options.identityRepository ?? defaultIdentityRepository();
  const getIdentityByPublicId = new GetIdentityByPublicIdService(identityRepository);

  // Não anunciar a tecnologia do servidor em nenhuma resposta.
  app.disable("x-powered-by");

  // Corpo de requisição pequeno e explícito — nenhuma rota desta fatia
  // usa body (GET simples), mas mantemos o limite por precaução, em vez
  // de aceitar o padrão do Express (100kb) sem uma decisão deliberada.
  app.use(express.json({ limit: "10kb" }));

  // Conforme API-CONTRACT-V1.md: todo request/response carrega
  // X-Correlation-Id (gerado se ausente/inválido).
  app.use(correlationIdMiddleware);

  app.get("/health", (_req, res: Response) => {
    res.status(200).json(HEALTH_PAYLOAD);
  });

  app.use("/api/v1/identities", createIdentityRoutes(getIdentityByPublicId));

  // Qualquer outra rota ou método cai aqui — decisão desta fatia: 404
  // uniforme, nunca 405, para não revelar quais métodos existiriam em
  // rotas que ainda nem existem publicamente. Mesmo envelope de erro
  // padronizado (API-CONTRACT-V1.md) usado pelo handler de erro abaixo.
  app.use((req: RequestWithCorrelationId, res: Response) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Rota não encontrada.", correlation_id: req.correlationId ?? null, details: [] }
    });
  });

  // Handler de erro central: nunca vaza stack trace, mensagem de driver,
  // nome de tabela/coluna, ou qualquer detalhe interno na resposta.
  // `DomainError` é mapeada para o status HTTP correto
  // (`mapDomainErrorToHttp`); qualquer outro erro (bug, falha de driver,
  // etc.) vira 500 genérico e sanitizado. `_next` é mantido na
  // assinatura porque o Express só reconhece um handler de erro pela
  // aridade de 4 parâmetros.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: RequestWithCorrelationId, res: Response, _next: NextFunction) => {
    const correlationId = req.correlationId ?? null;
    if (isDomainError(err)) {
      const mapped = mapDomainErrorToHttp(err);
      res.status(mapped.status).json({
        error: { code: mapped.code, message: mapped.message, correlation_id: correlationId, details: [] }
      });
      return;
    }
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Erro interno inesperado.", correlation_id: correlationId, details: [] }
    });
  });

  return app;
}
