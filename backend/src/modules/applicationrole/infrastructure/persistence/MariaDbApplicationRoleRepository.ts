import type { Queryable } from "../../../../shared/database/Queryable.js";

/**
 * Leitura e escrita do catálogo de perfis de aplicação e das
 * concessões.
 *
 * Consultas diretas, sem Aggregate, pelo mesmo critério de
 * `MariaDbMeuRhReadRepository` e `MariaDbAdminReadRepository`: o que
 * existe aqui é uma lista de catálogo e um par conceder/revogar cuja
 * única invariante — no máximo uma concessão ativa por (pessoa,
 * aplicação, perfil) — é garantida pela unique de 0028, no banco, sem
 * janela de corrida. Um Aggregate em memória protegeria a mesma regra
 * com mais cerimônia e menos garantia.
 *
 * NENHUMA consulta seleciona `id` interno, `token_hash`,
 * `password_hash` ou coluna de credencial.
 */

export interface PerfilDeAplicacao {
  readonly publicId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  readonly status: string;
}

export interface ConcessaoDePerfil {
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly roleCode: string;
  readonly grantedAt: Date;
  readonly grantedByIdentityPublicId: string | null;
  readonly grantedByFullName: string | null;
  readonly grantedByLabel: string | null;
}

export interface ConcessaoComPessoa extends ConcessaoDePerfil {
  readonly fullName: string;
  readonly email: string;
}

/**
 * `permissions` é LONGTEXT com JSON validado no banco. Uma linha com
 * conteúdo inesperado vira lista vazia em vez de derrubar a
 * administração inteira: o campo é descritivo, e a tela sem a lista de
 * permissões continua permitindo conceder e revogar.
 */
