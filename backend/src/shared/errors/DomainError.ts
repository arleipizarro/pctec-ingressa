/**
 * Classificação de erro de domínio, conforme
 * docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md.
 *
 * `AUTHENTICATION` (v0.6.0, ADR-030) — adicionada nesta fatia, extensão
 * puramente aditiva: nenhuma classificação existente foi removida ou
 * alterada. Distinta de `AUTHORIZATION`: `AUTHENTICATION` responde "quem
 * é você? / sua prova de identidade é inválida" (401); `AUTHORIZATION`
 * responde "você está autenticado, mas não pode fazer isto" (403) — ver
 * ADR-030, "Classificação AUTHENTICATION".
 */
export type DomainErrorClassification = "VALIDATION" | "CONFLICT" | "AUTHORIZATION" | "AUTHENTICATION";

/**
 * Erro de domínio base. Todo erro lançado pelo núcleo de domínio (Aggregate
 * Roots, Value Objects, Application Services) deve estender esta classe,
 * carregando um `code` estável (destinado a tratamento programático) em vez
 * de depender de mensagens de texto livre para identificação.
 *
 * Nunca deve vazar detalhes internos de infraestrutura (mensagens de driver
 * de banco, stack traces de biblioteca, nomes de tabela/coluna) — a
 * mensagem (`message`) é sempre um texto de domínio, seguro para exibição
 * ou log em qualquer camada.
 */
export abstract class DomainError extends Error {
  public abstract readonly code: string;
  public abstract readonly classification: DomainErrorClassification;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
