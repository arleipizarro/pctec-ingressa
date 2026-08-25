import type { Queryable } from "../../../../shared/database/Queryable.js";

/**
 * Projeções de LEITURA da interface administrativa.
 *
 * Somente SELECT. Não replica regra de domínio: quem decide "pode
 * conceder?", "pode revogar?", "quem enxerga o quê" continua sendo o
 * Application Service correspondente. Aqui só se responde "o que existe
 * hoje", que é pergunta de tela — montar isso a partir de agregados
 * carregados um a um custaria N+1 consultas para exibir uma tabela.
 *
 * Toda consulta é parametrizada, paginada e com limite máximo — uma
 * tela nunca pede a base inteira, e um cliente malicioso não consegue
 * pedir.
 */
const LIMITE_MAXIMO = 100;
const LIMITE_PADRAO = 25;

export function normalizarPaginacao(limit?: unknown, offset?: unknown): { limit: number; offset: number } {
  const bruto = Number(limit);
  const inicio = Number(offset);
  return {
    limit: Number.isInteger(bruto) && bruto > 0 ? Math.min(bruto, LIMITE_MAXIMO) : LIMITE_PADRAO,
    offset: Number.isInteger(inicio) && inicio > 0 ? inicio : 0
  };
}

const STATUS_IDENTIDADE = ["PENDING", "ACTIVE", "BLOCKED", "INACTIVE", "DELETED"];
const TIPOS_ORGANIZACAO = ["BUSINESS_GROUP", "COMPANY"];
const STATUS_ORGANIZACAO = ["ACTIVE", "INACTIVE"];
const ACOES_IMPORTACAO = ["CREATE", "UPDATE", "SKIP", "CONFLICT", "QUARANTINE"];

/**
 * Filtro só entra na consulta se pertencer a um conjunto fechado.
 * Valor fora da lista é IGNORADO, nunca interpolado — o filtro é o
 * ponto onde texto do cliente chegaria mais perto do SQL.
 */
function apenasSeConhecido(valor: unknown, permitidos: readonly string[]): string | undefined {
  const texto = typeof valor === "string" ? valor.toUpperCase() : "";
  return permitidos.includes(texto) ? texto : undefined;
}

export interface PaginaAdmin<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export class MariaDbAdminReadRepository {
  public constructor(private readonly connection: Queryable) {}

  private async select<T>(sql: string, params: readonly unknown[] = []): Promise<readonly T[]> {
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }

  private async contar(sql: string, params: readonly unknown[] = []): Promise<number> {
    const linhas = await this.select<{ total: number | string }>(sql, params);
    return Number(linhas[0]?.total ?? 0);
  }

  /** Painel: só números agregados, nunca dado pessoal. */
  public async resumo(): Promise<Record<string, unknown>> {
    const identidades = await this.select<{ status: string; total: number | string }>(
      "SELECT status, COUNT(*) AS total FROM identities GROUP BY status ORDER BY status"
    );
    const organizacoes = await this.select<{ type: string; status: string; total: number | string }>(
      "SELECT type, status, COUNT(*) AS total FROM organizations GROUP BY type, status ORDER BY type, status"
    );
    const acessos = await this.select<{ code: string; access_profile: string; total: number | string }>(
      `SELECT a.code, aa.access_profile, COUNT(*) AS total
         FROM application_accesses aa
         JOIN applications a ON a.public_id = aa.application_public_id
        WHERE aa.status = 'GRANTED'
        GROUP BY a.code, aa.access_profile
        ORDER BY a.code, aa.access_profile`
    );
    const membershipsAtivos = await this.contar(
      "SELECT COUNT(*) AS total FROM memberships WHERE status = 'ACTIVE'"
    );
    const lotes = await this.select<Record<string, unknown>>(
      `SELECT public_id, source_system, mode, status, mapping_rules_version, started_at, finished_at
         FROM import_batches ORDER BY id DESC LIMIT 5`
    );
    const alertas = await this.select<{ action: string; total: number | string }>(
      `SELECT action, COUNT(*) AS total FROM import_batch_items
        WHERE action IN ('CONFLICT','QUARANTINE') GROUP BY action`
    );

    return {
      identitiesByStatus: identidades.map((l) => ({ status: l.status, total: Number(l.total) })),
      organizationsByTypeStatus: organizacoes.map((l) => ({
        type: l.type,
        status: l.status,
        total: Number(l.total)
      })),
      grantedAccessesByApplication: acessos.map((l) => ({
        applicationCode: l.code,
        accessProfile: l.access_profile,
        total: Number(l.total)
      })),
      activeMemberships: membershipsAtivos,
      latestImportBatches: lotes,
      importAlerts: alertas.map((l) => ({ action: l.action, total: Number(l.total) }))
    };
  }

