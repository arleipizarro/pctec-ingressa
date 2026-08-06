import type { AuditEvent } from "./AuditEvent.js";

/**
 * Contrato de persistência de AuditEvent. Somente-append: não há método
 * de atualização ou exclusão — consistente com a natureza imutável de
 * auditoria (ver docs/03-dominio/MODELO-DE-DOMINIO.md, entidade
 * AuditEvent, invariantes).
 *
 * Consulta administrativa de auditoria está fora do escopo desta fatia
 * (ver seção 12 do prompt de implementação) — por isso este contrato não
 * expõe nenhum método de leitura além do necessário para os testes.
 */
export interface AuditEventRepository {
  insert(event: AuditEvent): Promise<void>;
  insertMany(events: readonly AuditEvent[]): Promise<void>;
}
