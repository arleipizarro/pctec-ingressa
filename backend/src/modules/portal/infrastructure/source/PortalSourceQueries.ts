import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Colunas que a fonte Portal pode projetar. Lista fechada, ordem fixa.
 *
 * `pctecdb.clientes` guarda muito mais do que isto — telefone, e-mail,
 * endereço completo, `em_rollout`. Nada disso participa da escolha de um
 * `legacyId`, e nenhuma consulta deste conector usa `SELECT *`, então
 * nem um bug de montagem traria essas colunas junto.
 */
export const PORTAL_CLIENT_COLUMNS: readonly string[] = Object.freeze([
  "id",
  "nome",
  "nome_fantasia",
  "tipo_doc",
  "documento",
  "ativo"
]);

/**
 * Termos que nunca podem aparecer no SQL da fonte Portal.
 *
 * `pctecdb` tem `portal_acesso` — a tabela de autenticação do Portal,
 * com hash de senha e token de recuperação. Este conector existe para
 * ler um catálogo comercial mínimo; a lista abaixo é o que garante que
 * ele continue sendo só isso mesmo quando alguém precisar "de mais um
 * campinho".
 */
export const PORTAL_FORBIDDEN_SQL_TERMS: readonly string[] = Object.freeze([
  "senha",
  "password",
  "passwd",
  "hash",
  "salt",
  "token",
  "secret",
  "credential",
  "api_key",
  "apikey",
  "private_key",
  "authorization",
  "session"
]);

/**
 * Tabelas fora do alcance deste conector.
 *
 * `portal_acesso` é autenticação. `clientes_grupo` é a fonte de verdade
 * paralela que o desenho do vínculo administrativo já recusou usar (ver
 * `docs/07-operacao/VINCULO-PORTAL-ADMINISTRATIVO.md`): a visão
 * consolidada de um grupo é a soma das empresas, não uma linha própria.
 * As demais são financeiro e contrato — o Ingressa não os lê.
 */
export const PORTAL_FORBIDDEN_SQL_TABLES: readonly string[] = Object.freeze([
  "portal_acesso",
  "clientes_grupo",
  "faturamento",
  "contratos",
  "contrato_itens",
  "rollout_baseline",
  "rollout_unidades",
  "medicao",
  "usuarios"
]);

/**
 * Escrita, em qualquer forma.
 *
 * `replace` aparece como `REPLACE INTO` (escrita) e como `REPLACE()`
 * (função de string) — e a função é exatamente o que normaliza o
 * documento do lado da fonte. A regex distingue as duas pelo que vem
 * depois: um parêntese é chamada de função; qualquer outra coisa é
 * comando.
 */
