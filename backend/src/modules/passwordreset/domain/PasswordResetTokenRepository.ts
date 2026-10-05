import type { PasswordResetToken } from "./PasswordResetToken.js";

export interface PasswordResetTokenRepository {
  insert(token: PasswordResetToken): Promise<void>;

  /**
   * Revoga TODOS os pedidos ainda `PENDING` de uma Identity e devolve
   * quantos mudaram de estado.
   *
   * Chamado dentro da MESMA transação que cria o pedido novo — e também
   * na conclusão de uma troca: "invalidar tokens anteriores ainda
   * abertos" é invariante, não efeito colateral que pode falhar sozinho.
   * Dois links válidos ao mesmo tempo significariam que o titular não
   * tem como saber qual deles alguém mais pode ter.
   */
  revokePendingByIdentity(identityPublicId: string, now: Date, reason: string): Promise<number>;

  /**
   * Quantos pedidos esta Identity abriu desde `since` — base do teto por
   * titular, contra o formulário virar um jeito de encher a caixa de
   * e-mail de alguém. Conta qualquer status: um pedido revogado também
   * foi um e-mail enviado.
   */
  countCreatedSince(identityPublicId: string, since: Date): Promise<number>;

  /**
   * Leitura sem efeito: o link ainda é utilizável AGORA?
   *
   * Existe para a tela de nova senha poder dizer "link expirado" ANTES
   * de a pessoa digitar qualquer coisa. Deliberadamente NÃO consome —
   * abrir o link (ou recarregar a página) não pode gastá-lo.
   */
  findUsableByTokenHash(tokenHash: string, now: Date): Promise<PasswordResetToken | undefined>;

  /**
   * CONSUMO ATÔMICO — `UPDATE ... WHERE status = 'PENDING' AND
   * consumed_at IS NULL AND expires_at > ?`, e só então lê.
   *
   * Mesma razão de `InvitationRepository.consumeByTokenHash`: `SELECT`
   * seguido de `UPDATE` deixaria duas requisições simultâneas com o
   * mesmo token passarem pela validação. Só uma vence o `UPDATE`.
   */
  consumeByTokenHash(tokenHash: string, now: Date): Promise<PasswordResetToken | undefined>;
}
