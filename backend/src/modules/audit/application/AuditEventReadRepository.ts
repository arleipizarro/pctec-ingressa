/**
 * Porta de LEITURA da auditoria.
 *
 * `AuditEventRepository` (escrita) é append-only e não expõe consulta —
 * o comentário dele registra que "consulta administrativa de auditoria
 * está fora do escopo desta fatia". Esta é a fatia. São contratos
 * separados de propósito: quem grava auditoria não deve ganhar, de
 * brinde, a capacidade de varrer a tabela inteira.
 */

/** Payload já REDIGIDO. A camada de leitura nunca devolve o bruto. */
export interface RedactedPayload {
  readonly fields: Record<string, unknown>;
  /** Nomes — só os nomes — dos campos que a política atual reprovou. */
  readonly redactedFields: readonly string[];
}

export interface AuditEventView {
  readonly event_public_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly aggregate_public_id: string;
  readonly actor_public_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly occurred_at: string;
  readonly persisted_at: string;
  readonly payload: RedactedPayload;
  /**
   * Nome de quem agiu, quando o ator é uma Identity conhecida. `null`
   * para marcadores reservados (`SYSTEM`, `BOOTSTRAP`) e para atores que
   * não existem mais — nunca um nome inventado.
   */
  readonly actor_full_name: string | null;
}

export interface AuditEventFilters {
  /** Início do período, inclusivo. ISO-8601. */
  readonly from?: unknown;
  /** Fim do período, inclusivo. ISO-8601. */
  readonly to?: unknown;
  readonly eventType?: unknown;
  readonly actorPublicId?: unknown;
  /** `aggregate_public_id` — a entidade afetada. */
  readonly aggregatePublicId?: unknown;
  readonly limit?: unknown;
  readonly offset?: unknown;
}

export interface AuditEventPage {
  readonly items: readonly AuditEventView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditEventReadRepository {
  listar(filtros: AuditEventFilters): Promise<AuditEventPage>;
  /** Tipos presentes na base, para popular o filtro sem inventar opções. */
  listarTiposDeEvento(): Promise<readonly string[]>;
}
