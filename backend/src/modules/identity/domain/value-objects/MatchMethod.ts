import { DomainError } from "../../../../shared/errors/DomainError.js";

export type MatchMethodValue = "MATCHED_BY_EMAIL" | "MATCHED_MANUAL_CONFIRMED";

const VALID_MATCH_METHODS: readonly MatchMethodValue[] = ["MATCHED_BY_EMAIL", "MATCHED_MANUAL_CONFIRMED"];

export class InvalidMatchMethodError extends DomainError {
  public readonly code = "MATCH_METHOD_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`matchMethod inválido. Valores aceitos: ${VALID_MATCH_METHODS.join(", ")}.`);
  }
}

/**
 * Value Object MatchMethod.
 *
 * Como o vínculo Identity ↔ sistema legado foi confirmado. Enum fechado
 * a exatamente 2 valores:
 *
 * - `MATCHED_BY_EMAIL`: o vínculo foi inferido e confirmado por e-mail
 *   coincidente entre a Identity do Ingressa e o registro legado. Só
 *   válido quando há exatamente 1 Identity com aquele e-mail (caso
 *   MATCHED sem ambiguidade).
 *
 * - `MATCHED_MANUAL_CONFIRMED`: o vínculo foi confirmado manualmente
 *   pelo operador (ex.: caso arlei.pizarro@pctec.com.br / portal_acesso
 *   id=33 com arlei@pizarros.com.br — e-mails diferentes, mesma pessoa,
 *   confirmado pelo PO).
 *
 * **Valores NÃO persistidos** (resultados do processo de bootstrap, não
 * estados de uma referência já gravada): UNMATCHED (nenhuma Identity com
 * aquele e-mail), AMBIGUOUS (mais de uma Identity candidata),
 * INVALID_EMAIL (e-mail do sistema legado não é válido). Esses resultados
 * são devolvidos pelo processo de bootstrap (Fatia 3) mas nunca inseridos
 * nesta tabela — só referências já confirmadas são persistidas.
 *
 * **Quem decide é sempre o chamador** (CLI, Fatia 3) — nunca inferido
 * automaticamente pelo `CreateIdentityExternalReferenceService`.
 */
export class MatchMethod {
  private readonly value: MatchMethodValue;

  private constructor(value: MatchMethodValue) {
    this.value = value;
  }

  public static create(rawValue: string): MatchMethod {
    if (!VALID_MATCH_METHODS.includes(rawValue as MatchMethodValue)) {
      throw new InvalidMatchMethodError();
    }
    return new MatchMethod(rawValue as MatchMethodValue);
  }

  public toString(): MatchMethodValue {
    return this.value;
  }

  public equals(other: MatchMethod): boolean {
    return this.value === other.value;
  }
}
