import { PublicId } from "../../identity/domain/value-objects/PublicId.js";

/**
 * TTL máximo do código, em segundos — teto ABSOLUTO, não um default.
 *
 * Um código de autorização é apresentado imediatamente pelo backend do
 * cliente, dentro do mesmo clique do usuário; 60 segundos é folga
 * generosa para isso. Qualquer valor maior aumentaria a janela de replay
 * sem servir a nenhum fluxo legítimo, e por isso o teto é aplicado no
 * agregado — nunca só na configuração, que alguém poderia afrouxar.
 */
export const MAX_AUTHORIZATION_CODE_TTL_SECONDS = 60;

export interface IssueAuthorizationCodeProps {
  readonly identityPublicId: string;
  readonly audienceApplicationPublicId: string;
  readonly audienceApplicationCode: string;
  readonly codeHash: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly ttlSeconds: number;
  readonly correlationId: string;
  readonly now?: Date | undefined;
}

export interface AuthorizationCodePersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly audienceApplicationPublicId: string;
  readonly codeHash: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt?: Date | undefined;
}

/**
 * Aggregate AuthorizationCode — código opaco, de uso único, do fluxo SSO
 * first-party (Authorization Code + PKCE).
 *
 * Nunca conhece o código bruto: recebe apenas `codeHash` já calculado
 * pela infraestrutura, mesmo princípio de `Session`/`tokenHash` (ADR-030)
 * e de `Credential`/`PasswordHash` (ADR-029). Não há getter que devolva
 * o código, porque não há campo — o valor em claro existe somente na
 * variável local de quem acabou de gerá-lo.
 *
 * O consumo NÃO acontece aqui. `markConsumed()` só reflete em memória um
 * consumo que o repositório já efetivou no banco por `UPDATE ... WHERE
 * consumed_at IS NULL` — a trava de uso único é a linha, não o objeto:
 * dois processos concorrentes com a mesma instância em memória não
 * teriam como se coordenar.
 */
export class AuthorizationCode {
  private internalId: number | undefined;

  private constructor(
    private readonly publicId: PublicId,
    private readonly identityPublicId: string,
    private readonly audienceApplicationPublicId: string,
    private readonly codeHash: string,
    private readonly redirectUri: string,
    private readonly codeChallenge: string,
    private readonly codeChallengeMethod: string,
    private readonly correlationId: string,
    private readonly createdAt: Date,
    private readonly expiresAt: Date,
    private consumedAt: Date | undefined,
    internalId: number | undefined
  ) {
    this.internalId = internalId;
  }

  public static issue(props: IssueAuthorizationCodeProps): AuthorizationCode {
    const now = props.now ?? new Date();
    const ttlSeconds = Math.min(props.ttlSeconds, MAX_AUTHORIZATION_CODE_TTL_SECONDS);
    return new AuthorizationCode(
      PublicId.generate(),
      props.identityPublicId,
      props.audienceApplicationPublicId,
      props.codeHash,
      props.redirectUri,
      props.codeChallenge,
      "S256",
      props.correlationId,
      now,
      new Date(now.getTime() + ttlSeconds * 1000),
      undefined,
      undefined
    );
  }

  public static reconstitute(state: AuthorizationCodePersistedState): AuthorizationCode {
    return new AuthorizationCode(
      PublicId.fromString(state.publicId),
      state.identityPublicId,
      state.audienceApplicationPublicId,
      state.codeHash,
      state.redirectUri,
      state.codeChallenge,
      state.codeChallengeMethod,
      state.correlationId,
      state.createdAt,
      state.expiresAt,
      state.consumedAt,
      state.internalId
    );
  }

  public getPublicId(): PublicId {
    return this.publicId;
  }

  public getIdentityPublicId(): string {
    return this.identityPublicId;
  }

  public getAudienceApplicationPublicId(): string {
    return this.audienceApplicationPublicId;
  }

  public getCodeHash(): string {
    return this.codeHash;
  }

  public getRedirectUri(): string {
    return this.redirectUri;
  }

  public getCodeChallenge(): string {
    return this.codeChallenge;
  }

  public getCodeChallengeMethod(): string {
    return this.codeChallengeMethod;
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

  /** Estado DERIVADO — nunca uma coluna própria (mesmo princípio de `Session.isExpired`). */
  public isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  public isConsumed(): boolean {
    return this.consumedAt !== undefined;
  }

  /** Reflete em memória um consumo JÁ efetivado atomicamente no banco. */
  public markConsumed(now: Date): void {
    this.consumedAt = now;
  }

  /**
   * Igualdade EXATA de `redirect_uri`, nunca prefixo, nunca normalização
   * de barra final: normalizar seria decidir, em nome do cliente, que
   * duas URLs diferentes são a mesma — e é exatamente aí que o open
   * redirect entra.
   */
  public matchesRedirectUri(candidate: string): boolean {
    return this.redirectUri === candidate;
  }

  public getInternalIdForPersistence(): number | undefined {
    return this.internalId;
  }

  public assignInternalIdFromPersistence(internalId: number): void {
    this.internalId = internalId;
  }
}
