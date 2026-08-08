import type { ApplicationAccess } from "./ApplicationAccess.js";

/**
 * Contrato de persistência de ApplicationAccess.
 *
 * Definido no domínio, implementado na infraestrutura. Nesta fatia
 * (v0.5.0), expõe somente o necessário para o guard one-shot do bootstrap
 * administrativo (ADR-028) e a inserção da primeira concessão — consultas
 * gerais (listar acessos de uma identidade, revogar, etc.) ficam para uma
 * fatia futura.
 */
export interface ApplicationAccessRepository {
  /**
   * Verifica se já existe uma `ApplicationAccess` com `status = GRANTED`
   * para a combinação exata (aplicação, perfil) — usado pelo guard
   * one-shot do bootstrap: "não existe outro ApplicationAccess ADMIN
   * ativo para PCTEC_INGRESSA" (task v0.5.0, seção 8).
   */
  existsGrantedByApplicationAndProfile(applicationPublicId: string, accessProfile: string): Promise<boolean>;

  /**
   * Verifica duplicidade para a mesma tripla (identidade, aplicação,
   * perfil) — guard adicional exigido pela seção 8: "não existe acesso
   * duplicado para a mesma Identity/aplicação/perfil".
   */
  existsGrantedByIdentityApplicationAndProfile(
    identityPublicId: string,
    applicationPublicId: string,
    accessProfile: string
  ): Promise<boolean>;

  /**
   * Insere uma ApplicationAccess nova. Após a inserção, DEVE chamar
   * `applicationAccess.assignInternalIdFromPersistence(...)` com o `id`
   * gerado pelo banco.
   */
  insert(applicationAccess: ApplicationAccess): Promise<void>;
}
