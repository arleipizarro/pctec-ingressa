import { PublicId } from "../../identity/domain/value-objects/PublicId.js";

export type PasswordResetTokenStatusValue = "PENDING" | "CONSUMED" | "REVOKED";

/** Validade padrão: 30 minutos (configurável por `PASSWORD_RESET_TTL_SECONDS`). */
export const DEFAULT_PASSWORD_RESET_TTL_SECONDS = 1_800;

/**
 * Teto de validade — 60 minutos. Diferente do convite (7 dias), este
 * link troca a senha de uma conta que JÁ existe e já tem acesso: quem o
 * encontrar numa caixa de e-mail esquecida entra no lugar do titular.
 * O teto vive no agregado, não só na configuração.
 */
export const MAX_PASSWORD_RESET_TTL_SECONDS = 3_600;

/** Motivo gravado quando um pedido novo revoga os anteriores da mesma Identity. */
export const PASSWORD_RESET_SUPERSEDED_REASON = "SUPERSEDED" as const;

export interface CreatePasswordResetTokenProps {
  readonly identityPublicId: string;
  readonly tokenHash: string;
  readonly ttlSeconds: number;
  readonly correlationId: string;
  readonly now?: Date | undefined;
}

export interface PasswordResetTokenPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly tokenHash: string;
  readonly status: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt?: Date | undefined;
  readonly revokedAt?: Date | undefined;
  readonly revocationReason?: string | undefined;
}

/**
 * Aggregate PasswordResetToken — pedido de redefinição de senha feito
 * pelo próprio titular ("Esqueci minha senha").
 *
 * Mesmo desenho de `Invitation`: nunca conhece o token bruto (só
 * `tokenHash`), e `EXPIRED` não é status — é `expires_at <= now`,
 * derivado (ADR-030). Um pedido expirado continua `PENDING` no banco e
 * simplesmente não é consumível.
 */
export class PasswordResetToken {
  private internalId: number | undefined;

  private constructor(
    private readonly publicId: PublicId,
    private readonly identityPublicId: string,
    private readonly tokenHash: string,
    private status: PasswordResetTokenStatusValue,
    private readonly correlationId: string,
    private readonly createdAt: Date,
    private readonly expiresAt: Date,
    private consumedAt: Date | undefined,
    private revokedAt: Date | undefined,
    private revocationReason: string | undefined,
    internalId: number | undefined
  ) {
    this.internalId = internalId;
  }

  public static create(props: CreatePasswordResetTokenProps): PasswordResetToken {
    const now = props.now ?? new Date();
    const ttlSeconds = Math.min(Math.max(props.ttlSeconds, 1), MAX_PASSWORD_RESET_TTL_SECONDS);
    return new PasswordResetToken(
      PublicId.generate(),
      props.identityPublicId,
      props.tokenHash,
      "PENDING",
      props.correlationId,
      now,
      new Date(now.getTime() + ttlSeconds * 1000),
      undefined,
      undefined,
      undefined,
      undefined
    );
  }

  public static reconstitute(state: PasswordResetTokenPersistedState): PasswordResetToken {
    // Valor desconhecido vindo do banco vira REVOKED — nunca PENDING:
    // na dúvida, o link não abre nada.
    const status: PasswordResetTokenStatusValue =
      state.status === "PENDING" || state.status === "CONSUMED" || state.status === "REVOKED"
        ? state.status
        : "REVOKED";
    return new PasswordResetToken(
      PublicId.fromString(state.publicId),
      state.identityPublicId,
      state.tokenHash,
      status,
      state.correlationId,
      state.createdAt,
      state.expiresAt,
      state.consumedAt,
      state.revokedAt,
      state.revocationReason,
      state.internalId
    );
  }

  public getPublicId(): PublicId {
    return this.publicId;
  }

  public getIdentityPublicId(): string {
    return this.identityPublicId;
  }

  public getTokenHash(): string {
    return this.tokenHash;
  }

  public getStatus(): PasswordResetTokenStatusValue {
    return this.status;
  }

  public getCorrelationId(): string {
    return this.correlationId;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getExpiresAt(): Date {
    return this.expiresAt;
  }

  public getConsumedAt(): Date | undefined {
    return this.consumedAt;
  }

  public getRevokedAt(): Date | undefined {
    return this.revokedAt;
  }

  public getRevocationReason(): string | undefined {
    return this.revocationReason;
  }

  public isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  public isUsable(now: Date = new Date()): boolean {
    return this.status === "PENDING" && !this.isExpired(now);
  }

  /** Reflete em memória um consumo JÁ efetivado atomicamente no banco. */
  public markConsumed(now: Date): void {
    this.status = "CONSUMED";
    this.consumedAt = now;
  }

  public markRevoked(now: Date, reason: string): void {
    this.status = "REVOKED";
    this.revokedAt = now;
    this.revocationReason = reason;
  }

  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
