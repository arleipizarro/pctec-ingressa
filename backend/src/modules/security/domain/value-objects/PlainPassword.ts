import { DomainError } from "../../../../shared/errors/DomainError.js";

export class CredentialPasswordPolicyViolationError extends DomainError {
  public readonly code = "CREDENTIAL_PASSWORD_POLICY_VIOLATION";
  public readonly classification = "VALIDATION" as const;

  constructor(reason: string) {
    // `reason` é sempre uma descrição categórica da regra violada (ex.:
    // "comprimento mínimo"), nunca o valor da senha em si — checado por
    // teste dedicado.
    super(`Senha não cumpre a política mínima: ${reason}.`);
  }
}

/**
 * Política mínima de senha (ADR-029, "Password Policy"): comprimento +
 * blacklist de senhas comprometidas/comuns — deliberadamente SEM regras
 * de composição artificiais ("1 maiúscula, 1 símbolo, 1 número"),
 * seguindo a mesma recomendação já registrada (evidência NIST 800-63B:
 * essas regras não melhoram segurança real e incentivam padrões
 * previsíveis).
 *
 * Centralizado aqui — nenhum outro lugar do código deve reimplementar
 * essa validação.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Lista mínima de blacklist — não é uma lista de "top senhas vazadas"
 * completa (isso é Pendente de decisão de implementação, ADR-029), apenas
 * um conjunto simbólico para provar a mecânica de rejeição por
 * blacklist. Uma fonte mais completa (ex.: arquivo/dataset de senhas
 * comprometidas conhecidas) pode substituir esta lista no futuro sem
 * mudar a API deste Value Object.
 */
const BLACKLISTED_PASSWORDS = new Set(["password123456", "123456789012", "qwertyuiopas", "senhasegura123"]);

/**
 * Value Object PlainPassword.
 *
 * Usa campo verdadeiramente privado (`#value`, sintaxe nativa de classe
 * privada — não o `private` de TypeScript, que é só checagem em tempo de
 * compilação) para que a senha em texto puro nunca apareça em
 * `JSON.stringify`, `console.log` de objeto, ou qualquer reflexão em
 * runtime — apenas `revealForHashing()` a expõe, e só deve ser chamado
 * pela camada de hashing.
 */
export class PlainPassword {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  public static create(rawValue: string): PlainPassword {
    if (rawValue.length < MIN_PASSWORD_LENGTH) {
      throw new CredentialPasswordPolicyViolationError(`comprimento mínimo de ${MIN_PASSWORD_LENGTH} caracteres`);
    }
    if (BLACKLISTED_PASSWORDS.has(rawValue)) {
      throw new CredentialPasswordPolicyViolationError("senha está na lista de senhas comprometidas/comuns");
    }
    return new PlainPassword(rawValue);
  }

  /**
   * Confirma que duas senhas (a informada e a confirmação) são idênticas
   * — usado pelo CLI antes de prosseguir. Comparação simples (não
   * timing-safe): não há segredo já persistido envolvido nesta
   * comparação (as duas vêm da mesma entrada interativa do operador),
   * então um ataque de temporização não se aplica aqui.
   */
  public static createWithConfirmation(rawValue: string, confirmation: string): PlainPassword {
    if (rawValue !== confirmation) {
      throw new CredentialPasswordPolicyViolationError("confirmação de senha não corresponde à senha informada");
    }
    return PlainPassword.create(rawValue);
  }

  /**
   * Único ponto de acesso ao valor bruto — uso exclusivo da camada de
   * hashing (`Argon2PasswordHasher`). Nomeado deliberadamente de forma
   * explícita (não `toString()`/`valueOf()`) para que nenhum código
   * acidentalmente serialize ou logue o retorno achando que é outra
   * coisa.
   */
  public revealForHashing(): string {
    return this.#value;
  }
}
