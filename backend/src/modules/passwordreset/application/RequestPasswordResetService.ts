import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { CredentialRepository } from "../../security/domain/CredentialRepository.js";
import { CredentialType } from "../../security/domain/value-objects/CredentialType.js";
import {
  PASSWORD_RESET_SUPERSEDED_REASON,
  PasswordResetToken
} from "../domain/PasswordResetToken.js";
import type { PasswordResetTokenRepository } from "../domain/PasswordResetTokenRepository.js";
import {
  PASSWORD_RESET_FORM_AGGREGATE_PUBLIC_ID,
  PASSWORD_RESET_SYSTEM_ACTOR,
  createPasswordResetDeliveryFailedEvent,
  createPasswordResetRequestedEvent,
  type PasswordResetRequestOutcome,
  type PasswordResetRequestedPayload
} from "../domain/events/PasswordResetDomainEvents.js";
import {
  hashPasswordResetToken,
  type PasswordResetTokenGenerator
} from "../infrastructure/token/passwordResetTokenHash.js";
import type { PasswordResetDelivery } from "./PasswordResetDelivery.js";

/** Teto padrão de pedidos por titular na janela (ver `countCreatedSince`). */
export const DEFAULT_MAX_PASSWORD_RESETS_PER_IDENTITY = 3;
export const DEFAULT_PASSWORD_RESET_IDENTITY_WINDOW_SECONDS = 3_600;

/** Caminho da tela de nova senha. O token vai no FRAGMENTO. */
export const PASSWORD_RESET_PATH = "/redefinir-senha";

export interface RequestPasswordResetRequest {
  readonly email: string;
  readonly correlationId?: string | undefined;
}

/**
 * Resultado INTERNO — para teste e diagnóstico. A rota HTTP o descarta:
 * a resposta ao navegador é a mesma frase neutra em todos os casos.
 */
export interface RequestPasswordResetResult {
  readonly outcome: PasswordResetRequestOutcome;
  /** `false` quando o link foi emitido mas o canal recusou a mensagem. */
  readonly delivered: boolean;
}

export interface RequestPasswordResetDeps {
  readonly unitOfWork: UnitOfWork;
  /** Leituras de elegibilidade — fora da transação, sem trava. */
  readonly identityRepository: IdentityRepository;
  readonly credentialRepository: CredentialRepository;
  readonly passwordResetTokenRepositoryFactory: (connection: Queryable) => PasswordResetTokenRepository;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
  /** Auditoria dos desfechos que não abrem transação (pedido ignorado, falha de envio). */
  readonly auditEventRepository: AuditEventRepository;
  readonly tokenGenerator: PasswordResetTokenGenerator;
  readonly delivery: PasswordResetDelivery;
  readonly ttlSeconds: number;
  /** Base pública da UI do Ingressa (ex.: `https://ingressa-dev.pctec.com.br`). */
  readonly publicBaseUrl: string;
  readonly maxRequestsPerIdentity?: number;
  readonly identityWindowSeconds?: number;
  readonly now?: () => Date;
}

