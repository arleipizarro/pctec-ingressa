import type { Session } from "./Session.js";

/**
 * Contrato de persistência de Session.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`) — o domínio não conhece `mysql2` nem
 * qualquer detalhe de SQL. Operações mínimas para esta fatia (v0.6.0,
 * Fase D) — nenhuma consulta de listagem/revogação em massa ainda
 * (reservado para quando invalidação administrativa de sessão, ADR-030,
 * for implementada).
 */
export interface SessionRepository {
  /**
   * Insere uma Session nova. Após a inserção, DEVE chamar
   * `session.assignInternalIdFromPersistence(...)` com o `id` gerado
   * pelo banco.
   */
  insert(session: Session): Promise<void>;

  findByTokenHash(tokenHash: string): Promise<Session | undefined>;

  findByPublicId(publicId: string): Promise<Session | undefined>;
}
