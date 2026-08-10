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

  /**
   * Atualiza uma Session existente, aplicando optimistic locking:
   * `WHERE version = expectedVersion` (a versão que a instância tinha
   * ANTES da mutação em memória) — `SET version` recebe o valor
   * absoluto final (`session.getVersion()`), mesmo padrão já corrigido
   * em `MariaDbIdentityRepository.update()`/`MariaDbCredentialRepository.update()`.
   * Se nenhuma linha for afetada, a implementação deve lançar
   * `SessionVersionConflictError`. Uso desta fatia (v0.6.x, Fase E):
   * exclusivamente para persistir `revoke()` (logout).
   */
  update(session: Session, expectedVersion: number): Promise<void>;
}