/**
 * "Esqueci minha senha" — pedido de redefinição feito pelo titular, a
 * partir do e-mail. Rota PÚBLICA.
 *
 * ## A resposta não pode depender do e-mail
 *
 * Quem chama este serviço é a rota, DEPOIS de já ter respondido ao
 * navegador (ver `passwordResetRoutes`): o tempo de resposta e o corpo
 * são os mesmos exista o e-mail ou não, porque nenhum dos dois espera
 * por esta execução. O desfecho só aparece na auditoria.
 *
 * ## Quem recebe link
 *
 * Só Identity `ACTIVE`, com `login_enabled = 1` e uma `Credential
 * LOCAL_PASSWORD` ativa. Os demais casos são REGISTRADOS e ignorados:
 *
 * - **login desabilitado** — redefinir não devolveria acesso, e
 *   reabilitar login é decisão de ADMIN, com outro fluxo. Mesma regra de
 *   `ResetAdminPasswordService`. A tentativa fica na auditoria para que
 *   o ADMIN veja que a pessoa tentou;
 * - **PENDING/BLOCKED/INACTIVE** — pela mesma razão;
 * - **sem Credential** — quem nunca definiu senha está no caminho do
 *   convite de primeiro acesso, que tem elegibilidade própria.
 *
 * ## Invariantes do pedido emitido
 *
 * - token de 256 bits; só o SHA-256 é persistido;
 * - validade curta (padrão 30 min, teto 60 min no agregado);
 * - os pedidos anteriores ainda abertos são revogados NA MESMA
 *   transação: no máximo um link válido por pessoa;
 * - teto por titular (padrão 3 por hora), contado no banco — a mesma
 *   pessoa não recebe uma enxurrada de e-mails porque alguém insiste no
 *   formulário a partir de muitos IPs. Os tetos por IP e por IP+e-mail
 *   ficam no limitador HTTP, antes de qualquer consulta.
 *
 * O link é entregue DEPOIS do commit: um e-mail enviado de dentro da
 * transação seria um link que um rollback posterior tornaria inválido.
 */
export class RequestPasswordResetService {
  private readonly maxRequestsPerIdentity: number;
  private readonly identityWindowSeconds: number;
  private readonly agora: () => Date;

  public constructor(private readonly deps: RequestPasswordResetDeps) {
    this.maxRequestsPerIdentity = deps.maxRequestsPerIdentity ?? DEFAULT_MAX_PASSWORD_RESETS_PER_IDENTITY;
    this.identityWindowSeconds = deps.identityWindowSeconds ?? DEFAULT_PASSWORD_RESET_IDENTITY_WINDOW_SECONDS;
    this.agora = deps.now ?? ((): Date => new Date());
  }

