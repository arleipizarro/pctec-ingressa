import { DomainError } from "../../../../shared/errors/DomainError.js";

export class InvalidSupersedeReasonError extends DomainError {
  public readonly code = "IDENTITY_EXTERNAL_REFERENCE_SUPERSEDE_REASON_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(aceitos: readonly string[]) {
    super(`Motivo de supersede inválido. Valores aceitos: ${aceitos.join(", ")}.`);
  }
}

/**
 * Por que um binding deixou de valer.
 *
 * **Enum FECHADO, e não texto livre — decisão deliberada.** O motivo
 * viaja no evento de auditoria, que é append-only e fica para sempre.
 * Texto livre digitado por quem opera acabaria carregando nome, CPF,
 * matrícula ou "conversa" ("era o CPF da esposa dele") — dado pessoal
 * gravado num lugar de onde não se apaga, e que nunca precisou dele.
 * Um conjunto fechado responde a pergunta que a auditoria realmente faz
 * — que CLASSE de erro ou evento causou a troca — sem abrir essa porta.
 *
 * Os três valores cobrem as causas reais previstas:
 *
 * - `MATCH_CORRECTION` — o vínculo estava ERRADO: apontava para o
 *   registro de outra pessoa, ou para o registro errado da mesma
 *   pessoa. É o caso que motivou este lifecycle existir.
 * - `SOURCE_RECORD_REPLACED` — o vínculo estava certo, e o sistema de
 *   origem trocou o registro (recontratação com nova matrícula,
 *   migração de cadastro). Ninguém errou; a origem mudou.
 * - `IDENTITY_OFFBOARDED` — a pessoa deixou de representar aquele
 *   sujeito no sistema de origem. Não há substituição.
 *
 * Um quarto motivo é uma decisão consciente a tomar, não um campo a
 * preencher — por isso acrescentar valor aqui exige mexer no código e
 * passar por revisão.
 */
export const SUPERSEDE_REASONS = ["MATCH_CORRECTION", "SOURCE_RECORD_REPLACED", "IDENTITY_OFFBOARDED"] as const;

export type SupersedeReasonValue = (typeof SUPERSEDE_REASONS)[number];

export class SupersedeReason {
  private constructor(private readonly value: SupersedeReasonValue) {}

  public static create(raw: string): SupersedeReason {
    const normalizado = raw.trim().toUpperCase();
    const encontrado = SUPERSEDE_REASONS.find((aceito) => aceito === normalizado);
    if (encontrado === undefined) {
      throw new InvalidSupersedeReasonError(SUPERSEDE_REASONS);
    }
    return new SupersedeReason(encontrado);
  }

  public toString(): string {
    return this.value;
  }

  public equals(outro: SupersedeReason): boolean {
    return this.value === outro.value;
  }
}
