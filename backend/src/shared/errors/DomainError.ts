/**
 * Classificação de erro de domínio, conforme
 * docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md.
 */
export type DomainErrorClassification = "VALIDATION" | "CONFLICT" | "AUTHORIZATION";

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
