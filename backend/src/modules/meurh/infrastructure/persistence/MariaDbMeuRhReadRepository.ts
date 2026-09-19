import type { Queryable } from "../../../../shared/database/Queryable.js";

/**
 * Projeções de LEITURA do namespace do Meu RH.
 *
 * Consultas diretas, sem Aggregate: são leituras de lista e de resumo,
 * e reconstituir agregados para devolvê-los achatados em JSON seria
 * trabalho puro sem invariante nenhuma para proteger. Mesmo precedente
 * de `MariaDbAdminReadRepository`.
 *
 * NENHUMA consulta aqui seleciona `id` interno, `token_hash`,
 * `password_hash` ou qualquer coluna de credencial — o que não é
 * selecionado não vaza por descuido de serialização.
 */

export interface OrganizacaoResumida {
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly status: string;
}

export interface IdentidadeResumida {
  readonly publicId: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: string;
  readonly loginEnabled: boolean;
}

export interface IdentidadeNoDiretorio extends IdentidadeResumida {
  readonly membershipStatus: string;
}

/**
 * Forma canônica do nome para comparação — `LOWER` + colapso de espaços
 * no próprio SQL.
 *
 * A comparação acontece no banco, e não em memória, porque a alternativa
 * seria trazer o catálogo inteiro de organizações para o processo a cada
 * resolução. A collation `utf8mb4_unicode_520_ci` já ignora caixa e
 * acento; o `REPLACE` encadeado cobre o espaço duplicado, que a
 * collation não normaliza.
 */
const NOME_NORMALIZADO =
  "TRIM(REPLACE(REPLACE(REPLACE(LOWER(?), '\\t', ' '), '  ', ' '), '  ', ' '))";

export class MariaDbMeuRhReadRepository {
  public constructor(private readonly connection: Queryable) {}

  /**
   * Organizações do tipo pedido cujo `legal_name` OU `trade_name`
   * corresponda a QUALQUER um dos nomes informados, na forma
   * normalizada.
   *
   * **Por que uma lista de nomes, e não um só.** O Cadastro Mestre
   * guarda a razão social e o nome fantasia como eles são — e o nome
   * pelo qual um produto conhece a empresa nem sempre é nenhum dos dois
   * literalmente. "PCTEC Outsourcing" e "PCTEC" são a mesma empresa; sem
   * poder declarar isso, a resolução por nome criaria uma segunda
   * COMPANY para uma empresa que já está cadastrada — exatamente a
   * duplicidade que esta resolução existe para impedir.
   *
   * **Por que filtra por tipo.** Um BUSINESS_GROUP não emprega ninguém:
   * o vínculo de colaborador é com a COMPANY. Sem o filtro, o nome
   * fantasia de um grupo ("PCTEC OUTSOURCING") faria a busca devolver o
   * GRUPO, e os vínculos nasceriam no lugar errado.
   *
   * Devolve a LISTA, e não a primeira linha: a decisão sobre
   * ambiguidade pertence ao service, que a recusa explicitamente em vez
   * de escolher em silêncio.
   */
  public async organizacoesPorNome(
    nomes: readonly string[],
    tipo: "COMPANY" | "BUSINESS_GROUP"
  ): Promise<readonly OrganizacaoResumida[]> {
    const candidatos = [...new Set(nomes.map((nome) => nome.trim()).filter((nome) => nome.length > 0))];
    if (candidatos.length === 0) {
      return [];
    }
    // Um par de placeholders por nome candidato — nunca interpolação do
    // valor no SQL.
    const condicoes = candidatos
      .map(
        () =>
          `(TRIM(REPLACE(REPLACE(REPLACE(LOWER(legal_name), '\\t', ' '), '  ', ' '), '  ', ' ')) = ${NOME_NORMALIZADO}` +
          ` OR TRIM(REPLACE(REPLACE(REPLACE(LOWER(COALESCE(trade_name, '')), '\\t', ' '), '  ', ' '), '  ', ' ')) = ${NOME_NORMALIZADO})`
      )
      .join(" OR ");
    const valores = candidatos.flatMap((nome) => [nome, nome]);

    const [linhas] = await this.connection.execute(
      `SELECT public_id, type, legal_name, trade_name, status
         FROM organizations
        WHERE type = ? AND (${condicoes})
        ORDER BY created_at ASC`,
      [tipo, ...valores]
    );
    return (linhas as unknown as {
      public_id: string;
      type: string;
      legal_name: string;
      trade_name: string | null;
      status: string;
    }[]).map((linha) => ({
      publicId: linha.public_id,
      type: linha.type,
      legalName: linha.legal_name,
      tradeName: linha.trade_name,
      status: linha.status
    }));
  }

