import type { Identity } from "../domain/Identity.js";

/**
 * Formato público de uma Identity, conforme
 * docs/02-arquitetura/API-CONTRACT-V1.md e a decisão desta fatia
 * (v0.5.0 Slice 1 — Identity Query API).
 *
 * Este é o ÚNICO lugar que decide o que sai para fora — nunca o
 * controller, nunca o repository. Campos deliberadamente EXCLUÍDOS,
 * mesmo existindo no domínio/persistência:
 *
 * - `internalId` (BIGINT interno — nunca deve deixar a infraestrutura,
 *   por design do próprio Aggregate: `getInternalIdForPersistence()` é
 *   de uso exclusivo de mapper/repository).
 * - `normalizedEmail`/`normalizedCpf` (forma de comparação interna, sem
 *   valor para um consumidor externo, e reduz superfície de fingerprint).
 * - `cpf` (dado pessoal sensível — não exposto nesta primeira API; sem
 *   decisão ainda sobre se/como será exposto no futuro).
 * - `createdByPublicId`/`updatedByPublicId`/`deletedByPublicId`/
 *   `deletionReason` (dados de auditoria interna — avaliados e
 *   deliberadamente não expostos nesta primeira versão; o contrato
 *   documental (API-CONTRACT-V1.md) não exige isso explicitamente ainda).
 * - Qualquer credencial/segredo (nunca existiu no Aggregate Identity —
 *   ADR-022 — então nem seria possível expor por engano aqui).
 */
export interface IdentityHttpResponse {
  readonly publicId: string;
  readonly type: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: string;
  readonly loginEnabled: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toIdentityHttpResponse(identity: Identity): IdentityHttpResponse {
  return {
    publicId: identity.getPublicId().toString(),
    type: identity.getType().toString(),
    fullName: identity.getFullName().toString(),
    email: identity.getEmail().toString(),
    status: identity.getStatus().toString(),
    loginEnabled: identity.isLoginEnabled(),
    version: identity.getVersion(),
    createdAt: identity.getCreatedAt().toISOString(),
    updatedAt: identity.getUpdatedAt().toISOString()
  };
}
