import type { Queryable } from "../../../shared/database/Queryable.js";
import type {
  AuditEventFilters,
  AuditEventPage,
  AuditEventReadRepository,
  AuditEventView
} from "../application/AuditEventReadRepository.js";
import { redactAuditPayload } from "../application/redactAuditPayload.js";

/**
 * Teto de itens por página, imposto no SERVIDOR.
 *
 * Não é preferência de tela: `audit_events` é a tabela que mais cresce
 * na plataforma, e um `limit` vindo do cliente sem teto seria um jeito
 * de pedir a base inteira numa requisição. O cliente pode pedir menos;
 * mais do que isto não existe.
 */
const LIMITE_MAXIMO = 100;
const LIMITE_PADRAO = 25;

/** Teto do seletor de tipos — a lista alimenta um filtro, não um relatório. */
const MAXIMO_TIPOS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `actor_public_id` é VARCHAR(36): aceita UUID ou marcador reservado. */
const ATOR = /^[A-Za-z0-9_-]{1,36}$/;
/** `event_type` é um identificador fechado, ex.: `identity-invitation.created`. */
const TIPO_DE_EVENTO = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

function normalizarPaginacao(limit?: unknown, offset?: unknown): { limit: number; offset: number } {
  const bruto = Number(limit);
  const inicio = Number(offset);
  return {
    limit: Number.isInteger(bruto) && bruto > 0 ? Math.min(bruto, LIMITE_MAXIMO) : LIMITE_PADRAO,
    offset: Number.isInteger(inicio) && inicio > 0 ? inicio : 0
  };
}

/**
 * Filtro de texto só entra na consulta se casar com o formato esperado.
 * Valor fora do formato é IGNORADO, nunca interpolado — é o ponto em que
 * texto do cliente chegaria mais perto do SQL.
 */
function apenasSeCasar(valor: unknown, formato: RegExp): string | undefined {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return texto.length > 0 && formato.test(texto) ? texto : undefined;
}

/** Aceita `YYYY-MM-DD` e ISO completo. Data inválida é ignorada. */
export function normalizarInstante(valor: unknown, fimDoDia: boolean): string | undefined {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (texto.length === 0) {
    return undefined;
  }
  // `YYYY-MM-DD` sozinho seria meia-noite UTC: como filtro de FIM de
  // período, cortaria o próprio dia escolhido fora. Estender para o
  // último milissegundo é o que faz "até 26/08" incluir 26/08.
  const completo = /^\d{4}-\d{2}-\d{2}$/.test(texto)
    ? `${texto}T${fimDoDia ? "23:59:59.999" : "00:00:00.000"}Z`
    : texto;
  const instante = new Date(completo);
  return Number.isNaN(instante.getTime()) ? undefined : instante.toISOString().slice(0, 23).replace("T", " ");
}

/**
 * Projeção de LEITURA da auditoria administrativa.
 *
 * Somente SELECT, tudo parametrizado, sempre paginado e com teto.
 *
 * **`id` nunca sai daqui.** A chave interna não é exposta pelo domínio
 * (ADR-021) e não teria uso na tela; incluí-la na projeção só criaria a
 * chance de alguém passar a depender dela.
 *
 * **O payload sai redigido pela política compartilhada**, aplicada no
 * mapeamento — não há caminho nesta classe que devolva `payload_json`
 * cru.
 *
 * **`ORDER BY occurred_at DESC, id DESC`.** O desempate por `id` não é
 * decorativo: `occurred_at` é DATETIME(3), e as escritas de uma mesma
 * transação (por exemplo `identity.created` + `identity.activated` do
 * provisionamento) compartilham o mesmo milissegundo. Sem desempate
 * estável, duas páginas consecutivas poderiam repetir ou pular uma
 * linha.
 */
export class MariaDbAuditEventReadRepository implements AuditEventReadRepository {
  public constructor(private readonly connection: Queryable) {}

  public async listar(filtros: AuditEventFilters): Promise<AuditEventPage> {
    const { limit, offset } = normalizarPaginacao(filtros.limit, filtros.offset);

    const condicoes: string[] = [];
    const params: unknown[] = [];

    const de = normalizarInstante(filtros.from, false);
    if (de !== undefined) {
      condicoes.push("e.occurred_at >= ?");
      params.push(de);
    }
    const ate = normalizarInstante(filtros.to, true);
    if (ate !== undefined) {
      condicoes.push("e.occurred_at <= ?");
      params.push(ate);
    }
    const tipo = apenasSeCasar(filtros.eventType, TIPO_DE_EVENTO);
    if (tipo !== undefined) {
      condicoes.push("e.event_type = ?");
      params.push(tipo);
    }
    const ator = apenasSeCasar(filtros.actorPublicId, ATOR);
    if (ator !== undefined) {
      condicoes.push("e.actor_public_id = ?");
      params.push(ator);
    }
    const entidade = apenasSeCasar(filtros.aggregatePublicId, UUID);
    if (entidade !== undefined) {
      condicoes.push("e.aggregate_public_id = ?");
      params.push(entidade);
    }

    const onde = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

    const [linhasTotal] = await this.connection.execute(
      `SELECT COUNT(*) AS total FROM audit_events e ${onde}`,
      params
    );
    const total = Number((linhasTotal as Array<{ total: number | string }>)[0]?.total ?? 0);

    const [linhas] = await this.connection.execute(
      `SELECT e.event_public_id,
              e.event_type,
              e.event_version,
              e.aggregate_public_id,
              e.actor_public_id,
              e.correlation_id,
              e.causation_id,
              e.payload_json,
              e.occurred_at,
              e.persisted_at,
              a.full_name AS actor_full_name
         FROM audit_events e
         -- LEFT JOIN: o ator pode ser um marcador reservado (SYSTEM,
         -- BOOTSTRAP) ou uma Identity que não existe mais. Nesses casos
         -- o nome vem NULL, e a tela mostra o identificador cru em vez
         -- de inventar um nome.
         LEFT JOIN identities a ON a.public_id = e.actor_public_id
         ${onde}
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const items = (linhas as Array<Record<string, unknown>>).map(
      (linha): AuditEventView => ({
        event_public_id: String(linha["event_public_id"]),
        event_type: String(linha["event_type"]),
        event_version: Number(linha["event_version"]),
        aggregate_public_id: String(linha["aggregate_public_id"]),
        actor_public_id: String(linha["actor_public_id"]),
        correlation_id: String(linha["correlation_id"]),
        causation_id: linha["causation_id"] === null ? null : String(linha["causation_id"]),
        occurred_at: comoIso(linha["occurred_at"]),
        persisted_at: comoIso(linha["persisted_at"]),
        payload: redactAuditPayload(linha["payload_json"]),
        actor_full_name: linha["actor_full_name"] == null ? null : String(linha["actor_full_name"])
      })
    );

    return { items, total, limit, offset };
  }

  public async listarTiposDeEvento(): Promise<readonly string[]> {
    const [linhas] = await this.connection.execute(
      `SELECT DISTINCT event_type FROM audit_events ORDER BY event_type LIMIT ${MAXIMO_TIPOS}`
    );
    return (linhas as Array<{ event_type: string }>).map((linha) => String(linha.event_type));
  }
}

function comoIso(valor: unknown): string {
  if (valor instanceof Date) {
    return valor.toISOString();
  }
  const texto = String(valor ?? "");
  const instante = new Date(texto.includes("T") ? texto : texto.replace(" ", "T") + "Z");
  return Number.isNaN(instante.getTime()) ? texto : instante.toISOString();
}
