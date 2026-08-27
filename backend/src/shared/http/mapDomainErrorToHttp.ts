import { DomainError, type DomainErrorClassification } from "../errors/DomainError.js";

export interface HttpErrorMapping {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Mapeamento HTTP para `DomainError`, conforme
 * docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md ("HTTP conceitual").
 *
 * GAP DE CATÁLOGO ENCONTRADO NESTA FATIA (v0.5.0): `IDENTITY_PUBLIC_ID_INVALID`
 * (lançado por `PublicId.fromString`, já existente em código desde a
 * v0.4.0) NÃO está na tabela de `IDENTITY-DOMAIN-ERRORS.md`. Não inventei
 * um código novo — o código já existe. Apliquei o mesmo padrão já
 * documentado para todo erro de classificação "Validação" de
 * formato/forma (`IDENTITY_EMAIL_INVALID`, `IDENTITY_NAME_INVALID`,
 * `IDENTITY_CPF_INVALID` etc. — todos 422 na tabela), em vez de inventar
 * uma regra nova. Recomendo formalmente adicionar esta linha ao catálogo
 * documental — ver relatório desta entrega.
 *
 * `IDENTITY_NOT_FOUND` é a única classificação "Validação" com HTTP
 * diferente de 422 no catálogo documentado (404, por ser semanticamente
 * "recurso inexistente") — por isso o mapeamento não pode se basear
 * apenas em `classification`; precisa de um override explícito por
 * `code` primeiro, com a classificação como fallback genérico.
 */
const HTTP_STATUS_OVERRIDE_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  IDENTITY_NOT_FOUND: 404,
  IDENTITY_PUBLIC_ID_INVALID: 422,
  // P1 Portal (v0.7.x): mesmo padrão de IDENTITY_NOT_FOUND — a
  // Organization já foi confirmada autorizada por
  // requireOrganizationAccess (403 próprio, ORGANIZATION_ACCESS_DENIED)
  // antes deste erro ser sequer possível; aqui é genuinamente "recurso
  // (mapeamento legado) inexistente", não falta de autorização.
  ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND: 404,
  // P1B.0 Fatia 4 (v0.7.x): mesmo padrão. Rota service-to-service
  // /api/v1/service/portal/identity-external-references/... resolvendo
  // portal_acesso.id → Identity.publicId — se não há referência ACTIVE
  // para essa chave legada, o mapeamento ainda não foi cadastrado via
  // CLI (bootstrap-identity-external-reference, Fatia 3). "Recurso
  // inexistente" semanticamente, não falta de autorização.
  IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND: 404,
  // v1.0 (production readiness): falha TRANSITÓRIA do canal de e-mail.
  // 503 e não 422 porque nada no pedido do ADMIN está errado — o convite
  // foi criado, só a entrega não completou. 503 é o único status que diz
  // à UI "repita a mesma operação", que é exatamente a ação correta.
  // Distinto de INVITATION_DELIVERY_NOT_CONFIGURED (422), que pede
  // intervenção de quem opera o servidor, não uma nova tentativa.
  INVITATION_DELIVERY_FAILED: 503
});

const HTTP_STATUS_BY_CLASSIFICATION: Readonly<Record<DomainErrorClassification, number>> = Object.freeze({
  VALIDATION: 422,
  CONFLICT: 409,
  AUTHORIZATION: 403,
  // v0.6.0, ADR-030: AUTHENTICATION_FAILED/SESSION_NOT_FOUND/
  // SESSION_EXPIRED/SESSION_REVOKED — nunca mapeados como VALIDATION.
  AUTHENTICATION: 401
});

export function mapDomainErrorToHttp(error: DomainError): HttpErrorMapping {
  const status = HTTP_STATUS_OVERRIDE_BY_CODE[error.code] ?? HTTP_STATUS_BY_CLASSIFICATION[error.classification];
  return { status, code: error.code, message: error.message };
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