  public async identidadePorEmailNormalizado(emailNormalizado: string): Promise<IdentidadeResumida | undefined> {
    const [linhas] = await this.connection.execute(
      `SELECT public_id, full_name, email, status, login_enabled
         FROM identities
        WHERE email_normalized = ? AND status <> 'DELETED'
        LIMIT 1`,
      [emailNormalizado]
    );
    return paraIdentidade(linhas);
  }

  public async identidadePorPublicId(publicId: string): Promise<IdentidadeResumida | undefined> {
    const [linhas] = await this.connection.execute(
      `SELECT public_id, full_name, email, status, login_enabled
         FROM identities
        WHERE public_id = ? AND status <> 'DELETED'
        LIMIT 1`,
      [publicId]
    );
    return paraIdentidade(linhas);
  }

  /** Quem tem vínculo (de qualquer situação) com a organização informada. */
  public async diretorioDaOrganizacao(organizationPublicId: string): Promise<readonly IdentidadeNoDiretorio[]> {
    const [linhas] = await this.connection.execute(
      `SELECT i.public_id, i.full_name, i.email, i.status, i.login_enabled, m.status AS membership_status
         FROM memberships m
         JOIN identities i ON i.public_id = m.identity_public_id
        WHERE m.organization_public_id = ?
          AND m.profile = 'EMPLOYEE'
          AND i.status <> 'DELETED'
        ORDER BY i.full_name ASC`,
      [organizationPublicId]
    );
    return (linhas as unknown as {
      public_id: string;
      full_name: string;
      email: string;
      status: string;
      login_enabled: number;
      membership_status: string;
    }[]).map((linha) => ({
      publicId: linha.public_id,
      fullName: linha.full_name,
      email: linha.email,
      status: linha.status,
      loginEnabled: linha.login_enabled === 1,
      membershipStatus: linha.membership_status
    }));
  }

  /**
   * Perfil de acesso GRANTED da identidade na aplicação informada.
   * `undefined` = sem acesso — nunca um perfil vazio, que um chamador
   * distraído poderia tratar como "tem acesso, sem perfil".
   */
  public async perfilDeAcesso(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<string | undefined> {
    const [linhas] = await this.connection.execute(
      `SELECT access_profile
         FROM application_accesses
        WHERE identity_public_id = ? AND application_public_id = ? AND status = 'GRANTED'
        ORDER BY FIELD(access_profile, 'ADMIN', 'USER')
        LIMIT 1`,
      [identityPublicId, applicationPublicId]
    );
    return (linhas as unknown as { access_profile: string }[])[0]?.access_profile;
  }
}

function paraIdentidade(linhas: unknown): IdentidadeResumida | undefined {
  const linha = (linhas as {
    public_id: string;
    full_name: string;
    email: string;
    status: string;
    login_enabled: number;
  }[])[0];
  if (linha === undefined) {
    return undefined;
  }
  return {
    publicId: linha.public_id,
    fullName: linha.full_name,
    email: linha.email,
    status: linha.status,
    loginEnabled: linha.login_enabled === 1
  };
}