  public async execute(request: RequestPasswordResetRequest): Promise<RequestPasswordResetResult> {
    const correlationId = request.correlationId ?? randomUUID();
    // Normalização idêntica à de `identities.email_normalized` e do login
    // — nunca a validação estrita de `Email.create()`: e-mail malformado
    // é só mais um e-mail que não corresponde a ninguém.
    const normalizedEmail = request.email.trim().toLowerCase();

    const identity =
      normalizedEmail.length === 0 ? undefined : await this.deps.identityRepository.findByNormalizedEmail(normalizedEmail);
    if (identity === undefined) {
      return this.ignorar(PASSWORD_RESET_FORM_AGGREGATE_PUBLIC_ID, "IGNORED_UNKNOWN_EMAIL", correlationId);
    }

    const identityPublicId = identity.getPublicId().toString();
    if (identity.getStatus().toString() !== "ACTIVE") {
      return this.ignorar(identityPublicId, "IGNORED_IDENTITY_NOT_ACTIVE", correlationId);
    }
    if (!identity.isLoginEnabled()) {
      return this.ignorar(identityPublicId, "IGNORED_LOGIN_DISABLED", correlationId);
    }
    const credential = await this.deps.credentialRepository.findByIdentityAndType(
      identityPublicId,
      CredentialType.localPassword()
    );
    if (credential === undefined || !credential.isActive()) {
      return this.ignorar(identityPublicId, "IGNORED_NO_CREDENTIAL", correlationId);
    }
    const base = this.deps.publicBaseUrl.trim().replace(/\/+$/, "");
    if (base.length === 0) {
      return this.ignorar(identityPublicId, "IGNORED_LINK_NOT_CONFIGURED", correlationId);
    }

    const rawToken = this.deps.tokenGenerator.generate();
    const emitido = await this.deps.unitOfWork.runInTransaction(async (connection) => {
      const repository = this.deps.passwordResetTokenRepositoryFactory(connection);
      const auditoria = this.deps.auditEventRepositoryFactory(connection);
      const agora = this.agora();

      const desde = new Date(agora.getTime() - this.identityWindowSeconds * 1000);
      if ((await repository.countCreatedSince(identityPublicId, desde)) >= this.maxRequestsPerIdentity) {
        await auditoria.insert(this.evento(identityPublicId, { outcome: "THROTTLED", identityPublicId }, correlationId, agora));
        return undefined;
      }

      const substituidos = await repository.revokePendingByIdentity(
        identityPublicId,
        agora,
        PASSWORD_RESET_SUPERSEDED_REASON
      );
      const token = PasswordResetToken.create({
        identityPublicId,
        tokenHash: hashPasswordResetToken(rawToken),
        ttlSeconds: this.deps.ttlSeconds,
        correlationId,
        now: agora
      });
      await repository.insert(token);
      await auditoria.insert(
        this.evento(
          identityPublicId,
          {
            outcome: "ISSUED",
            identityPublicId,
            resetRequestPublicId: token.getPublicId().toString(),
            expiresAt: token.getExpiresAt().toISOString(),
            supersededCount: substituidos
          },
          correlationId,
          agora
        )
      );
      return token;
    });

    if (emitido === undefined) {
      return { outcome: "THROTTLED", delivered: false };
    }

    try {
      await this.deps.delivery.deliver({
        fullName: identity.getFullName().toString(),
        email: identity.getEmail().toString(),
        link: `${base}${PASSWORD_RESET_PATH}#${rawToken}`,
        expiresAt: emitido.getExpiresAt()
      });
      return { outcome: "ISSUED", delivered: true };
    } catch {
      // O erro do transporte NÃO é relançado nem logado: a mensagem do
      // driver pode conter o envelope — inclusive o link. Fica o
      // registro de que falhou; a pessoa pode pedir de novo.
      await this.auditarSemFalhar(
        AuditEvent.fromDomainEvent(
          createPasswordResetDeliveryFailedEvent(
            {
              aggregatePublicId: identityPublicId,
              actorPublicId: PASSWORD_RESET_SYSTEM_ACTOR,
              correlationId,
              occurredAt: this.agora()
            },
            { resetRequestPublicId: emitido.getPublicId().toString(), identityPublicId }
          )
        )
      );
      return { outcome: "ISSUED", delivered: false };
    }
  }

  private async ignorar(
    aggregatePublicId: string,
    outcome: PasswordResetRequestOutcome,
    correlationId: string
  ): Promise<RequestPasswordResetResult> {
    const payload: PasswordResetRequestedPayload =
      aggregatePublicId === PASSWORD_RESET_FORM_AGGREGATE_PUBLIC_ID
        ? { outcome }
        : { outcome, identityPublicId: aggregatePublicId };
    await this.auditarSemFalhar(this.evento(aggregatePublicId, payload, correlationId, this.agora()));
    return { outcome, delivered: false };
  }

  private evento(
    aggregatePublicId: string,
    payload: PasswordResetRequestedPayload,
    correlationId: string,
    occurredAt: Date
  ): AuditEvent {
    return AuditEvent.fromDomainEvent(
      createPasswordResetRequestedEvent(
        // Ator SYSTEM: o pedido é anônimo. Usar o publicId do titular
        // afirmaria que FOI ele quem pediu — e qualquer pessoa pode
        // digitar o e-mail de outra no formulário.
        { aggregatePublicId, actorPublicId: PASSWORD_RESET_SYSTEM_ACTOR, correlationId, occurredAt },
        payload
      )
    );
  }

  /**
   * Auditoria de um desfecho que NÃO mudou estado. Se ela falhar, não há
   * nada a desfazer, e a resposta ao navegador já saiu — engolir é o
   * correto. O que tem estado (o pedido emitido) é auditado DENTRO da
   * transação, e lá a falha desfaz tudo.
   */
  private async auditarSemFalhar(evento: AuditEvent): Promise<void> {
    try {
      await this.deps.auditEventRepository.insert(evento);
    } catch {
      // ver comentário acima
    }
  }
}
