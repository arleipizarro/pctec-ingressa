import { z } from "zod";

/**
 * Schema de variáveis de ambiente, conforme `.env.example`.
 *
 * Esta validação é chamada explicitamente por quem precisa da
 * configuração (ex.: testes de integração, ou um futuro `main.ts`) — não
 * é executada automaticamente ao importar este módulo, para não exigir
 * um `.env` presente apenas para rodar `npm test`/`npm run typecheck`.
 */
const envSchema = z.object({
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1).default("pctec_ingressa"),
  DB_USER: z.string().min(1).default("pctec_ingressa_app"),
  DB_PASSWORD: z.string().default(""),
  RUN_INTEGRATION_TESTS: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  // --- Servidor HTTP (v0.4.1 — Runtime Bootstrap) ---
  // HOST tem default "127.0.0.1" deliberadamente: nesta fatia não há
  // Nginx nem qualquer proxy reverso na frente do processo, então o bind
  // deve ficar restrito ao loopback por padrão — nunca 0.0.0.0 por
  // omissão, ainda que um ambiente futuro possa sobrescrever via env.
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3011),
  // --- CLI de migrations (v0.4.2) ---
  // Gate duplo para migrate:down/migrate:down-all: precisa do argumento
  // --yes E desta variável em "true" — nenhum dos dois sozinho basta.
  // Default "false" (nunca destrutivo por omissão). Além disso,
  // NODE_ENV=production recusa SEMPRE, mesmo com os dois presentes (ver
  // src/cli/migrate.ts) — essa recusa não depende desta variável.
  MIGRATIONS_ALLOW_DESTRUCTIVE: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // --- Sessão / Autenticação (v0.6.0 — Fase D, ADR-030) ---
  // Duração da sessão (expiração absoluta, sem sliding expiration nesta
  // fase — ADR-030). Nunca hardcoded no domínio; default aqui é só para
  // development/test, documentado explicitamente (task, seção 13) — em
  // produção, esta variável é OBRIGATÓRIA (ver gate em `loadEnv`
  // abaixo), o default nunca se aplica silenciosamente lá.
  //
  // `.max(2_592_000)` (30 dias) — limite superior razoável, não uma
  // regra de negócio rígida: sessões absolutas mais longas que isso
  // fogem do que esta fase (sem sliding expiration, sem RefreshToken)
  // foi desenhada para suportar com segurança. Valor de implementação,
  // revisável, não uma decisão arquitetural fechada em ADR-030.
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().max(2_592_000).default(28800), // 8h — default de development/test, não uma recomendação de produção
  // Gate de segurança: nunca permite Secure=false em produção, mesmo que
  // a variável de ambiente tente forçar isso (ver loadEnv abaixo) — task,
  // seção 22: "Não permitir production com Secure=false".
  SESSION_COOKIE_SECURE: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() === "true")
});

export type Env = z.infer<typeof envSchema>;

/**
 * Lê e valida `process.env` no momento da chamada (não em tempo de
 * import). Aplica gates adicionais, pós-schema, específicos de
 * `NODE_ENV=production` (defesa em profundidade — nenhum depende
 * apenas do schema declarativo, que sozinho aceitaria um default
 * silencioso):
 *
 * 1. `SESSION_COOKIE_SECURE=false` nunca é aceito em produção, mesmo
 *    que a variável de ambiente tente forçar isso.
 * 2. `SESSION_TTL_SECONDS` é OBRIGATÓRIO em produção — o default
 *    (8h, pensado para development/test) nunca se aplica
 *    silenciosamente em produção; a variável precisa estar
 *    explicitamente presente em `source` (checado ANTES do parse com
 *    default do zod, que não distingue "ausente" de "default
 *    aplicado" depois de rodar). Revisão crítica, v0.6.0: a política de
 *    duração de sessão é uma decisão operacional que precisa ser
 *    tomada conscientemente em produção, nunca herdada silenciosamente
 *    de um valor pensado para desenvolvimento local.
 *
 * Mesmo princípio já usado para `MIGRATIONS_ALLOW_DESTRUCTIVE` (recusa
 * incondicional em produção, independente do valor da variável).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = envSchema.parse(source);

  if (env.NODE_ENV === "production") {
    if (!env.SESSION_COOKIE_SECURE) {
      throw new Error(
        "Configuração inválida: SESSION_COOKIE_SECURE=false nunca é permitido com NODE_ENV=production."
      );
    }
    if (source["SESSION_TTL_SECONDS"] === undefined) {
      throw new Error(
        "Configuração inválida: SESSION_TTL_SECONDS é obrigatório com NODE_ENV=production — " +
          "o default (8h) é pensado apenas para development/test, nunca aplicado silenciosamente em produção."
      );
    }
  }

  return env;
}
