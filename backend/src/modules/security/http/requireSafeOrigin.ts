import type { NextFunction, Request, Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import { isCsrfSafeRequest } from "./csrfGuard.js";

/** Métodos que não mudam estado — não precisam da checagem de origem. */
const METODOS_SEGUROS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Guarda de origem (CSRF) como MIDDLEWARE, para routers inteiros.
 *
 * `csrfGuard.ts` já existia e já era aplicado ao logout — mas
 * inline, dentro do handler. Repetir aquele bloco em cada rota mutável
 * do assistente teria uma falha previsível: a rota nova que alguém
 * acrescenta daqui a três meses esquece o bloco, e o esquecimento não
 * quebra nenhum teste porque a rota funciona perfeitamente sem ele.
 * Montado no router, o padrão se inverte — a rota nova nasce protegida,
 * e desprotegê-la exige um ato deliberado.
 *
 * A regra em si continua sendo a do ADR-030, sem reimplementação:
 * `Origin` confiável, ou `Referer` confiável na ausência dele, ou 403.
 * Ausência dos dois nunca é tratada como segura.
 *
 * 403 e não 401 de propósito: a sessão pode estar perfeitamente válida
 * — quem não é confiável é a ORIGEM da requisição.
 */
export function createRequireSafeOrigin(allowedOrigins: readonly string[]) {
  return function requireSafeOrigin(req: Request, res: Response, next: NextFunction): void {
    if (METODOS_SEGUROS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const seguro = isCsrfSafeRequest({
      origin: req.header("origin"),
      referer: req.header("referer"),
      allowedOrigins
    });
    if (seguro) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        code: "CSRF_ORIGIN_REJECTED",
        message: "Origem da requisição não é confiável.",
        correlation_id: (req as RequestWithCorrelationId).correlationId ?? null,
        details: []
      }
    });
  };
}
