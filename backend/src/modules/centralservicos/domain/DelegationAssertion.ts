/** Tipos de ação que uma asserção pode autorizar no destinatário. */
export const ACTION_KINDS = ["ANDAMENTO_INTERNO", "RESPOSTA_PUBLICA", "RESOLUCAO"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Único destinatário suportado hoje. */
export const AUDIENCE_HELPDESK = "PCTEC_HELPDESK" as const;

export interface DelegationAssertionRecord {
  readonly id: number;
  readonly publicId: string;
  readonly tokenHash: string;
  readonly issuerApplicationPublicId: string;
  readonly audienceApplicationCode: string;
  readonly identityPublicId: string;
  readonly ticketId: number;
  readonly idempotencyKey: string;
  readonly actionKind: string;
  readonly contentSha256: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export type NewDelegationAssertion = Omit<DelegationAssertionRecord, "id" | "consumedAt">;

/**
 * Resultado da verificação, sempre em 200: é o DESTINATÁRIO que decide o
 * que fazer com cada caso. `ALREADY_USED` é distinto de `INVALID` porque
 * o destinatário legítimo precisa reconhecer o reenvio da MESMA ação que
 * ele já aplicou (resposta perdida) — ele guarda a asserção com a ação e
 * compara; um terceiro não tem o token para chegar até aqui.
 */
export type VerificationResult =
  | {
      readonly status: "VALID";
      readonly assertionPublicId: string;
      readonly identityPublicId: string;
      readonly issuerApplicationCode: string;
    }
  | { readonly status: "ALREADY_USED"; readonly assertionPublicId: string; readonly consumedAt: string }
  | { readonly status: "EXPIRED" }
  | { readonly status: "REVOKED" }
  | { readonly status: "INVALID"; readonly reason: "UNKNOWN" | "WRONG_AUDIENCE" | "BINDING_MISMATCH" };
