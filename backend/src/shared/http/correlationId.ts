import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const CORRELATION_ID_HEADER = "X-Correlation-Id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extensão mínima e local de `Request` — evita `declare global` (que
 * afetaria toda a aplicação Express de uma vez, incluindo módulos
 * futuros que não têm nada a ver com isto).
 */
export interface RequestWithCorrelationId extends Request {
  correlationId?: string;
}

/**
 * Conforme docs/02-arquitetura/API-CONTRACT-V1.md, "Convenções gerais":
 * "Toda requisição e resposta inclui um cabeçalho X-Correlation-Id. Se o
 * cliente não enviar, o servidor gera um e o retorna na resposta."
 *
 * Um `X-Correlation-Id` recebido que não seja um UUID sintaticamente
 * válido é IGNORADO (gera um novo) — nunca é ecoado de volta sem
 * validação, para não virar um vetor de injeção de log/cabeçalho
 * arbitrário vindo do cliente.
 */
export function correlationIdMiddleware(req: RequestWithCorrelationId, res: Response, next: NextFunction): void {
  const incoming = req.header(CORRELATION_ID_HEADER);
  const correlationId = incoming !== undefined && UUID_PATTERN.test(incoming) ? incoming.toLowerCase() : randomUUID();
  req.correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  next();
}
