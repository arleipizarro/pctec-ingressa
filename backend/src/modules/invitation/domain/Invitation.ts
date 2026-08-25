import { PublicId } from "../../identity/domain/value-objects/PublicId.js";

export type InvitationStatusValue = "PENDING" | "CONSUMED" | "REVOKED";
export type InvitationDeliveryMode = "MANUAL_DEV" | "EMAIL";

/** Validade padrão: 24 horas (configurável por `INVITATION_TTL_SECONDS`). */
export const DEFAULT_INVITATION_TTL_SECONDS = 86_400;

/**
 * Teto de validade — 7 dias. Um convite é um caminho para criar
 * credencial sem senha anterior; quanto mais tempo ele fica de pé, mais
 * tempo alguém tem para achar o link numa caixa de e-mail abandonada.
 * O teto vive no agregado, não só na configuração.
 */
export const MAX_INVITATION_TTL_SECONDS = 604_800;

export interface CreateInvitationProps {
  readonly identityPublicId: string;
  readonly tokenHash: string;
  readonly invitedByPublicId: string;
  readonly deliveryMode: InvitationDeliveryMode;
  readonly ttlSeconds: number;
  readonly correlationId: string;
  readonly now?: Date | undefined;
}

export interface InvitationPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly tokenHash: string;
  readonly status: string;
  readonly deliveryMode: string;
  readonly invitedByPublicId: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt?: Date | undefined;
  readonly revokedAt?: Date | undefined;
  readonly revocationReason?: string | undefined;
}

/**
 * Aggregate Invitation — convite administrativo de primeiro acesso.
 *
 * Nunca conhece o token bruto (só `tokenHash`), mesmo princípio de
 * `Session`, `Credential` e `AuthorizationCode`. Não existe getter que
 * devolva o token porque não existe campo: o valor em claro só vive na
 * variável local de quem o gerou e no link entregue uma única vez.
 *
 * `EXPIRED` não é status: é `expires_at <= now`, derivado — mesma
 * decisão de `Session` (ADR-030). Um convite expirado continua `PENDING`
 * no banco e simplesmente não é consumível.
 */
export class Invitation {
  private internalId: number | undefined;

  private constructor(
    private readonly publicId: PublicId,
    private readonly identityPublicId: string,
    private readonly tokenHash: string,
    private status: InvitationStatusValue,
    private readonly deliveryMode: InvitationDeliveryMode,
    private readonly invitedByPublicId: string,
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

  public static create(props: CreateInvitationProps): Invitation {
    const now = props.now ?? new Date();
    const ttlSeconds = Math.min(Math.max(props.ttlSeconds, 1), MAX_INVITATION_TTL_SECONDS);
    return new Invitation(
      PublicId.generate(),
      props.identityPublicId,
      props.tokenHash,
      "PENDING",
      props.deliveryMode,
      props.invitedByPublicId,
      props.correlationId,
      now,
      new Date(now.getTime() + ttlSeconds * 1000),
      undefined,
      undefined,
      undefined,
      undefined
    );
  }

  public static reconstitute(state: InvitationPersistedState): Invitation {
    const status: InvitationStatusValue =
      state.status === "PENDING" || state.status === "CONSUMED" || state.status === "REVOKED"
        ? state.status
        : "REVOKED";
    const deliveryMode: InvitationDeliveryMode = state.deliveryMode === "EMAIL" ? "EMAIL" : "MANUAL_DEV";
    return new Invitation(
      PublicId.fromString(state.publicId),
      state.identityPublicId,
      state.tokenHash,
      status,
      deliveryMode,
      state.invitedByPublicId,
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

  public getStatus(): InvitationStatusValue {
    return this.status;
  }

  public getDeliveryMode(): InvitationDeliveryMode {
    return this.deliveryMode;
  }

  public getInvitedByPublicId(): string {
    return this.invitedByPublicId;
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