const PORTAL_WRITE_STATEMENTS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|call|load|into\s+outfile|set\s)\b|\breplace\s+(?!\()/i;

export class ForbiddenPortalQueryError extends DomainError {
  public readonly code = "PORTAL_CATALOG_QUERY_FORBIDDEN";
  public readonly classification = "VALIDATION" as const;

  constructor(motivo: string) {
    super(`consulta ao catálogo do Portal recusada: ${motivo}`);
  }
}

/**
 * Portão único do conector: nenhuma string de SQL chega ao driver sem
 * passar por aqui.
 *
 * Redundante com o GRANT read-only da credencial da fonte, e é para ser
 * mesmo — as duas travas protegem coisas diferentes. O GRANT protege o
 * banco do Portal contra escrita; isto protege a REGRA: um `SELECT`
 * legítimo que começasse a ler `portal_acesso` seria aceito pelo banco
 * (se o grant mudasse) e continuaria errado.
 */
export function assertReadOnlyPortalQuery(sql: string): void {
  const normalizado = sql.toLowerCase();

  if (!/^\s*select\b/.test(normalizado)) {
    throw new ForbiddenPortalQueryError("somente SELECT é permitido na fonte.");
  }
  if (PORTAL_WRITE_STATEMENTS.test(normalizado)) {
    throw new ForbiddenPortalQueryError("comando de escrita detectado.");
  }
  if (normalizado.includes(";")) {
    throw new ForbiddenPortalQueryError("múltiplas instruções não são permitidas.");
  }
  if (/select\s+\*/.test(normalizado)) {
    throw new ForbiddenPortalQueryError("`SELECT *` traria colunas comerciais junto — projete campo a campo.");
  }
  for (const termo of PORTAL_FORBIDDEN_SQL_TERMS) {
    if (normalizado.includes(termo)) {
      throw new ForbiddenPortalQueryError(`termo proibido na projeção: "${termo}".`);
    }
  }
  for (const tabela of PORTAL_FORBIDDEN_SQL_TABLES) {
    if (normalizado.includes(tabela)) {
      throw new ForbiddenPortalQueryError(`"${tabela}" está fora do alcance do catálogo.`);
    }
  }
}

export interface PortalSourceQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const PROJECAO = PORTAL_CLIENT_COLUMNS.join(", ");

/**
 * Normalização do documento DENTRO do SQL.
 *
 * `pctecdb.clientes.documento` é `VARCHAR(20)` e guarda o CNPJ
 * **mascarado** (as migrations do Portal fazem
 * `WHERE documento = '13.356.779/0001-24'`), sem índice e sem
 * normalização na escrita. Comparar o texto cru contra 14 dígitos não
 * acharia nada; comparar contra a máscara montada aqui presumiria que
 * todo mundo sempre digitou com a mesma pontuação.
 *
 * Então a normalização é a MESMA dos dois lados: só dígitos. O custo é
 * uma varredura de `clientes` (tabela pequena, algumas centenas de
 * linhas, e nenhum índice sobre `documento` existe para ser usado de
 * qualquer forma). O que NÃO se faz para evitar esse custo: criar
 * índice no banco do Portal — este conector não altera nada lá.
 */
const DOCUMENTO_NORMALIZADO =
  "REPLACE(REPLACE(REPLACE(REPLACE(documento, '.', ''), '/', ''), '-', ''), ' ', '')";

/**
 * Clientes por CNPJ normalizado — TODOS eles, sem `LIMIT`.
 *
 * A ausência do `LIMIT` é a regra, não descuido: a contagem é o que
 * separa `EXACT_UNIQUE` de `AMBIGUOUS`, e um `LIMIT 1` transformaria
 * duplicidade em vínculo automático para a primeira linha que o motor
 * devolvesse.
 *
 * `tipo_doc = 'CNPJ'` filtra a coluna que guarda CPF e CNPJ juntos.
 * Mesmo que um CPF tivesse 14 dígitos por erro de digitação, ele não
 * entraria na correspondência.
 */
export function buildClientsByDocumentQuery(documentDigits: string): PortalSourceQuery {
  if (!/^[0-9]{14}$/.test(documentDigits)) {
    throw new ForbiddenPortalQueryError("a correspondência exige um CNPJ normalizado de 14 dígitos.");
  }
  const sql =
    `SELECT ${PROJECAO} FROM clientes ` +
    `WHERE tipo_doc = 'CNPJ' AND ${DOCUMENTO_NORMALIZADO} = ? ` +
    `ORDER BY id`;
  assertReadOnlyPortalQuery(sql);
  return { sql, params: [documentDigits] };
}

export function buildClientByIdQuery(clientId: number): PortalSourceQuery {
  if (!Number.isSafeInteger(clientId) || clientId <= 0) {
    throw new ForbiddenPortalQueryError("id de cliente inválido.");
  }
  const sql = `SELECT ${PROJECAO} FROM clientes WHERE id = ? LIMIT 1`;
  assertReadOnlyPortalQuery(sql);
  return { sql, params: [clientId] };
}

/**
 * Busca administrativa.
 *
 * Dois modos, escolhidos pelo formato do termo e nunca misturados:
 *
 *  - **termo que normaliza para 14 dígitos** → comparação EXATA pelo
 *    documento. É a mesma comparação da correspondência automática;
 *  - **qualquer outro termo** → `LIKE` sobre `nome`/`nome_fantasia`.
 *
 * O `LIKE` existe só aqui, e só para o ADMIN ENXERGAR candidatos. Ele
 * nunca produz vínculo: quem cria a referência é a seleção explícita de
 * um `id`, numa segunda requisição. Essa fronteira é o motivo de a
 * busca textual e a correspondência automática serem funções
 * diferentes em vez de uma função com um parâmetro.
 */
function termoDeBusca(q: string | undefined): { modo: "DOCUMENTO" | "TEXTO" | "TUDO"; valor: string } {
  const texto = (q ?? "").trim();
  if (texto.length === 0) {
    return { modo: "TUDO", valor: "" };
  }
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length === 14 && /^[\d./\- ]+$/.test(texto)) {
    return { modo: "DOCUMENTO", valor: digitos };
  }
  // `%` e `_` são coringas de LIKE. Escapá-los impede que uma busca por
  // "%" liste a base inteira de um jeito que a paginação não previu.
  return { modo: "TEXTO", valor: `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%` };
}

function condicaoDeBusca(q: string | undefined): { where: string; params: readonly unknown[] } {
  const termo = termoDeBusca(q);
  if (termo.modo === "TUDO") {
    return { where: "", params: [] };
  }
  if (termo.modo === "DOCUMENTO") {
    return {
      where: `WHERE tipo_doc = 'CNPJ' AND ${DOCUMENTO_NORMALIZADO} = ? `,
      params: [termo.valor]
    };
  }
  return {
    where: "WHERE (nome LIKE ? OR nome_fantasia LIKE ?) ",
    params: [termo.valor, termo.valor]
  };
}

export function buildClientsSearchQuery(query: {
  readonly q?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}): PortalSourceQuery {
  const { where, params } = condicaoDeBusca(query.q);
  const sql =
    `SELECT ${PROJECAO} FROM clientes ` + where + `ORDER BY nome, id LIMIT ? OFFSET ?`;
  assertReadOnlyPortalQuery(sql);
  return { sql, params: [...params, query.limit, query.offset] };
}

export function buildClientsSearchCountQuery(query: { readonly q?: string | undefined }): PortalSourceQuery {
  const { where, params } = condicaoDeBusca(query.q);
  const sql = `SELECT COUNT(id) AS total FROM clientes ${where}`.trim();
  assertReadOnlyPortalQuery(sql);
  return { sql, params: [...params] };
}