  public async listarIdentidades(filtros: {
    readonly status?: unknown;
    readonly q?: unknown;
    readonly limit?: unknown;
    readonly offset?: unknown;
  }): Promise<PaginaAdmin<Record<string, unknown>>> {
    const { limit, offset } = normalizarPaginacao(filtros.limit, filtros.offset);
    const status = apenasSeConhecido(filtros.status, STATUS_IDENTIDADE);

    const condicoes: string[] = ["status <> 'DELETED'"];
    const params: unknown[] = [];
    if (status !== undefined) {
      condicoes.push("status = ?");
      params.push(status);
    }
    // Busca por prefixo/trecho em nome ou e-mail normalizado. `LIKE` com
    // parâmetro, nunca concatenação; o `%` entra no VALOR, não no SQL.
    const termo = typeof filtros.q === "string" ? filtros.q.trim().slice(0, 120) : "";
    if (termo.length >= 2) {
      condicoes.push("(full_name LIKE ? OR email_normalized LIKE ?)");
      params.push(`%${termo}%`, `%${termo.toLowerCase()}%`);
    }
    const where = condicoes.join(" AND ");

    const total = await this.contar(`SELECT COUNT(*) AS total FROM identities WHERE ${where}`, params);
    const items = await this.select<Record<string, unknown>>(
      `SELECT public_id, full_name, email, status, type, login_enabled, created_at
         FROM identities WHERE ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { items, total, limit, offset };
  }

  public async detalharIdentidade(publicId: string): Promise<Record<string, unknown> | undefined> {
    const linhas = await this.select<Record<string, unknown>>(
      `SELECT public_id, full_name, email, status, type, login_enabled, version, created_at, updated_at
         FROM identities WHERE public_id = ? AND status <> 'DELETED' LIMIT 1`,
      [publicId]
    );
    const identidade = linhas[0];
    if (identidade === undefined) {
      return undefined;
    }

    const referencias = await this.select<Record<string, unknown>>(
      `SELECT public_id, system_code, entity_type, legacy_id, match_method, status
         FROM identity_external_references WHERE identity_public_id = ?
        ORDER BY system_code, entity_type, legacy_id`,
      [publicId]
    );
    const memberships = await this.select<Record<string, unknown>>(
      `SELECT m.public_id, m.organization_public_id, o.legal_name, o.trade_name, o.type AS organization_type,
              m.profile, m.scope, m.status, m.started_at, m.ended_at
         FROM memberships m
         JOIN organizations o ON o.public_id = m.organization_public_id
        WHERE m.identity_public_id = ?
        ORDER BY m.status, o.legal_name`,
      [publicId]
    );
    const acessos = await this.select<Record<string, unknown>>(
      `SELECT aa.public_id, a.code AS application_code, aa.access_profile, aa.status, aa.version,
              aa.granted_at, aa.revoked_at
         FROM application_accesses aa
         JOIN applications a ON a.public_id = aa.application_public_id
        WHERE aa.identity_public_id = ?
        ORDER BY a.code, aa.granted_at DESC`,
      [publicId]
    );

    return {
      ...identidade,
      // "Federada" é uma leitura de fato, não um palpite: existe
      // referência externa ACTIVE de outro sistema apontando para ela.
      federated: referencias.some((r) => r["status"] === "ACTIVE"),
      externalReferences: referencias,
      memberships,
      applicationAccesses: acessos
    };
  }

  public async listarOrganizacoes(filtros: {
    readonly type?: unknown;
    readonly status?: unknown;
    readonly q?: unknown;
    readonly limit?: unknown;
    readonly offset?: unknown;
  }): Promise<PaginaAdmin<Record<string, unknown>>> {
    const { limit, offset } = normalizarPaginacao(filtros.limit, filtros.offset);
    const tipo = apenasSeConhecido(filtros.type, TIPOS_ORGANIZACAO);
    const status = apenasSeConhecido(filtros.status, STATUS_ORGANIZACAO);

    const condicoes: string[] = ["1 = 1"];
    const params: unknown[] = [];
    if (tipo !== undefined) {
      condicoes.push("type = ?");
      params.push(tipo);
    }
    if (status !== undefined) {
      condicoes.push("status = ?");
      params.push(status);
    }
    const termo = typeof filtros.q === "string" ? filtros.q.trim().slice(0, 120) : "";
    if (termo.length >= 2) {
      condicoes.push("(legal_name LIKE ? OR trade_name LIKE ?)");
      params.push(`%${termo}%`, `%${termo}%`);
    }
    const where = condicoes.join(" AND ");

    const total = await this.contar(`SELECT COUNT(*) AS total FROM organizations WHERE ${where}`, params);
    const items = await this.select<Record<string, unknown>>(
      `SELECT public_id, type, legal_name, trade_name, status, created_at
         FROM organizations WHERE ${where}
        ORDER BY type, legal_name
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { items, total, limit, offset };
  }

  public async detalharOrganizacao(publicId: string): Promise<Record<string, unknown> | undefined> {
    const linhas = await this.select<Record<string, unknown>>(
      `SELECT public_id, type, legal_name, trade_name, document_number, status, version, created_at
         FROM organizations WHERE public_id = ? LIMIT 1`,
      [publicId]
    );
    const organizacao = linhas[0];
    if (organizacao === undefined) {
      return undefined;
    }

    const filhas = await this.select<Record<string, unknown>>(
      `SELECT o.public_id, o.type, o.legal_name, o.trade_name, o.status
         FROM organization_relationships r
         JOIN organizations o ON o.public_id = r.child_organization_public_id
        WHERE r.parent_organization_public_id = ?
        ORDER BY o.legal_name`,
      [publicId]
    );
    const pais = await this.select<Record<string, unknown>>(
      `SELECT o.public_id, o.type, o.legal_name, o.trade_name, o.status
         FROM organization_relationships r
         JOIN organizations o ON o.public_id = r.parent_organization_public_id
        WHERE r.child_organization_public_id = ?
        ORDER BY o.legal_name`,
      [publicId]
    );
    const referencias = await this.select<Record<string, unknown>>(
      `SELECT public_id, system_code, entity_type, legacy_id, status
         FROM organization_external_references WHERE organization_public_id = ?
        ORDER BY system_code, entity_type`,
      [publicId]
    );
    const membros = await this.select<Record<string, unknown>>(
      `SELECT m.public_id, m.identity_public_id, i.full_name, i.status AS identity_status,
              m.profile, m.scope, m.status
         FROM memberships m
         JOIN identities i ON i.public_id = m.identity_public_id
        WHERE m.organization_public_id = ?
        ORDER BY m.status, i.full_name
        LIMIT 100`,
      [publicId]
    );
    const aplicacoes = await this.select<Record<string, unknown>>(
      `SELECT a.code AS application_code, aa.access_profile, COUNT(*) AS total
         FROM memberships m
         JOIN application_accesses aa ON aa.identity_public_id = m.identity_public_id AND aa.status = 'GRANTED'
         JOIN applications a ON a.public_id = aa.application_public_id
        WHERE m.organization_public_id = ? AND m.status = 'ACTIVE'
        GROUP BY a.code, aa.access_profile
        ORDER BY a.code`,
      [publicId]
    );

    return {
      ...organizacao,
      parents: pais,
      children: filhas,
      externalReferences: referencias,
      members: membros,
      applications: aplicacoes
    };
  }

  /**
   * Aplicações cadastradas — alimenta o seletor de "conceder acesso".
   *
   * Lista pequena e fechada (é configuração de plataforma, não dado de
   * volume), então não pagina. Sem ela o formulário teria que adivinhar
   * os códigos ou trazê-los fixos no frontend, que é onde eles
   * envelheceriam sem ninguém notar.
   */
  public async listarAplicacoes(): Promise<readonly Record<string, unknown>[]> {
    return this.select<Record<string, unknown>>(
      `SELECT public_id, code, name, status FROM applications ORDER BY code`
    );
  }

  public async listarLotes(filtros: {
    readonly limit?: unknown;
    readonly offset?: unknown;
  }): Promise<PaginaAdmin<Record<string, unknown>>> {
    const { limit, offset } = normalizarPaginacao(filtros.limit, filtros.offset);
    const total = await this.contar("SELECT COUNT(*) AS total FROM import_batches");
    const items = await this.select<Record<string, unknown>>(
      `SELECT b.public_id, b.source_system, b.mode, b.status, b.mapping_rules_version,
              b.dry_run_batch_public_id, b.approved_by_identity_public_id, b.approved_at,
              b.counts_before, b.counts_after, b.started_at, b.finished_at,
              (SELECT COUNT(*) FROM import_batch_items i WHERE i.batch_public_id = b.public_id) AS total_items
         FROM import_batches b
        ORDER BY b.id DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { items, total, limit, offset };
  }

  public async listarItensDoLote(
    batchPublicId: string,
    filtros: { readonly action?: unknown; readonly limit?: unknown; readonly offset?: unknown }
  ): Promise<PaginaAdmin<Record<string, unknown>>> {
    const { limit, offset } = normalizarPaginacao(filtros.limit, filtros.offset);
    const acao = apenasSeConhecido(filtros.action, ACOES_IMPORTACAO);

    const condicoes = ["batch_public_id = ?"];
    const params: unknown[] = [batchPublicId];
    if (acao !== undefined) {
      condicoes.push("action = ?");
      params.push(acao);
    }
    const where = condicoes.join(" AND ");

    const total = await this.contar(`SELECT COUNT(*) AS total FROM import_batch_items WHERE ${where}`, params);
    const items = await this.select<Record<string, unknown>>(
      `SELECT public_id, entity_kind, source_entity_type, source_legacy_id, action,
              target_public_id, reason_code, error_message, before_snapshot, after_snapshot, created_at
         FROM import_batch_items WHERE ${where}
        ORDER BY source_legacy_id, id
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { items, total, limit, offset };
  }
}
