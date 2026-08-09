import type { Credential } from "./Credential.js";
import type { CredentialType } from "./value-objects/CredentialType.js";

/**
 * Contrato de persistência de Credential.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`) — o domínio não conhece `mysql2` nem
 * qualquer detalhe de SQL. Operações mínimas para esta fatia (task
 * v0.5.x, seção 16) — auth lookup (por e-mail/Identity) não implementado
 * ainda, não necessário para o bootstrap.
 */
export interface CredentialRepository {
  /**
   * Insere uma Credential nova. Após a inserção, DEVE chamar
   * `credential.assignInternalIdFromPersistence(...)` com o `id` gerado
   * pelo banco.
   */
  insert(credential: Credential): Promise<void>;

  findByIdentityAndType(identityPublicId: string, type: CredentialType): Promise<Credential | undefined>;

  /**
   * Verifica se já existe QUALQUER Credential do tipo informado em toda a
   * plataforma, de qualquer Identity — usado pelo guard GLOBAL one-shot
   * do bootstrap (ADR-029, "Escopo exato do bootstrap"). Não é por
   * identidade.
   */
  existsAnyByType(type: CredentialType): Promise<boolean>;
}
