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
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

export type Env = z.infer<typeof envSchema>;

/** Lê e valida `process.env` no momento da chamada (não em tempo de import). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
