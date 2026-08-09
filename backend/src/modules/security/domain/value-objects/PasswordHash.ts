import { DomainError } from "../../../../shared/errors/DomainError.js";

// Formato PHC do Argon2id: $argon2id$v=19$<params>$<salt>$<hash>
// onde <params> é uma lista separada por vírgula de pares chave=valor
// (m=memoryCost, t=timeCost, p=parallelism). Deliberadamente NÃO assume
// uma ordem fixa entre m/t/p — a biblioteca `argon2` real emite
// `m=...,p=...,t=...` (memória, paralelismo, tempo), diferente da ordem
// alfabética que uma primeira versão desta regex assumia
// incorretamente (bug real encontrado ao testar contra hashes gerados
// pela biblioteca de verdade, não apenas fixtures manuais).
const ARGON2ID_PHC_PATTERN = /^\$argon2id\$v=\d+\$(?:[a-z]+=\d+,){2}[a-z]+=\d+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;

export class InvalidPasswordHashError extends DomainError {
  public readonly code = "CREDENTIAL_PASSWORD_HASH_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    // Nunca inclui o valor recebido na mensagem — mesmo sendo um hash
    // (não a senha em si), não há razão para ecoá-lo.
    super("Hash de senha em formato inválido — esperado PHC do Argon2id.");
  }
}

/**
 * Value Object PasswordHash.
 *
 * Envolve o hash PHC completo do Argon2id (ADR-029) — nunca a senha em
 * texto puro. O salt e os parâmetros de custo já vêm embutidos na string
 * PHC (gerados e administrados pela biblioteca `argon2`), por isso não
 * existem colunas/atributos separados para eles.
 */
export class PasswordHash {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Constrói a partir de um hash já gerado pela biblioteca de hashing (ex.: `Argon2PasswordHasher`). */
  public static fromPhcString(value: string): PasswordHash {
    if (!ARGON2ID_PHC_PATTERN.test(value)) {
      throw new InvalidPasswordHashError();
    }
    return new PasswordHash(value);
  }

  /** Reconstrói a partir de um valor já persistido (mesma validação — nunca confia cegamente no banco). */
  public static fromPersistence(value: string): PasswordHash {
    return PasswordHash.fromPhcString(value);
  }

  public toString(): string {
    return this.value;
  }
}
