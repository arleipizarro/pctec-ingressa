/**
 * Cerimônia controlada de bootstrap em produção — ADR-027.
 *
 * **Por que não bastou acrescentar "production" a `ALLOWED_NODE_ENVS`.**
 * Os três CLIs de bootstrap criam a primeira Identity, o primeiro acesso
 * ADMIN e a primeira Credential da plataforma inteira. Em
 * desenvolvimento, rodar um deles por engano custa um `DROP DATABASE`.
 * Em produção, custa uma conta administrativa fundacional criada fora de
 * processo, num diretório real, com auditoria dizendo que alguém a
 * criou deliberadamente. A diferença entre os dois ambientes não é de
 * grau — e uma lista de strings não expressa diferença de grau nenhuma.
 *
 * A exceção existe porque o ambiente de produção precisa nascer de
 * alguma forma, e a alternativa que sempre aparece — `INSERT` manual no
 * banco — é estritamente pior: pula o domínio, pula as invariantes, pula
 * a transação e pula a auditoria, deixando uma Identity que o sistema
 * nunca decidiu criar. Melhor um caminho oficial difícil de acionar por
 * acidente do que um caminho não-oficial fácil de acionar por
 * necessidade.
 *
 * Quatro barreiras independentes, todas fail-closed:
 *
 * 1. **Autorização temporária por processo.** A variável
 *    `INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP=YES` precisa existir no
 *    ambiente DAQUELE comando. Ela nunca é escrita no `.env` — se
 *    estivesse lá, deixaria de ser cerimônia e viraria configuração
 *    permanente, exatamente o que esta guarda existe para impedir.
 * 2. **Terminal interativo obrigatório.** Sem TTY, nada roda: elimina o
 *    CLI disparado por script, cron, pipeline ou `ssh host comando`, que
 *    é como um bootstrap acidental acontece de verdade.
 * 3. **Frase de confirmação que nomeia o alvo.** Em produção a frase
 *    inclui `PRODUCTION`, o database e o hostname. Quem digita não pode
 *    confirmar sem ter lido para ONDE está apontando — é a barreira
 *    contra o erro mais provável de todos, que é rodar no servidor certo
 *    com o `.env` do ambiente errado carregado.
 * 4. **Pré-condições de domínio.** Continuam onde sempre estiveram: nos
 *    serviços oficiais, que recusam a segunda Identity, o segundo ADMIN
 *    e a substituição de Credential. Esta guarda não as reimplementa.
 */

export const PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE = "INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP";

/** Valor único aceito. Nada de "1"/"true"/"sim" — um valor só, digitado por inteiro. */
export const PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE = "YES";

const PRODUCTION = "production";
const NON_PRODUCTION_ENVS: ReadonlySet<string> = new Set(["development", "test"]);

export interface ProductionBootstrapContext {
  readonly nodeEnv: string;
  /** Conteúdo de `INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP` — nunca persistido. */
  readonly authorization: string | undefined;
  /** `DB_NAME` efetivo, lido da MESMA configuração que o CLI usará para escrever. */
  readonly databaseName: string;
  readonly hostname: string;
  /**
   * `true` só quando há terminal real. Injetável para que a suíte possa
   * exercitar o caminho de produção sem TTY — o "harness controlado" do
   * ADR-027, que nunca toca banco real.
   */
  readonly interactive: boolean;
}

export type BootstrapCeremony =
  | {
      readonly allowed: true;
      /** Frase EXATA que o operador precisa digitar. */
      readonly confirmationPhrase: string;
      /** Linhas a exibir antes de pedir a confirmação. Vazio fora de produção. */
      readonly preamble: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly exitCode: number;
      readonly message: string;
    };

/**
 * Colapsa espaços internos e apara as pontas. A frase de produção é
 * longa e digitada à mão; recusá-la por um espaço duplo seria rigor sem
 * ganho de segurança — o que precisa coincidir são as PALAVRAS, e em
 * particular o database e o hostname.
 */
export function normalizeConfirmation(input: string): string {
  return input.trim().replace(/\s+/gu, " ");
}

export function buildProductionConfirmationPhrase(
  basePhrase: string,
  databaseName: string,
  hostname: string
): string {
  return normalizeConfirmation(`PRODUCTION ${basePhrase} ${databaseName} ${hostname}`);
}

export function resolveBootstrapCeremony(
  basePhrase: string,
  context: ProductionBootstrapContext
): BootstrapCeremony {
  if (NON_PRODUCTION_ENVS.has(context.nodeEnv)) {
    return { allowed: true, confirmationPhrase: basePhrase, preamble: [] };
  }

  if (context.nodeEnv !== PRODUCTION) {
    return {
      allowed: false,
      exitCode: 2,
      message:
        `Bootstrap recusado: NODE_ENV="${context.nodeEnv}" não é um ambiente reconhecido. ` +
        `Apenas "development", "test" e "production" (este último sob a cerimônia do ADR-027).`
    };
  }

  if (context.authorization !== PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE) {
    return {
      allowed: false,
      exitCode: 2,
      message:
        `Bootstrap em PRODUÇÃO recusado: autorização temporária ausente ou inválida. ` +
        `Exporte ${PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE}=${PRODUCTION_BOOTSTRAP_AUTHORIZATION_VALUE} ` +
        `apenas para este comando — NUNCA no .env, que a tornaria permanente. Ver ADR-027.`
    };
  }

  if (!context.interactive) {
    return {
      allowed: false,
      exitCode: 2,
      message:
        "Bootstrap em PRODUÇÃO recusado: exige terminal interativo (TTY). " +
        "Execução por script, cron, pipeline ou comando remoto não interativo nunca é aceita."
    };
  }

  if (context.databaseName.trim().length === 0 || context.hostname.trim().length === 0) {
    return {
      allowed: false,
      exitCode: 2,
      message:
        "Bootstrap em PRODUÇÃO recusado: não foi possível determinar o database alvo e/ou o hostname. " +
        "A frase de confirmação precisa nomear os dois — sem eles, não há como confirmar o alvo."
    };
  }

  return {
    allowed: true,
    confirmationPhrase: buildProductionConfirmationPhrase(basePhrase, context.databaseName, context.hostname),
    preamble: [
      "*** AMBIENTE DE PRODUÇÃO ***",
      `database alvo: ${context.databaseName}`,
      `hostname:      ${context.hostname}`,
      "Confirme apenas se os dois valores acima são exatamente o alvo pretendido.",
      "Se o database ou o hostname não forem o que você espera, CANCELE: o .env carregado não é o deste servidor."
    ]
  };
}
