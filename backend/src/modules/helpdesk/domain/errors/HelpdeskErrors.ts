import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros da fronteira service-to-service do Helpdesk
 * (`docs/import/CONTRATO-SERVICE-HELPDESK.md`).
 *
 * A distinção entre eles é o contrato inteiro desta rota, porque cada
 * status manda o Helpdesk fazer uma coisa diferente:
 *
 * - **404** — o usuário ainda não é gerenciado pelo Ingressa. O Helpdesk
 *   mantém o comportamento legado (fallback transitório).
 * - **403** — o usuário É gerenciado, e não está autorizado. O Helpdesk
 *   nega, e NUNCA cai no legado: cair no legado aqui significaria que
 *   revogar acesso no Ingressa devolve o acesso antigo.
 * - **409** — o cadastro está inconsistente ou ambíguo. Também nega, e
 *   também sem fallback: não se adivinha sobre estado que ninguém
 *   entende.
 */
export class HelpdeskIdentityNotActiveError extends DomainError {
  public readonly code = "HELPDESK_IDENTITY_NOT_ACTIVE";
  public readonly classification = "AUTHORIZATION" as const;

  constructor(status: string) {
    super(
      `identidade vinculada a este usuário do Helpdesk está ${status} — ` +
        "somente identidade ACTIVE recebe contexto."
    );
  }
}

/**
 * Referência ACTIVE existe, mas a Identity que ela aponta não.
 *
 * É 409 e não 404 de propósito: 404 diria ao Helpdesk "usuário não
 * gerenciado, siga no legado", quando na verdade ele É gerenciado e o
 * cadastro está quebrado. O fallback transformaria uma inconsistência
 * de dados em concessão de acesso.
 */
export class HelpdeskContextInconsistentError extends DomainError {
  public readonly code = "HELPDESK_CONTEXT_INCONSISTENT";
  public readonly classification = "CONFLICT" as const;

  constructor(motivo: string) {
    super(`estado cadastral inconsistente para este usuário do Helpdesk: ${motivo}.`);
  }
}

/**
 * Mais de uma referência ACTIVE para o mesmo `users.id`.
 *
 * A UNIQUE KEY `uk_id_ext_ref_active_match` torna isso impossível pelo
 * caminho normal — esta checagem existe para o caminho anormal
 * (restauração parcial de backup, escrita manual). Ambiguidade nunca
 * vira escolha: se há duas identidades candidatas, ninguém recebe
 * contexto.
 */
export class HelpdeskReferenceAmbiguousError extends DomainError {
  public readonly code = "HELPDESK_REFERENCE_AMBIGUOUS";
  public readonly classification = "CONFLICT" as const;

  constructor(quantidade: number) {
    super(
      `${quantidade} referências ACTIVE para o mesmo usuário do Helpdesk — ` +
        "nenhum contexto é resolvido enquanto a ambiguidade existir."
    );
  }
}
