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
  HELPDESK_DB_PASSWORD: z.string().min(1)
});

export interface HelpdeskSourceConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
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
  return {
    host: resultado.data.HELPDESK_DB_HOST,
    port: resultado.data.HELPDESK_DB_PORT,
    database: resultado.data.HELPDESK_DB_NAME,
    user: resultado.data.HELPDESK_DB_USER,
    password: resultado.data.HELPDESK_DB_PASSWORD
  };
}
