import { z } from "zod";

/**
 * Configuração da fonte Helpdesk.
 *
 * **Sem default nenhum para credencial, banco ou usuário** — e essa
 * ausência é a lição de uma falha real desta v0.8.x: os scripts npm de
 * migration caíam nos defaults do Zod e apontavam para um banco que não
 * era o alvo, transformando "configuração faltando" em "conectou no
 * lugar errado". Aqui, faltando qualquer variável, o carregamento
 * falha e o importador não roda.
 *
 * As variáveis vivem em `/app/.config/pctec-ingressa/helpdesk-source.env`
 * (fora do repositório, 600), carregado pelo Node via `--env-file`. O
 * prefixo `HELPDESK_` evita a pior colisão possível: reaproveitar por
 * acidente as variáveis `DB_*` do Ingressa e ler a fonte errada.
 */
const helpdeskSourceSchema = z.object({
  HELPDESK_DB_HOST: z.string().min(1),
  HELPDESK_DB_PORT: z.coerce.number().int().positive(),
  HELPDESK_DB_NAME: z.string().min(1),
  HELPDESK_DB_USER: z.string().min(1),
  HELPDESK_DB_PASSWORD: z.string().min(1),
  HELPDESK_REGISTRY_DB_NAME: z.string().min(1)
});

/**
 * Identificador SQL não citado: letra ou `_` no início, depois letras,
 * dígitos, `_` ou `$`, até 64 caracteres — o limite do MariaDB.
 *
 * A validação existe porque este nome é o ÚNICO valor de configuração
 * que entra no texto de uma consulta. Ele não pode ser parametrizado:
 * `?` liga valores, não identificadores de schema. Então a defesa é
 * recusar antes de montar — e recusar por lista branca, nunca por lista
 * negra de caracteres perigosos, que sempre esquece um.
 */
const IDENTIFICADOR_SQL_SEGURO = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/;

export interface HelpdeskSourceConfig {
  readonly host: string;
  readonly port: number;
  /** Schema do Helpdesk propriamente dito — o da conexão. */
  readonly database: string;
  /**
   * Schema do registro AUTORITATIVO de empresas.
   *
   * Separado de `database` porque são coisas diferentes que hoje moram
   * em servidores iguais e amanhã podem não morar: a conexão é do
   * Helpdesk, o registro de empresas é de outro sistema. Obrigatório e
   * **sem default** — um default aqui seria um nome de schema fixo no
   * código por outro caminho, e a lição desta v0.8.x é exatamente essa:
   * default silencioso é como se lê o banco errado sem perceber.
   */
  readonly registryDatabase: string;
  readonly user: string;
  readonly password: string;
}

/**
 * O nome do schema autoritativo não é um identificador SQL válido.
 *
 * A mensagem cita a VARIÁVEL, nunca o valor recebido: um valor
 * malformado pode ser exatamente a tentativa de injeção, e ecoá-lo
 * num log de operação a propaga em vez de contê-la.
 */
export class InvalidHelpdeskRegistryDatabaseError extends Error {
  public constructor() {
    super(
      "HELPDESK_REGISTRY_DB_NAME não é um identificador SQL válido. Use apenas letras, dígitos, `_` e `$`, " +
        "começando por letra ou `_`, com no máximo 64 caracteres."
    );
    this.name = "InvalidHelpdeskRegistryDatabaseError";
  }
}

export class MissingHelpdeskSourceConfigError extends Error {
  public constructor(faltando: readonly string[]) {
    super(
      "configuração da fonte Helpdesk ausente ou incompleta: " +
        `${faltando.join(", ")}. Rode com ` +
        "--env-file=/app/.config/pctec-ingressa/helpdesk-source.env"
    );
    this.name = "MissingHelpdeskSourceConfigError";
  }
}

/**
 * A mensagem de erro lista só NOMES de variável — nunca valores. Um
 * erro de configuração não pode ser o caminho pelo qual a senha aparece
 * num log de operação.
 */
export function loadHelpdeskSourceConfig(env: NodeJS.ProcessEnv = process.env): HelpdeskSourceConfig {
  const resultado = helpdeskSourceSchema.safeParse(env);
  if (!resultado.success) {
    const faltando = resultado.error.issues.map((issue) => String(issue.path[0] ?? "?"));
    throw new MissingHelpdeskSourceConfigError([...new Set(faltando)]);
  }
  const registryDatabase = resultado.data.HELPDESK_REGISTRY_DB_NAME.trim();
  if (!IDENTIFICADOR_SQL_SEGURO.test(registryDatabase)) {
    throw new InvalidHelpdeskRegistryDatabaseError();
  }
  return {
    host: resultado.data.HELPDESK_DB_HOST,
    port: resultado.data.HELPDESK_DB_PORT,
    database: resultado.data.HELPDESK_DB_NAME,
    registryDatabase,
    user: resultado.data.HELPDESK_DB_USER,
    password: resultado.data.HELPDESK_DB_PASSWORD
  };
}
