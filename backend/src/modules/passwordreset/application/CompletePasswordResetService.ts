import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { Identity } from "../../identity/domain/Identity.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { PasswordHasher } from "../../security/application/BootstrapFirstCredentialService.js";
import type { CredentialRepository } from "../../security/domain/CredentialRepository.js";
import type { SessionRepository } from "../../security/domain/session/SessionRepository.js";
import { CredentialType } from "../../security/domain/value-objects/CredentialType.js";
import { PlainPassword } from "../../security/domain/value-objects/PlainPassword.js";
import { PASSWORD_RESET_SUPERSEDED_REASON } from "../domain/PasswordResetToken.js";
import type { PasswordResetTokenRepository } from "../domain/PasswordResetTokenRepository.js";
import { PasswordResetNotUsableError } from "../domain/errors/PasswordResetErrors.js";
import { createPasswordResetCompletedEvent } from "../domain/events/PasswordResetDomainEvents.js";
import { hashPasswordResetToken } from "../infrastructure/token/passwordResetTokenHash.js";

/** Vai para o evento `credential.changed` — diz POR QUE a senha mudou. */
export const SELF_SERVICE_RESET_REASON_CODE = "SELF_SERVICE_PASSWORD_RESET" as const;
/** Motivo gravado em cada sessão encerrada pela troca. */
export const PASSWORD_RESET_SESSION_REVOCATION_REASON = "PASSWORD_RESET" as const;

export interface PreviewPasswordResetResult {
  readonly expiresAt: string;
}

export interface CompletePasswordResetRequest {
  readonly token: string;
  readonly password: string;
  readonly passwordConfirmation: string;
  readonly correlationId?: string | undefined;
}

export interface CompletePasswordResetResult {
  readonly identityPublicId: string;
  readonly revokedSessions: number;
}

export interface CompletePasswordResetDeps {
  readonly unitOfWork: UnitOfWork;
  readonly passwordResetTokenRepositoryFactory: (connection: Queryable) => PasswordResetTokenRepository;
  readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository;
  readonly credentialRepositoryFactory: (connection: Queryable) => CredentialRepository;
  readonly sessionRepositoryFactory: (connection: Queryable) => SessionRepository;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
  readonly passwordHasher: PasswordHasher;
  /** Leituras do `preview` — fora de transação. */
  readonly readOnlyPasswordResetTokenRepository: PasswordResetTokenRepository;
  readonly readOnlyIdentityRepository: IdentityRepository;
  readonly now?: () => Date;
}

/** A conta ainda pode ter a senha redefinida? Mesma regra do pedido. */
function podeRedefinir(identity: Identity | undefined): identity is Identity {
  return identity !== undefined && identity.getStatus().toString() === "ACTIVE" && identity.isLoginEnabled();
}

/**
 * Conclusão do "Esqueci minha senha" — rota PÚBLICA; a autorização é o
 * token de uso único.
 *
 * **Política de senha ANTES do consumo** (mesma ordem do convite): senha
 * curta é erro de digitação, e queimar o link por isso obrigaria a
 * pessoa a pedir outro a cada engano.
 *
 * **Tudo numa transação só:** consumo atômico do token, troca do hash na
 * Credential que JÁ existe (nunca uma segunda `LOCAL_PASSWORD`),
 * revogação de todas as sessões ativas e dos demais pedidos abertos, e a
 * auditoria. Ou a pessoa sai daqui com senha nova e sem sessão antiga
 * viva, ou nada aconteceu.
 *
 * **Revoga as sessões** porque o motivo mais comum de trocar a senha é
 * suspeitar que outra pessoa a conhece — quem já estava logado com a
 * senha antiga não pode continuar dentro.
 *
 * **Reconfere a conta** no momento da troca: entre o pedido e o clique,
 * o ADMIN pode ter desabilitado o login ou bloqueado a identidade. Nesse
 * caso o link deixa de valer — sem regra explícita, login desabilitado
 * não tem senha redefinida.
 *
 * Nenhuma sessão nasce aqui: trocar a senha e entrar são dois atos, e o
 * segundo passa pelo login normal.
 */
export class CompletePasswordResetService {
  private readonly agora: () => Date;

  public constructor(private readonly deps: CompletePasswordResetDeps) {
    this.agora = deps.now ?? ((): Date => new Date());
  }

