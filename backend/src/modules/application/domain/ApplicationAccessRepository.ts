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
   * Verifica se já existe uma `ApplicationAccess` GRANTED para a DUPLA
   * (identidade, aplicação), **sem considerar o perfil** — v0.8.x.
   *
   * É o guard correto para a regra "um acesso ativo por identidade por
   * aplicação". O método irmão
   * `existsGrantedByIdentityApplicationAndProfile` inclui o perfil na
   * chave e, por isso, deixa passar USER + ADMIN simultâneos para a
   * mesma Identity na mesma Application — furo real fechado pela
   * migration 0017 e por este método.
   *
   * Continua sendo apenas uma checagem de conveniência: a autoridade é
   * o índice `uk_app_access_active_grant`, porque `exists()+insert()`
   * tem janela de corrida.
   */
  existsGrantedByIdentityAndApplication(identityPublicId: string, applicationPublicId: string): Promise<boolean>;

  /**
   * Insere uma ApplicationAccess nova. Após a inserção, DEVE chamar
   * `applicationAccess.assignInternalIdFromPersistence(...)` com o `id`
   * gerado pelo banco.
   */
  insert(applicationAccess: ApplicationAccess): Promise<void>;

  /**
   * Busca a `ApplicationAccess` completa (entidade, não boolean) para a
   * combinação (identidade, aplicação) — v0.6.x, Fase F. Distinto dos
   * métodos `existsGranted*` (que só confirmam existência de um acesso
   * GRANTED específico, usados no guard de bootstrap): este método
   * retorna a entidade inteira, necessária para `AuthorizeApplicationAccessService`
   * poder inspecionar `status`/`accessProfile` e decidir a causa exata
   * de uma eventual negação (mesmo que a causa não seja exposta
   * externamente — precisa existir internamente para o `reason` do
   * erro). Se a identidade tiver mais de um `ApplicationAccess` para a
   * mesma aplicação (não deveria acontecer pela regra de negócio atual,
   * mas não impedido por constraint de banco), retorna o mais
   * recentemente criado.
   */
  findByIdentityAndApplication(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<ApplicationAccess | undefined>;
}
