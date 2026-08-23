import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio de `Membership`, conforme ADR-031 e
 * ORGANIZATION-MEMBERSHIP-DESIGN.md §4 — G2, v0.6.x.
 */

export class MembershipIdentityNotFoundError extends DomainError {
  public readonly code = "IDENTITY_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identityPublicId: string) {
    super(`Identity não encontrada: ${identityPublicId}.`);
  }
}

export class MembershipOrganizationNotFoundError extends DomainError {
  public readonly code = "ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(organizationPublicId: string) {
    super(`Organization não encontrada: ${organizationPublicId}.`);
  }
}

/**
 * A Organization referenciada existe, mas está `INACTIVE` — Membership
 * só pode ser criado sobre uma Organization utilizável (seção 16 do
 * prompt de implementação G2).
 */
export class MembershipOrganizationNotActiveError extends DomainError {
  public readonly code = "MEMBERSHIP_ORGANIZATION_NOT_ACTIVE";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("A Organization referenciada não está ACTIVE — não é possível criar Membership.");
  }
}

/**
 * `uk_membership_unique (identity_public_id, organization_public_id,
 * profile)` — vínculo com a MESMA classificação já existe para este par
 * Identity/Organization, independente de status (ver nota na migration
 * 0012 sobre revogar+recriar, gap registrado, fora de escopo G2).
 */
export class MembershipAlreadyExistsError extends DomainError {
  public readonly code = "MEMBERSHIP_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe um Membership com esta mesma classificação (identity + organization + profile).");
  }
}

/**
 * Encerrar um Membership que já está `INACTIVE` — P1D.1.
 *
 * **Deliberadamente um erro, não um no-op silencioso.** Um operador que
 * roda a revogação duas vezes precisa saber que a segunda não fez nada;
 * tratar como sucesso esconderia o caso real de "revoguei o vínculo
 * errado e o certo continua ativo". `CONFLICT` (409) é a classificação
 * correta: o comando é válido, o estado atual é que não o comporta —
 * mesmo padrão de `MEMBERSHIP_ALREADY_EXISTS`.
 */
export class MembershipAlreadyEndedError extends DomainError {
  public readonly code = "MEMBERSHIP_ALREADY_ENDED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Este Membership já está encerrado.");
  }
}

/** Membership inexistente para o `publicId` informado — P1D.1. */
export class MembershipNotFoundError extends DomainError {
  public readonly code = "MEMBERSHIP_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`Membership não encontrado para publicId=${publicId}.`);
  }
}

/**
 * Conflito de versão ao persistir o encerramento — P1D.1.
 *
 * Mesmo mecanismo de optimistic locking já usado por `Identity`: o
 * `UPDATE` é condicionado à `version` lida, e zero linhas afetadas
 * significam que alguém alterou o mesmo Membership no meio do caminho.
 * Falhar é obrigatório — sobrescrever apagaria a alteração concorrente.
 */
export class MembershipVersionConflictError extends DomainError {
  public readonly code = "MEMBERSHIP_VERSION_CONFLICT";
  public readonly classification = "CONFLICT" as const;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Conflito de versão ao atualizar Membership (esperada=${expectedVersion}, tentada=${actualVersion}). ` +
        "O vínculo foi alterado por outra operação — releia e tente novamente."
    );
  }
}

/**
 * Motivo de encerramento ausente ou só espaços — P1D.1.
 *
 * Uma revogação sem motivo registrado é uma revogação que ninguém
 * consegue explicar depois. O texto vai para `membership.updated` e daí
 * para `audit_events`; exigi-lo é barato e a alternativa é uma trilha
 * de auditoria inútil.
 */
export class InvalidMembershipEndReasonError extends DomainError {
  public readonly code = "MEMBERSHIP_END_REASON_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("O motivo do encerramento do Membership é obrigatório.");
  }
}
