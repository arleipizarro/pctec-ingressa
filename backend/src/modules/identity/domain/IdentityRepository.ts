import type { Identity } from "./Identity.js";
import type { PublicId } from "./value-objects/PublicId.js";

/**
 * Contrato de persistência de Identity.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`) — o domínio não conhece `mysql2` nem
 * qualquer detalhe de SQL.
 */
export interface IdentityRepository {
  findByPublicId(publicId: PublicId): Promise<Identity | undefined>;

  /**
   * Busca a Identity completa por e-mail normalizado — usado
   * exclusivamente pelo lookup de autenticação (v0.6.0, Fase D,
   * ADR-030, `AuthenticateIdentityService`). Extensão mínima ao
   * contrato: distinto de `existsByNormalizedEmail` (que só confirma
   * existência, usado na criação de Identity), este método retorna a
   * entidade completa, necessária para checar `status`/`loginEnabled`
   * no fluxo de login.
   */
  findByNormalizedEmail(normalizedEmail: string): Promise<Identity | undefined>;

  existsByNormalizedEmail(normalizedEmail: string): Promise<boolean>;

  existsByNormalizedCpf(normalizedCpf: string): Promise<boolean>;

  /**
   * Conta o total de linhas em `identities` — usado exclusivamente pelo
   * guard one-shot do bootstrap (v0.5.0, ADR-027): `count = 0` é a
   * condição necessária para permitir a criação da Identity fundacional.
   * Leitura pura, nunca escreve.
   */
  countAll(): Promise<number>;

  /**
   * Insere uma Identity nova. Após a inserção, DEVE chamar
   * `identity.assignInternalIdFromPersistence(...)` com o `id` gerado
   * pelo banco, para que a instância em memória reflita a chave interna
   * atribuída.
   */
  insert(identity: Identity): Promise<void>;

  /**
   * Atualiza uma Identity existente, aplicando optimistic locking: o
   * UPDATE deve incluir `WHERE version = :expectedVersion` (a versão que
   * a instância tinha antes da mutação em memória). Se nenhuma linha for
   * afetada, a implementação deve lançar `IdentityVersionConflictError`.
   */
  update(identity: Identity, expectedVersion: number): Promise<void>;

  /**
   * Remove FISICAMENTE a linha, com trava otimista.
   *
   * Existe para um caso estreito: Identity PENDING que nunca foi usada
   * (sem credencial, vínculo, membership, acesso ou sessão) e que só
   * polui a operação — tipicamente resíduo de teste. Exclusão lógica não
   * serve aqui: a linha continuaria na base e na tela.
   *
   * O `WHERE version = ?` é a trava real: se alguém tocou na identidade
   * entre a checagem das pré-condições e o DELETE, nada casa e a
   * operação falha em vez de apagar um estado que ninguém revisou.
   *
   * Opcional no contrato para não obrigar todo test double existente.
   */
  deleteByPublicId?(publicId: PublicId, expectedVersion: number): Promise<number>;
}
