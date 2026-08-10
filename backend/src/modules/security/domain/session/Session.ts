import { PublicId } from "../value-objects/PublicId.js";
import { createSessionCreatedEvent, type SessionCreatedEvent } from "./SessionDomainEvents.js";

export type SessionStatusValue = "ACTIVE" | "REVOKED";

export interface CreateSessionProps {
  readonly identityPublicId: string;
  readonly tokenHash: string;
  readonly ttlSeconds: number;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly now?: Date | undefined;
}

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface SessionPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly tokenHash: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastSeenAt?: Date | undefined;
  readonly revokedAt?: Date | undefined;
  readonly revocationReason?: string | undefined;
  readonly version: number;
}

/**
 * Aggregate Session.
 *
 * Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 11;
 * docs/adr/ADR-030-SESSAO-E-AUTENTICACAO.md;
 * docs/03-dominio/SESSION-AUTH-DESIGN.md.
 *
 * Sessão server-side opaca (ADR-030, "Session model") — status
 * persistido é só `ACTIVE`/`REVOKED`; `EXPIRED` é estado DERIVADO
 * (`status='ACTIVE' AND expiresAt <= now`), nunca um terceiro valor de
 * `status` (ver `isValid()`/`isExpired()` abaixo, e ADR-030, "Session
 * status — sem redundância").
 *
 * Nunca conhece o token bruto — recebe apenas `tokenHash` já calculado
 * pela camada de infraestrutura (`hashSessionToken`), mesmo princípio já
 * aplicado a `Credential`/`PasswordHash` (ADR-029): o domínio nunca
 * executa hashing/crypto diretamente.
 */
export class Session {
  private internalId: number | undefined;
  private readonly publicId: PublicId;
  private readonly identityPublicId: string;
  private readonly tokenHash: string;
  private status: SessionStatusValue;
  private readonly createdAt: Date;
  private readonly expiresAt: Date;
  private lastSeenAt: Date | undefined;
  private revokedAt: Date | undefined;
  private revocationReason: string | undefined;
  private version: number;

  private readonly domainEvents: SessionCreatedEvent[] = [];

  private constructor(props: {
    internalId: number | undefined;
    publicId: PublicId;
    identityPublicId: string;
    tokenHash: string;
    status: SessionStatusValue;
    createdAt: Date;
    expiresAt: Date;
    lastSeenAt: Date | undefined;
    revokedAt: Date | undefined;
    revocationReason: string | undefined;
    version: number;
  }) {
    this.internalId = props.internalId;
    this.publicId = props.publicId;
    this.identityPublicId = props.identityPublicId;
    this.tokenHash = props.tokenHash;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.expiresAt = props.expiresAt;
    this.lastSeenAt = props.lastSeenAt;
    this.revokedAt = props.revokedAt;
    this.revocationReason = props.revocationReason;
    this.version = props.version;
  }

  /**
   * Cria uma nova sessão `ACTIVE` — usada exclusivamente por
   * `CreateSessionService`, sempre após autenticação bem-sucedida.
   *
   * O evento produzido tem `actorPublicId = identityPublicId` (a própria
   * Identity autenticada) — nunca o marcador `"BOOTSTRAP"` (task, seção
   * 19, explícito: "Não usar BOOTSTRAP"). Diferente dos bootstraps de
   * Fase A/B/C, aqui existe um Actor real e autenticado: a própria
   * pessoa que acabou de provar sua senha.
   */
  public static create(props: CreateSessionProps): Session {
    const publicId = PublicId.generate();
    const now = props.now ?? new Date();
    const expiresAt = new Date(now.getTime() + props.ttlSeconds * 1000);

    const session = new Session({
      internalId: undefined,
      publicId,
      identityPublicId: props.identityPublicId,
      tokenHash: props.tokenHash,
      status: "ACTIVE",
      createdAt: now,
      expiresAt,
      lastSeenAt: undefined,
      revokedAt: undefined,
      revocationReason: undefined,
      version: 1
    });

    session.domainEvents.push(
      createSessionCreatedEvent(
        {
          aggregatePublicId: publicId.toString(),
          actorPublicId: props.identityPublicId,
          correlationId: props.correlationId,
          ...(props.causationId !== undefined ? { causationId: props.causationId } : {}),
          occurredAt: now
        },
        {
          sessionPublicId: publicId.toString(),
          identityPublicId: props.identityPublicId,
          expiresAt: expiresAt.toISOString()
        }
      )
    );

    return session;
  }

  public static reconstitute(state: SessionPersistedState): Session {
    return new Session({
      internalId: state.internalId,
      publicId: PublicId.fromString(state.publicId),
      identityPublicId: state.identityPublicId,
      tokenHash: state.tokenHash,
      status: state.status === "ACTIVE" || state.status === "REVOKED" ? state.status : "REVOKED",
      createdAt: state.createdAt,
      expiresAt: state.expiresAt,
      lastSeenAt: state.lastSeenAt,
      revokedAt: state.revokedAt,
      revocationReason: state.revocationReason,
      version: state.version
    });
  }

  public pullDomainEvents(): SessionCreatedEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;
    return events;
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

  public getStatus(): SessionStatusValue {
    return this.status;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getExpiresAt(): Date {
    return this.expiresAt;
  }

  public getLastSeenAt(): Date | undefined {
    return this.lastSeenAt;
  }

  public getRevokedAt(): Date | undefined {
    return this.revokedAt;
  }

  public getRevocationReason(): string | undefined {
    return this.revocationReason;
  }

  public getVersion(): number {
    return this.version;
  }

  /**
   * `status === 'REVOKED'` — checagem estrutural pura, nunca considera
   * `expiresAt` (ver `isExpired()`/`isValid()` para a checagem
   * temporal).
   */
  public isRevoked(): boolean {
    return this.status === "REVOKED";
  }

  /**
   * Estado DERIVADO (ADR-030, "Session status — sem redundância") —
   * nunca lido de uma coluna própria. `expiresAt <= now` é
   * "semanticamente uma sessão expirada e não autenticável", mesmo que
   * `status` continue `ACTIVE` no banco.
   */
  public isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Válida para autenticar uma requisição: `ACTIVE` estruturalmente E
   * não expirada. Combina as duas checagens — o único método que
   * middlewares/validadores futuros deveriam usar para decidir "esta
   * sessão pode ser aceita agora?".
   */
  public isValid(now: Date = new Date()): boolean {
    return this.status === "ACTIVE" && !this.isExpired(now);
  }

  /**
   * Revoga a sessão — usado pelo logout (`revocationReason = 'LOGOUT'`)
   * e, no futuro, por revogação em massa administrativa (ADR-030,
   * "Invalidação de sessão" — não implementada nesta fatia). Idempotente
   * na semântica de domínio (revogar uma sessão já revogada não é um
   * erro aqui — a checagem de "já revogada" fica a critério do chamador,
   * se necessário).
   */
  public revoke(reason: string, now: Date = new Date()): void {
    this.status = "REVOKED";
    this.revokedAt = now;
    this.revocationReason = reason;
    this.version += 1;
  }

  /** Atualiza `lastSeenAt` — reservado para validação de sessão em requisições futuras (não populado nesta fatia, que só cria sessões). */
  public touch(now: Date = new Date()): void {
    this.lastSeenAt = now;
  }

  /** Uso exclusivo da camada de infraestrutura — nunca exposto por getter público comum. */
  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
