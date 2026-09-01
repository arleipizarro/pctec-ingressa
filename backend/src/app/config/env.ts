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
    .transform((value) => value.toLowerCase() === "true"),
  // --- CSRF (v0.6.x, Fase E) ---
  // Lista de origens confiáveis para validação de Origin/Referer em
  // endpoints mutáveis autenticados por cookie (ADR-030, "CSRF") — usada
  // por `DELETE /api/v1/sessions/current` (logout). Nunca hardcoded no
  // código (`csrfGuard.ts` recebe a lista como parâmetro); configurável
  // via env, separada por vírgula. Default cobre apenas o ambiente local
  // desta fatia (`127.0.0.1:PORT`) — produção real precisa configurar
  // explicitamente o(s) domínio(s) do frontend.
  ALLOWED_ORIGINS: z
    .string()
    .default("http://127.0.0.1:3011")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    ),
  // --- Credencial service-to-service Ingressa↔Portal (P1A.1, v0.7.x) ---
  // Default `""` deliberado — NUNCA um segredo funcional por omissão.
  // `requireServiceCredential.ts` trata string vazia como
  // "rota indisponível" (fail-closed absoluto, decisão do Product
  // Owner): sem esta variável configurada, a rota
  // `/api/v1/service/portal/...` nunca aceita nenhuma chamada, mesmo
  // com um header presente — nunca "sem credencial configurada = aceita
  // qualquer coisa". Mesmo nome nos dois sistemas (Ingressa e Portal)
  // — decisão deliberada do Product Owner, deixa explícito que é um
  // único segredo compartilhado entre os dois lados do canal, não dois
  // segredos coincidentemente parecidos.
  INGRESSA_PORTAL_SERVICE_CREDENTIAL: z.string().default(""),
  // --- Credencial service-to-service Ingressa<-Helpdesk (v0.8.x) ---
  // Distinta e independente da credencial do Portal, por decisão do
  // contrato (docs/import/CONTRATO-SERVICE-HELPDESK.md): credencial
  // compartilhada significa que vazar a do Helpdesk da acesso ao
  // contexto do Portal, e que revogar uma derruba os dois produtos.
  // Default "" pelo mesmo motivo da do Portal — nunca um segredo
  // funcional por omissao; sem ela configurada, so a rota
  // /api/v1/service/helpdesk/... fica indisponivel (401), e o resto da
  // aplicacao sobe normalmente.
  INGRESSA_HELPDESK_SERVICE_CREDENTIAL: z.string().default(""),
  // --- Credencial do consumidor PCTEC_MEU_RH no namespace de resolucao
  //     de binding (fundacao PCTEC Meu RH) ----------------------------
  // Protege `/api/v1/service/identity-external-references/...`, que
  // responde "qual registro do sistema X esta Identity representa?".
  //
  // Credencial POR CONSUMIDOR, nunca uma chave universal do namespace:
  // a rota e generica (systemCode/entityType sao parametros), mas o
  // segredo nao pode ser, ou o primeiro consumidor autorizado entregaria
  // a chave a todos os seguintes — vazar a de um daria acesso ao que
  // todos veem, e revogar a de um derrubaria todos. Cada consumidor novo
  // ganha uma variavel PROPRIA e um header PROPRIO, como Portal e
  // Helpdesk ja tem. Ver
  // `modules/identity/http/identityResolutionServiceConsumers.ts`.
  //
  // Default "" pelo mesmo motivo das demais — nunca um segredo funcional
  // por omissao. Sem NENHUM consumidor configurado, SO este namespace
  // fica indisponivel (401) e todo o resto do Ingressa sobe normalmente.
  // E esse justamente o estado esperado enquanto o Arquiteto nao
  // autorizar o consumidor: a fundacao fica pronta e fechada.
  INGRESSA_MEU_RH_SERVICE_CREDENTIAL: z.string().default(""),
  // --- Protecao contra forca bruta no login (D8, ADR-034) -------------
  //
  // Default LIGADO. Um limitador que so protege quando alguem lembra de
  // ligar nao e protecao — e o dia de esquecer e sempre o dia errado.
  // Desligar e a escotilha operacional (incidente, ordem de implantacao
  // invertida), nunca o estado normal.
  LOGIN_RATE_LIMIT_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  // Janela de contagem. 15 minutos: longo o bastante para que uma
  // rajada nao seja diluida, curto o bastante para que quem errou a
  // senha algumas vezes nao fique preso a tarde inteira.
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().max(86_400).default(900),
  // Teto por ORIGEM. Generoso: um escritorio inteiro sai por um NAT so,
  // e apertar aqui transformaria um dia normal em indisponibilidade
  // para todo mundo atras daquele IP.
  LOGIN_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive().max(10_000).default(60),
  // Teto por (origem + identificador). E o limite que de fato barra
  // adivinhacao de senha, e por isso e apertado.
  LOGIN_RATE_LIMIT_MAX_PER_IP_IDENTIFIER: z.coerce.number().int().positive().max(10_000).default(10),
  // Quantos proxies CONFIAVEIS existem na frente do processo.
  //
  // Default 0 = nao confia em X-Forwarded-For nenhum. E o unico default
  // seguro: o header e escrito pelo cliente antes de qualquer proxy, e
  // confiar nele sem saber a profundidade da cadeia entrega ao atacante
  // a escolha do proprio contador — basta um header novo por tentativa.
  //
  // Em DEV/PRD o Ingressa fica atras de um Nginx: o valor correto la e
  // 1. Sem esse ajuste, TODAS as requisicoes chegam como 127.0.0.1 e o
  // contador por origem vira um contador global, que barraria a empresa
  // inteira junto. E o unico parametro desta entrega que precisa ser
  // conferido por ambiente.
  TRUSTED_PROXY_HOP_COUNT: z.coerce.number().int().min(0).max(10).default(0),
  // --- SSO first-party Ingressa -> produtos (v1.0) ---
  //
  // Base pública da UI do Ingressa. Usada para montar o link do convite
  // (`<base>/convite#<token>`) e nada mais. Default "" deliberado: sem
  // ela, a emissão de convites fica indisponível com erro explícito, em
  // vez de gerar um link para `undefined/convite`.
  INGRESSA_PUBLIC_BASE_URL: z.string().default(""),
  // Lista FECHADA de `redirect_uri` aceitos para o cliente
  // `PCTEC_PORTAL`, separados por vírgula, em forma absoluta e exata.
  // Nunca prefixo, nunca curinga: a comparação é igualdade de string, e
  // é ela que impede open redirect. Vazia = SSO do Portal indisponível
  // (fail-closed) — nunca "sem lista configurada = aceita qualquer
  // URL", que seria o pior default possível nesta variável.
  SSO_PORTAL_REDIRECT_URIS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((uri) => uri.trim())
        .filter((uri) => uri.length > 0)
    ),
  // URL que INICIA o fluxo, do lado do Portal (o card do launcher aponta
  // para cá). Pertence ao Portal, não ao Ingressa — por isso é
  // configuração, e por isso o card fica desabilitado quando ausente em
  // vez de sumir: o acesso existe, o destino é que não foi configurado.
  SSO_PORTAL_LAUNCH_URL: z.string().default(""),
  // Mesmo papel, para o card do Helpdesk. Ausente = card desabilitado.
  HELPDESK_LAUNCH_URL: z.string().default(""),
  // Validade do código de autorização. O teto real (60s) vive no
  // agregado `AuthorizationCode` — esta variável só permite encurtar,
  // nunca esticar: afrouxar a janela de replay não pode ser um ajuste de
  // configuração.
  SSO_AUTHORIZATION_CODE_TTL_SECONDS: z.coerce.number().int().positive().max(60).default(60),
  // --- Convite de primeiro acesso (v1.0) ---
  // 24h por padrão; o teto de 7 dias vive no agregado `Invitation`.
  INVITATION_TTL_SECONDS: z.coerce.number().int().positive().max(604_800).default(86_400),
  // MANUAL_DEV: o link é mostrado UMA vez ao ADMIN e nada é enviado.
  // EMAIL: entrega pelo transporte SMTP próprio do Ingressa.
  // Recusado em produção (ver gate em `loadEnv`): mostrar o link na tela
  // é um recurso de desenvolvimento, não uma política de entrega.
  INVITATION_DELIVERY_MODE: z.enum(["MANUAL_DEV", "EMAIL"]).default("MANUAL_DEV"),
  // SMTP PRÓPRIO do Ingressa — nunca compartilhado com o Portal, para
  // que revogar uma credencial não derrube o outro produto. Nenhum valor
  // real aqui e nenhum no Git: defaults "" e ausência = modo EMAIL
  // indisponível, com erro operacional explícito.
  INGRESSA_SMTP_HOST: z.string().default(""),
  INGRESSA_SMTP_PORT: z.coerce.number().int().positive().max(65_535).default(587),
  INGRESSA_SMTP_USER: z.string().default(""),
  INGRESSA_SMTP_PASSWORD: z.string().default(""),
  INGRESSA_SMTP_FROM: z.string().default(""),
  // Modo de TLS do SMTP, EXPLÍCITO (v1.0):
  //   "true"  → TLS implícito, a conexão já nasce cifrada (porta 465);
  //   "false" → conexão elevada por STARTTLS (porta 587).
  // Ausente = derivada da porta pela convenção universal de SMTP
  // (465 → implícito, qualquer outra → STARTTLS), documentada em
  // `resolveSmtpSecure`. A derivação nunca ENFRAQUECE a conexão: em
  // produção `requireTls` obriga a elevação de qualquer forma, então o
  // pior caso da omissão é um handshake correto, nunca texto em claro.
  //
  // Parsing ESTRITO: apenas "true"/"false" (livres de espaço e caixa).
  // Nada de "1"/"0"/"yes"/"no"/"sim", e nada de tratar texto
  // desconhecido como `false`. Um `INGRESSA_SMTP_SECURE=1` digitado por
  // hábito viraria "STARTTLS" silenciosamente numa caixa que só fala TLS
  // implícito — e o sintoma seria um erro de handshake incompreensível,
  // longe da causa. Recusar no boot troca isso por uma mensagem que
  // nomeia a variável.
  INGRESSA_SMTP_SECURE: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim().length === 0) {
        return undefined;
      }
      const normalizado = value.trim().toLowerCase();
      if (normalizado === "true") {
        return true;
      }
      if (normalizado === "false") {
        return false;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        // Só o NOME da variável e os valores ACEITOS. Nunca o valor
        // recebido: esta variável fica ao lado da senha de SMTP no mesmo
        // arquivo, e um erro de configuração não pode ser o caminho pelo
        // qual um valor daquele bloco aparece num log de boot.
        message:
          "INGRESSA_SMTP_SECURE aceita apenas \"true\" ou \"false\" (ou ausente, para derivar da porta). " +
          "Nenhum outro valor é interpretado — em especial, um valor desconhecido NUNCA vira false."
      });
      return z.NEVER;
    })
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
    // 3. `INVITATION_DELIVERY_MODE=MANUAL_DEV` nunca é aceito em
    //    produção. O modo manual devolve o link do convite para a tela
    //    de quem administra — aceitável enquanto não há SMTP no
    //    ambiente de desenvolvimento, inaceitável como política de
    //    entrega de acesso em produção. Este gate é o "bloqueio
    //    explícito para PRD": configurar SMTP é uma decisão que precisa
    //    ser tomada, nunca contornada por omissão.
    if (env.INVITATION_DELIVERY_MODE === "MANUAL_DEV") {
      throw new Error(
        "Configuração inválida: INVITATION_DELIVERY_MODE=MANUAL_DEV nunca é permitido com NODE_ENV=production — " +
          "configure INVITATION_DELIVERY_MODE=EMAIL e as variáveis INGRESSA_SMTP_*."
      );
    }
  }

  return env;
}