function lerPermissoes(bruto: unknown): readonly string[] {
  if (typeof bruto !== "string") {
    return [];
  }
  try {
    const valor: unknown = JSON.parse(bruto);
    return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export class MariaDbApplicationRoleRepository {
  public constructor(private readonly connection: Queryable) {}

  /** `public_id` da aplicação ACTIVE com o código informado. */
  public async aplicacaoPorCodigo(applicationCode: string): Promise<string | undefined> {
    const [linhas] = await this.connection.execute(
      "SELECT public_id FROM applications WHERE code = ? AND status = 'ACTIVE' LIMIT 1",
      [applicationCode]
    );
    return (linhas as unknown as { public_id: string }[])[0]?.public_id;
  }

  /** Catálogo ACTIVE da aplicação, na ordem de exibição declarada. */
  public async catalogo(applicationPublicId: string): Promise<readonly PerfilDeAplicacao[]> {
    const [linhas] = await this.connection.execute(
      `SELECT public_id, code, name, description, permissions, status
         FROM application_roles
        WHERE application_public_id = ? AND status = 'ACTIVE'
        ORDER BY sort_order ASC, code ASC`,
      [applicationPublicId]
    );
    return (linhas as unknown as {
      public_id: string;
      code: string;
      name: string;
      description: string;
      permissions: unknown;
      status: string;
    }[]).map((linha) => ({
      publicId: linha.public_id,
      code: linha.code,
      name: linha.name,
      description: linha.description,
      permissions: lerPermissoes(linha.permissions),
      status: linha.status
    }));
  }

  public async perfilNoCatalogo(
    applicationPublicId: string,
    roleCode: string
  ): Promise<PerfilDeAplicacao | undefined> {
    return (await this.catalogo(applicationPublicId)).find((perfil) => perfil.code === roleCode);
  }

  /**
   * Códigos de perfil GRANTED da pessoa na aplicação.
   *
   * É o que o produto consumidor carrega na sessão. Devolve só o
   * código: o significado do perfil é do produto, e mandar a descrição
   * junto convidaria alguém a decidir autorização a partir dela.
   */
  public async perfisConcedidos(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<readonly string[]> {
    const [linhas] = await this.connection.execute(
      `SELECT a.role_code
         FROM application_role_assignments a
         JOIN application_roles r
           ON r.application_public_id = a.application_public_id
          AND r.code = a.role_code
        WHERE a.identity_public_id = ?
          AND a.application_public_id = ?
          AND a.status = 'GRANTED'
          AND r.status = 'ACTIVE'
        ORDER BY r.sort_order ASC, r.code ASC`,
      [identityPublicId, applicationPublicId]
    );
    return (linhas as unknown as { role_code: string }[]).map((linha) => linha.role_code);
  }

  /** Concessões ativas da aplicação inteira, com quem é e quem concedeu. */
  public async concessoesDaAplicacao(applicationPublicId: string): Promise<readonly ConcessaoComPessoa[]> {
    const [linhas] = await this.connection.execute(
      `SELECT a.public_id, a.identity_public_id, a.role_code, a.granted_at,
              a.granted_by_identity_public_id, a.granted_by_label,
              i.full_name, i.email,
              q.full_name AS granted_by_full_name
         FROM application_role_assignments a
         JOIN identities i ON i.public_id = a.identity_public_id
         LEFT JOIN identities q ON q.public_id = a.granted_by_identity_public_id
        WHERE a.application_public_id = ? AND a.status = 'GRANTED'
        ORDER BY i.full_name ASC, a.role_code ASC`,
      [applicationPublicId]
    );
    return (linhas as unknown as {
      public_id: string;
      identity_public_id: string;
      role_code: string;
      granted_at: Date;
      granted_by_identity_public_id: string | null;
      granted_by_label: string | null;
      full_name: string;
      email: string;
      granted_by_full_name: string | null;
    }[]).map((linha) => ({
      publicId: linha.public_id,
      identityPublicId: linha.identity_public_id,
      roleCode: linha.role_code,
      grantedAt: linha.granted_at,
      grantedByIdentityPublicId: linha.granted_by_identity_public_id,
      grantedByFullName: linha.granted_by_full_name,
      grantedByLabel: linha.granted_by_label,
      fullName: linha.full_name,
      email: linha.email
    }));
  }

  /** Concessões ativas de UMA pessoa na aplicação. */
  public async concessoesDaPessoa(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<readonly ConcessaoDePerfil[]> {
    const [linhas] = await this.connection.execute(
      `SELECT a.public_id, a.identity_public_id, a.role_code, a.granted_at,
              a.granted_by_identity_public_id, a.granted_by_label,
              q.full_name AS granted_by_full_name
         FROM application_role_assignments a
         LEFT JOIN identities q ON q.public_id = a.granted_by_identity_public_id
        WHERE a.identity_public_id = ? AND a.application_public_id = ? AND a.status = 'GRANTED'
        ORDER BY a.role_code ASC`,
      [identityPublicId, applicationPublicId]
    );
    return (linhas as unknown as {
      public_id: string;
      identity_public_id: string;
      role_code: string;
      granted_at: Date;
      granted_by_identity_public_id: string | null;
      granted_by_label: string | null;
      granted_by_full_name: string | null;
    }[]).map((linha) => ({
      publicId: linha.public_id,
      identityPublicId: linha.identity_public_id,
      roleCode: linha.role_code,
      grantedAt: linha.granted_at,
      grantedByIdentityPublicId: linha.granted_by_identity_public_id,
      grantedByFullName: linha.granted_by_full_name,
      grantedByLabel: linha.granted_by_label
    }));
  }

  /** A identidade existe (não DELETED) e tem ApplicationAccess GRANTED na aplicação? */
  public async identidadeElegivel(identityPublicId: string, applicationPublicId: string): Promise<boolean> {
    const [linhas] = await this.connection.execute(
      `SELECT 1 AS ok
         FROM identities i
         JOIN application_accesses c
           ON c.identity_public_id = i.public_id
          AND c.application_public_id = ?
          AND c.status = 'GRANTED'
        WHERE i.public_id = ? AND i.status <> 'DELETED'
        LIMIT 1`,
      [applicationPublicId, identityPublicId]
    );
    return (linhas as unknown as unknown[]).length > 0;
  }

  /**
   * Concede, reaproveitando a linha revogada quando ela existe.
   *
   * `INSERT ... ON DUPLICATE KEY UPDATE` não serve aqui: a unique de
   * 0028 inclui `active_grant_flag`, que é NULL nas linhas revogadas —
   * e NULL nunca colide em unique no MariaDB. Reconceder criaria uma
   * segunda linha e o histórico viraria uma pilha de duplicatas. Por
   * isso o caminho é procurar a linha revogada e reabri-la; só quando
   * não há nenhuma é que nasce uma.
   *
   * Devolve `null` quando a concessão JÁ estava ativa: reconceder o que
   * já vale é sucesso silencioso, não conflito, e o chamador decide se
   * emite evento (não emite).
   */
  public async conceder(entrada: {
    readonly publicId: string;
    readonly identityPublicId: string;
    readonly applicationPublicId: string;
    readonly roleCode: string;
    readonly grantedByIdentityPublicId: string | null;
    readonly grantedByLabel: string | null;
  }): Promise<{ publicId: string } | null> {
    const [ativas] = await this.connection.execute(
      `SELECT public_id FROM application_role_assignments
        WHERE identity_public_id = ? AND application_public_id = ? AND role_code = ? AND status = 'GRANTED'
        LIMIT 1`,
      [entrada.identityPublicId, entrada.applicationPublicId, entrada.roleCode]
    );
    if ((ativas as unknown as unknown[]).length > 0) {
      return null;
    }

    const [revogadas] = await this.connection.execute(
      `SELECT public_id FROM application_role_assignments
        WHERE identity_public_id = ? AND application_public_id = ? AND role_code = ? AND status = 'REVOKED'
        ORDER BY id DESC LIMIT 1`,
      [entrada.identityPublicId, entrada.applicationPublicId, entrada.roleCode]
    );
    const anterior = (revogadas as unknown as { public_id: string }[])[0];

    if (anterior !== undefined) {
      await this.connection.execute(
        `UPDATE application_role_assignments
            SET status = 'GRANTED',
                granted_at = UTC_TIMESTAMP(3),
                granted_by_identity_public_id = ?,
                granted_by_label = ?,
                revoked_at = NULL,
                revoked_by_identity_public_id = NULL,
                version = version + 1,
                updated_at = UTC_TIMESTAMP(3)
          WHERE public_id = ?`,
        [entrada.grantedByIdentityPublicId, entrada.grantedByLabel, anterior.public_id]
      );
      return { publicId: anterior.public_id };
    }

    await this.connection.execute(
      `INSERT INTO application_role_assignments
         (public_id, identity_public_id, application_public_id, role_code, status,
          granted_at, granted_by_identity_public_id, granted_by_label, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'GRANTED', UTC_TIMESTAMP(3), ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [
        entrada.publicId,
        entrada.identityPublicId,
        entrada.applicationPublicId,
        entrada.roleCode,
        entrada.grantedByIdentityPublicId,
        entrada.grantedByLabel
      ]
    );
    return { publicId: entrada.publicId };
  }

  /**
   * Revoga. Devolve `null` quando não havia concessão ativa — o
   * chamador transforma isso no erro de domínio, porque "revogar o que
   * não existe" é pedido incoerente, diferente de "conceder o que já
   * existe".
   */
  public async revogar(entrada: {
    readonly identityPublicId: string;
    readonly applicationPublicId: string;
    readonly roleCode: string;
    readonly revokedByIdentityPublicId: string | null;
  }): Promise<{ publicId: string } | null> {
    const [linhas] = await this.connection.execute(
      `SELECT public_id FROM application_role_assignments
        WHERE identity_public_id = ? AND application_public_id = ? AND role_code = ? AND status = 'GRANTED'
        LIMIT 1`,
      [entrada.identityPublicId, entrada.applicationPublicId, entrada.roleCode]
    );
    const ativa = (linhas as unknown as { public_id: string }[])[0];
    if (ativa === undefined) {
      return null;
    }
    await this.connection.execute(
      `UPDATE application_role_assignments
          SET status = 'REVOKED',
              revoked_at = UTC_TIMESTAMP(3),
              revoked_by_identity_public_id = ?,
              version = version + 1,
              updated_at = UTC_TIMESTAMP(3)
        WHERE public_id = ? AND status = 'GRANTED'`,
      [entrada.revokedByIdentityPublicId, ativa.public_id]
    );
    return { publicId: ativa.public_id };
  }
}
