import { randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { LoginRateLimitBucket, LoginRateLimitPolicy } from "../domain/LoginRateLimitPolicy.js";
import type { LoginRateLimitStore } from "../domain/LoginRateLimitStore.js";
import { createAuthRateLimitBlockedEvent } from "../domain/events/AuthRateLimitDomainEvents.js";
import type { ClientIpResolver } from "./resolveClientIp.js";

/**
 * `aggregate_public_id` dos eventos de rate limit.
 *
 * Não existe agregado aqui — o que foi barrado é uma requisição, não uma
 * entidade. A coluna é `NOT NULL`, então usamos um valor FIXO e
 * documentado que representa "o endpoint de criação de sessão". Fixo, e
 * não aleatório, para que `WHERE aggregate_public_id = ...` continue
 * sendo uma consulta útil; e não o `publicId` de nada real, para que
 * ninguém o confunda com uma Identity.
 */
export const AUTH_RATE_LIMIT_AGGREGATE_PUBLIC_ID = "00000000-0000-4000-8000-0000000000a1";

/** Ator dos eventos de rate limit — a decisão é do servidor, não de uma pessoa. */
const ATOR_SISTEMA = "SYSTEM";

export interface LoginRateLimitDeps {
  readonly policy: LoginRateLimitPolicy;
  readonly store: LoginRateLimitStore;
  readonly auditEventRepository: AuditEventRepository;
  readonly resolveClientIp: ClientIpResolver;
  /** Injetável para tornar os testes determinísticos. */
  readonly now?: () => Date;
}

/**
 * Limitador de tentativas de `POST /api/v1/sessions`.
 *
 * ## Conta TENTATIVAS, e estorna quando o login dá certo
 *
 * A alternativa — contar só falhas — parece mais precisa e é pior em
 * dois pontos. Primeiro, a falha só é conhecida DEPOIS do trabalho caro
 * (Argon2id sobre a senha), então cada tentativa barrada ainda custaria
 * o hash: o limitador não protegeria a CPU, que é metade do motivo de
 * existir. Segundo, contar depois obriga a registrar o resultado fora do
 * caminho da requisição, o que abre corrida entre respostas paralelas.
 *
 * Contando a tentativa ANTES, a decisão é tomada com uma escrita atômica
 * e nada caro acontece quando o teto já estourou. O custo — uso legítimo
 * consumindo orçamento — é devolvido pelo estorno em caso de sucesso
 * (`201`), que é o único desfecho em que se sabe que não era ataque.
 *
 * ## Nunca revela se o e-mail existe
 *
 * A decisão acontece antes de qualquer consulta ao banco de identidades.
 * E-mail cadastrado e e-mail inventado produzem o mesmo contador, o
 * mesmo limite, o mesmo `429` e o mesmo `Retry-After`. Nada aqui
 * consulta `identities`, e por isso não há como este caminho distinguir
 * os dois casos nem para si mesmo.
 *
 * ## Fecha, não abre, quando a infraestrutura falha
 *
 * Erro ao consultar o contador vira `503`, nunca "deixa passar". O
 * armazenamento é o MESMO banco que autentica: se ele está fora, o login
 * não teria como funcionar de qualquer jeito, então falhar fechado não
 * custa disponibilidade nenhuma. Falhar aberto, ao contrário,
 * transformaria qualquer instabilidade momentânea numa janela sem
 * proteção — e é justamente durante a instabilidade que ninguém está
 * olhando.
 *
 * ## Nada sensível entra em log, evento ou banco
 *
 * Senha, token e e-mail nunca são tocados por este caminho além de virar
 * digest. O evento de auditoria não carrega IP, e-mail nem o próprio
 * digest — ver `AuthRateLimitDomainEvents`.
 */
export function createLoginRateLimitMiddleware(deps: LoginRateLimitDeps) {
  const config = deps.policy.getConfig();
  const agora = deps.now ?? ((): Date => new Date());

  return function loginRateLimit(req: RequestWithCorrelationId, res: Response, next: NextFunction): void {
    if (!config.enabled) {
      next();
      return;
    }

    const now = agora();
    const clientIp = deps.resolveClientIp(req);
    const body = req.body as Record<string, unknown> | undefined;
    // Mesma leitura tolerante da rota de login: corpo ausente ou campo
    // de outro tipo NÃO é um caminho distinto — vira "sem
    // identificador", e a tentativa continua contando no escopo de
    // origem.
    const identifier = typeof body?.["email"] === "string" ? (body["email"] as string) : undefined;
    const buckets = deps.policy.buildBuckets({ clientIp, identifier });

    deps.store
      .consume(buckets, now, config.windowSeconds)
      .then(async (counters) => {
        const estourados = counters.filter((counter) => counter.attemptCount > counter.bucket.limit);

        if (estourados.length === 0) {
          armarEstornoEmCasoDeSucesso(res, deps.store, buckets, agora);
          next();
          return;
        }

        const retryAfter = Math.max(
          ...estourados.map((counter) => deps.policy.retryAfterSeconds(counter.windowStartedAt, now))
        );

        // Só a requisição que CRUZA o limite vira evento. As demais da
        // mesma janela seriam uma escrita por requisição do atacante.
        const transicoes = estourados.filter((counter) => counter.attemptCount === counter.bucket.limit + 1);
        for (const transicao of transicoes) {
          await registrarBloqueio(deps.auditEventRepository, transicao.bucket, config.windowSeconds, now, req);
        }

        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json({
          error: {
            code: "LOGIN_RATE_LIMITED",
            // Mensagem única, sem dizer QUAL limite foi atingido: saber
            // se foi o de origem ou o de origem+e-mail já diria algo
            // sobre o que mais está acontecendo no sistema.
            message: "Muitas tentativas de autenticação. Tente novamente mais tarde.",
            correlation_id: req.correlationId ?? null,
            details: []
          }
        });
      })
      .catch(() => {
        // Fail-closed. Nunca `next()` aqui: seguir adiante seria
        // exatamente o comportamento que a indisponibilidade do contador
        // não pode produzir.
        res.status(503).json({
          error: {
            code: "LOGIN_RATE_LIMIT_UNAVAILABLE",
            message: "Serviço de autenticação temporariamente indisponível.",
            correlation_id: req.correlationId ?? null,
            details: []
          }
        });
      });
  };
}

/**
 * Devolve a tentativa quando a resposta foi `201` — o único desfecho que
 * prova que a requisição era legítima.
 *
 * Roda no `finish` da resposta, portanto DEPOIS de quem chamou já ter
 * sido atendido: um estorno que falhe não atrapalha ninguém, e por isso
 * o erro é engolido. O pior caso de perder um estorno é alguém consumir
 * um pouco mais do próprio orçamento — nunca uma brecha de segurança,
 * porque estorno só afrouxa.
 */
function armarEstornoEmCasoDeSucesso(
  res: Response,
  store: LoginRateLimitStore,
  buckets: readonly LoginRateLimitBucket[],
  agora: () => Date
): void {
  res.once("finish", () => {
    if (res.statusCode !== 201) {
      return;
    }
    void store.refund(buckets, agora()).catch(() => undefined);
  });
}

async function registrarBloqueio(
  auditEventRepository: AuditEventRepository,
  bucket: LoginRateLimitBucket,
  windowSeconds: number,
  now: Date,
  req: RequestWithCorrelationId
): Promise<void> {
  try {
    await auditEventRepository.insert(
      AuditEvent.fromDomainEvent(
        createAuthRateLimitBlockedEvent(
          {
            aggregatePublicId: AUTH_RATE_LIMIT_AGGREGATE_PUBLIC_ID,
            actorPublicId: ATOR_SISTEMA,
            correlationId: req.correlationId ?? randomUUID(),
            occurredAt: now
          },
          { scopeKind: bucket.kind, limit: bucket.limit, windowSeconds }
        )
      )
    );
  } catch {
    // A auditoria do bloqueio é observabilidade, não a proteção. Se ela
    // falhar, o `429` ainda tem de sair — deixar de barrar porque não se
    // conseguiu registrar que barrou seria trocar a garantia pelo
    // relatório dela.
  }
}