  /**
   * Abre a tela sem gastar o link — leitura pura. Devolve só a validade:
   * quem abre esta tela ainda não provou ser ninguém.
   */
  public async preview(rawToken: string): Promise<PreviewPasswordResetResult> {
    const token =
      rawToken.length === 0
        ? undefined
        : await this.deps.readOnlyPasswordResetTokenRepository.findUsableByTokenHash(
            hashPasswordResetToken(rawToken),
            this.agora()
          );
    if (token === undefined) {
      throw new PasswordResetNotUsableError("NOT_FOUND_OR_EXPIRED");
    }
    const identity = await this.deps.readOnlyIdentityRepository.findByPublicId(
      IdentityPublicId.fromString(token.getIdentityPublicId())
    );
    if (!podeRedefinir(identity)) {
      throw new PasswordResetNotUsableError("IDENTITY_NOT_USABLE");
    }
    return { expiresAt: token.getExpiresAt().toISOString() };
  }

  public async execute(request: CompletePasswordResetRequest): Promise<CompletePasswordResetResult> {
    const correlationId = request.correlationId ?? randomUUID();
    // Política existente (comprimento mínimo + blacklist, ADR-029) — o
    // MESMO Value Object do convite e do bootstrap, nunca reimplementado.
    const plainPassword = PlainPassword.createWithConfirmation(request.password, request.passwordConfirmation);
    if (request.token.length === 0) {
      throw new PasswordResetNotUsableError("TOKEN_MISSING");
    }
    const tokenHash = hashPasswordResetToken(request.token);
    const passwordHash = await this.deps.passwordHasher.hash(plainPassword);

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const tokens = this.deps.passwordResetTokenRepositoryFactory(connection);
      const identities = this.deps.identityRepositoryFactory(connection);
      const credentials = this.deps.credentialRepositoryFactory(connection);
      const sessions = this.deps.sessionRepositoryFactory(connection);
      const auditoria = this.deps.auditEventRepositoryFactory(connection);
      const agora = this.agora();

      const token = await tokens.consumeByTokenHash(tokenHash, agora);
      if (token === undefined) {
        throw new PasswordResetNotUsableError("NOT_CONSUMABLE");
      }

      const identityPublicId = token.getIdentityPublicId();
      const identity = await identities.findByPublicId(IdentityPublicId.fromString(identityPublicId));
      if (!podeRedefinir(identity)) {
        // O `throw` desfaz o consumo junto com a transação — e o link
        // continua inútil, porque o `preview` e este mesmo teste o
        // recusam enquanto a conta estiver nesse estado.
        throw new PasswordResetNotUsableError("IDENTITY_NOT_USABLE");
      }

      const credential = await credentials.findByIdentityAndType(identityPublicId, CredentialType.localPassword());
      if (credential === undefined || !credential.isActive()) {
        throw new PasswordResetNotUsableError("CREDENTIAL_NOT_USABLE");
      }

      const versaoOriginal = credential.getVersion();
      credential.resetPassword({
        newPasswordHash: passwordHash,
        // O titular é o ator: quem trocou a senha foi quem tinha acesso
        // à caixa de e-mail dele.
        actorPublicId: identityPublicId,
        reasonCode: SELF_SERVICE_RESET_REASON_CODE,
        expectedVersion: versaoOriginal,
        correlationId,
        now: agora
      });
      await credentials.update(credential, versaoOriginal);
      const eventos: AuditEvent[] = credential.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento));

      // Cada sessão passa pelo próprio agregado, para gerar o próprio
      // `session.revoked` — mesmo padrão de ResetAdminPasswordService.
      const ativas = (await sessions.findActiveByIdentityPublicId?.(identityPublicId)) ?? [];
      for (const sessao of ativas) {
        const versaoSessao = sessao.getVersion();
        sessao.revoke({
          reason: PASSWORD_RESET_SESSION_REVOCATION_REASON,
          actorPublicId: identityPublicId,
          correlationId,
          now: agora
        });
        await sessions.update(sessao, versaoSessao);
        eventos.push(...sessao.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento)));
      }

      // Defesa em profundidade: o pedido já revoga os anteriores, mas
      // nenhum outro link deve sobreviver a uma troca concluída.
      await tokens.revokePendingByIdentity(identityPublicId, agora, PASSWORD_RESET_SUPERSEDED_REASON);

      eventos.push(
        AuditEvent.fromDomainEvent(
          createPasswordResetCompletedEvent(
            {
              aggregatePublicId: identityPublicId,
              actorPublicId: identityPublicId,
              correlationId,
              occurredAt: agora
            },
            {
              resetRequestPublicId: token.getPublicId().toString(),
              identityPublicId,
              credentialPublicId: credential.getPublicId().toString(),
              revokedSessions: ativas.length
            }
          )
        )
      );
      await auditoria.insertMany(eventos);

      return { identityPublicId, revokedSessions: ativas.length };
    });
  }
}
