import type { SessionRepository } from "../domain/session/SessionRepository.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId } from "../../identity/domain/value-objects/PublicId.js";
import { hashSessionToken } from "../infrastructure/token/hashSessionToken.js";
import { SessionValidationFailedError } from "../domain/errors/SessionValidationErrors.js";

export interface ValidateSessionRequest {
  readonly rawSessionToken: string;
}

export interface AuthenticatedPrincipal {
  readonly identityPublicId: string;
  readonly sessionPublicId: string;
}

/**
 * Valida um token de sessão bruto (vindo do cookie) e monta o
 * `AuthenticatedPrincipal` — v0.6.x, Fase E (ADR-030, "Validação
 * defensiva por request").
 *
 * **Nunca resolve `ApplicationAccess`** — retorna exclusivamente
 * `{ identityPublicId, sessionPublicId }`. Mesmo boundary já fixado em
 * `AuthenticateIdentityService` (Fase D): autenticação e autorização
 * permanecem serviços/camadas separados.
 *
 * **Defesa em profundidade (ADR-030):** mesmo uma `Session` `ACTIVE` e
 * não expirada é rejeitada se a `Identity` atual não estiver mais
 * `ACTIVE`, ou `loginEnabled=false` — nunca confia apenas no estado da
 * sessão no momento em que foi criada; sempre revalida o estado ATUAL
 * da `Identity` a cada chamada.
 *
 * **Proteção contra enumeração:** todas as causas de falha (cookie
 * ausente/malformado, token desconhecido, `Session` `REVOKED`,
 * `Session` expirada, `Identity` inexistente, `Identity` não `ACTIVE`,
 * `loginEnabled=false`) lançam a MESMA classe de erro
 * (`SessionValidationFailedError`), com a mesma mensagem externa — ver
 * `SessionValidationErrors.ts` para a justificativa completa da
 * decisão de colapsar externamente.
 *
 * **Sem mitigação de timing dedicada (dummy hash):** diferente do login
 * (Argon2id, custo alto, criado deliberadamente lento), a validação de
 * sessão só faz um lookup indexado por `token_hash` (SHA-256) — não há
 * nenhuma operação cara e variável em custo cujo tempo precise ser
 * nivelado. O token de sessão já tem 256 bits de entropia (mesma
 * justificativa de `hashSessionToken.ts`): um atacante não pode
 * adivinhar/forçar um token válido por tentativa e erro, timing ou não
 * — a mitigação de timing do login existe para proteger contra
 * enumeração de CONTAS via e-mail, um problema que não existe aqui (o
 * "identificador" é um token de alta entropia, não um e-mail de baixa
 * entropia relativa). Decisão documentada, não uma omissão silenciosa.
 */
export class ValidateSessionService {
  public constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly identityRepository: IdentityRepository
  ) {}

  public async execute(request: ValidateSessionRequest): Promise<AuthenticatedPrincipal> {
    const rawToken = request.rawSessionToken;

    if (rawToken.trim().length === 0) {
      throw new SessionValidationFailedError("COOKIE_MALFORMED");
    }

    const tokenHash = hashSessionToken(rawToken);

    const session = await this.sessionRepository.findByTokenHash(tokenHash);
    if (session === undefined) {
      throw new SessionValidationFailedError("SESSION_NOT_FOUND");
    }

    if (session.isRevoked()) {
      throw new SessionValidationFailedError("SESSION_REVOKED");
    }

    if (session.isExpired()) {
      throw new SessionValidationFailedError("SESSION_EXPIRED");
    }

    const identity = await this.identityRepository.findByPublicId(
      PublicId.fromString(session.getIdentityPublicId())
    );
    if (identity === undefined) {
      throw new SessionValidationFailedError("IDENTITY_NOT_FOUND");
    }

    if (identity.getStatus().toString() !== "ACTIVE") {
      throw new SessionValidationFailedError("IDENTITY_NOT_ACTIVE");
    }

    if (!identity.isLoginEnabled()) {
      throw new SessionValidationFailedError("LOGIN_NOT_ENABLED");
    }

    return {
      identityPublicId: identity.getPublicId().toString(),
      sessionPublicId: session.getPublicId().toString()
    };
  }
}
