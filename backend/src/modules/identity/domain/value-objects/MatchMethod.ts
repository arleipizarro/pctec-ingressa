import { DomainError } from "../../../../shared/errors/DomainError.js";

export type MatchMethodValue = "MATCHED_BY_EMAIL" | "MATCHED_MANUAL_CONFIRMED" | "CREATED_FROM_SOURCE";

const VALID_MATCH_METHODS: readonly MatchMethodValue[] = [
  "MATCHED_BY_EMAIL",
  "MATCHED_MANUAL_CONFIRMED",
  "CREATED_FROM_SOURCE"
];

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
 * Como o vínculo Identity ↔ sistema legado foi estabelecido. Enum
 * fechado a exatamente 3 valores:
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
 * - `CREATED_FROM_SOURCE` (v0.8.x): a Identity foi CRIADA a partir do
 *   registro de origem, no mesmo lote que gravou esta referência. Não
 *   houve Identity anterior e, portanto, não houve correspondência.
 *
 *   Existe porque os dois valores acima AFIRMAM que havia uma Identity
 *   preexistente reconhecida. Um importador que cria a Identity não tem
 *   nenhum dos dois: usar `MATCHED_BY_EMAIL` ali gravaria uma afirmação
 *   falsa na trilha de auditoria — "encontrei alguém com este e-mail"
 *   quando não havia ninguém.
 *
 *   Regra de decisão do importador (v0.8.x):
 *     referência já existe               -> idempotência (SKIP/UPDATE)
 *     e-mail casa com Identity existente -> QUARENTENA, nunca automático
 *     sem Identity para aquele e-mail    -> cria + CREATED_FROM_SOURCE
 *     humano confirmou a associação      -> MATCHED_MANUAL_CONFIRMED
 *     nome igual                         -> NUNCA. Não é critério.
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
