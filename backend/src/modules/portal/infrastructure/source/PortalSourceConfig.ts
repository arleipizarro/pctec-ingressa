import { z } from "zod";

/**
 * Configuração da fonte Portal — o catálogo de `pctecdb.clientes`.
 *
 * **Prefixo próprio e nenhum default.** As duas coisas pelo mesmo
 * motivo: a fonte do Portal é um banco DIFERENTE do banco do Ingressa,
 * lido por uma credencial DIFERENTE, e as duas configurações convivem
 * no mesmo processo. Reaproveitar `DB_*` faria o catálogo ler o banco
 * do Ingressa e não achar nenhum cliente; herdar um default faria
 * "configuração ausente" virar "conectou no lugar errado", que é a
 * falha real que `HelpdeskSourceConfig` já documenta.
 *
 * Faltando qualquer variável, o carregamento falha — e quem chama
 * (`createApp`) transforma isso em 503 na funcionalidade dependente, sem
 * derrubar login nem o resto da API.
 *
 * As variáveis vivem em `/app/.config/pctec-ingressa/portal-source.env`
 * (fora do repositório, 600), carregado pelo Node via `--env-file`.
 *
 * A credencial apontada aqui é **somente leitura** sobre
 * `pctecdb.clientes`. Nada neste módulo escreve no Portal, e a
 * separação de pools (ver `PortalCatalogComposition`) é o que impede
 * que um engano de fiação transforme uma leitura em escrita no banco
 * errado.
 */
const portalSourceSchema = z.object({
  PORTAL_SOURCE_DB_HOST: z.string().min(1),
  PORTAL_SOURCE_DB_PORT: z.coerce.number().int().positive(),
  PORTAL_SOURCE_DB_NAME: z.string().min(1),
  PORTAL_SOURCE_DB_USER: z.string().min(1),
  PORTAL_SOURCE_DB_PASSWORD: z.string().min(1)
});

export interface PortalSourceConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

export class MissingPortalSourceConfigError extends Error {
  public constructor(faltando: readonly string[]) {
    super(
      "configuração da fonte Portal ausente ou incompleta: " +
        `${faltando.join(", ")}. Rode com ` +
        "--env-file=/app/.config/pctec-ingressa/portal-source.env"
    );
    this.name = "MissingPortalSourceConfigError";
  }
}

/**
 * A mensagem lista só NOMES de variável — nunca valores, nem sequer o
 * host. Um erro de configuração não pode ser o caminho pelo qual a
 * credencial aparece num log de operação, e esta mensagem também não
 * chega à resposta HTTP (ver `createApp`).
 */
export function loadPortalSourceConfig(env: NodeJS.ProcessEnv = process.env): PortalSourceConfig {
  const resultado = portalSourceSchema.safeParse(env);
  if (!resultado.success) {
    const faltando = resultado.error.issues.map((issue) => String(issue.path[0] ?? "?"));
    throw new MissingPortalSourceConfigError([...new Set(faltando)]);
  }
  return {
    host: resultado.data.PORTAL_SOURCE_DB_HOST,
    port: resultado.data.PORTAL_SOURCE_DB_PORT,
    database: resultado.data.PORTAL_SOURCE_DB_NAME,
    user: resultado.data.PORTAL_SOURCE_DB_USER,
    password: resultado.data.PORTAL_SOURCE_DB_PASSWORD
  };
}
