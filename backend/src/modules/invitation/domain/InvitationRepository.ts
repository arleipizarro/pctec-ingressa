import type { Invitation } from "./Invitation.js";

export interface InvitationRepository {
  insert(invitation: Invitation): Promise<void>;

  /**
   * Revoga TODOS os convites ainda `PENDING` de uma Identity e devolve os
   * que de fato mudaram de estado (para auditoria).
   *
   * Chamado dentro da MESMA transação que cria o convite novo: é assim
   * que "revogar convites anteriores ainda ativos" vira invariante e não
   * um efeito colateral que pode falhar sozinho.
   */
  revokePendingByIdentity(
    identityPublicId: string,
    now: Date,
    reason: string
  ): Promise<readonly Invitation[]>;

  /**
   * Leitura sem efeito: o convite ainda é utilizável AGORA?
   *
   * Existe para a tela de definição de senha poder se apresentar antes
   * de o usuário digitar qualquer coisa. Deliberadamente NÃO consome —
   * abrir o link não pode gastar o convite, senão recarregar a página
   * invalidaria o acesso de quem tem direito a ele.
   */
  findUsableByTokenHash(tokenHash: string, now: Date): Promise<Invitation | undefined>;

  /**
   * CONSUMO ATÔMICO — `UPDATE ... WHERE status = 'PENDING' AND
   * consumed_at IS NULL AND expires_at > ?`, e só então lê.
   *
   * Mesma razão de `AuthorizationCodeRepository.consumeByCodeHash`: um
   * `SELECT` seguido de `UPDATE` deixaria duas requisições simultâneas
   * com o mesmo token passarem pela validação — e o segundo consumo
   * criaria uma segunda Credential.
   */
  consumeByTokenHash(tokenHash: string, now: Date): Promise<Invitation | undefined>;

  /**
   * Revoga UM convite pendente, identificado pelo `publicId`.
   *
   * `undefined` quando não havia nada pendente para revogar — o chamador
   * transforma isso em conflito explícito, em vez de responder "ok" a
   * uma operação que não mudou estado. A condição `status = 'PENDING'`
   * dentro do `UPDATE` também fecha a corrida entre dois administradores
   * clicando ao mesmo tempo.
   */
  revokeByPublicId(publicId: string, now: Date, reason: string): Promise<Invitation | undefined>;
}
