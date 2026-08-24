import { DomainError } from "../../../shared/errors/DomainError.js";

export type SnapshotValue = string | number | boolean | null;

export class ForbiddenSnapshotFieldError extends DomainError {
  public readonly code = "IMPORT_SNAPSHOT_FIELD_FORBIDDEN";
  public readonly classification = "VALIDATION" as const;

  constructor(field: string) {
    super(
      `Campo "${field}" não pode entrar em snapshot de importação. ` +
        "Senha, hash, token, segredo e registro bruto da origem nunca são persistidos."
    );
  }
}

/**
 * Campos que NUNCA podem ser gravados num snapshot, qualquer que seja a
 * whitelist do chamador. É a última linha de defesa, não a primeira: o
 * caminho normal é o chamador montar o objeto campo a campo.
 *
 * A lista cobre os nomes reais das colunas sensíveis observadas na
 * auditoria do Helpdesk (`users.password`, `users.reset_token`,
 * `users.reset_expires`, `usuarios.password`,
 * `usuarios.senha_temporaria`) e os nomes genéricos equivalentes.
 */
const DENYLIST_EXATA: ReadonlySet<string> = new Set([
  "password",
  "senha",
  "senha_temporaria",
  "password_hash",
  "passwordhash",
  "hash",
  "salt",
  "token",
  "reset_token",
  "resettoken",
  "reset_expires",
  "refresh_token",
  "access_token",
  "secret",
  "credential",
  "credentials",
  "api_key",
  "apikey",
  "private_key",
  "authorization"
]);

/**
 * Fragmentos que reprovam por conterem — pega variações não previstas
 * (`user_password`, `helpdeskToken`, `senhaProvisoria`).
 *
 * `hash`, `salt` e `authorization` estavam SÓ na lista exata, o que
 * deixava passar exatamente as variações que esta lista existe para
 * pegar: `bcrypt_hash`, `md5_hash`, `user_hash`, `auth_salt`,
 * `authorization_header`. Note que `password_hash` era barrado por
 * acidente, pelo fragmento `password` — tirar `password` da lista teria
 * liberado toda a família `_hash` de uma vez.
 *
 * O custo é assumido: `salt` também barra um campo hipotético `salto` e
 * `hash` barraria `hashtag`. Nenhum dos dois existe no domínio de
 * cadastro que este importador lê, e a regra da casa é clara — falso
 * positivo se resolve renomeando o campo do snapshot; falso negativo
 * grava segredo em tabela de auditoria, de onde não sai mais.
 */
const DENYLIST_FRAGMENTO: readonly string[] = [
  "password",
  "passwd",
  "senha",
  "secret",
  "token",
  "credential",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "hash",
  "salt",
  "authorization"
];

/**
 * Valor devolvido no lugar de um campo que a política atual reprova.
 * Constante — a saída redigida precisa ser determinística.
 */
export const REDACTED_MARKER = "[REDIGIDO]";

function normalizar(field: string): string {
  return field.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * `true` quando o nome do campo é proibido em snapshot.
 *
 * Deliberadamente conservador: prefere reprovar um campo inocente a
 * deixar passar um sensível. Um falso positivo é resolvido renomeando o
 * campo do snapshot; um falso negativo grava segredo em tabela de
 * auditoria, de onde não sai mais.
 */
export function isForbiddenSnapshotField(field: string): boolean {
  const normalizado = normalizar(field);
  if (DENYLIST_EXATA.has(normalizado)) {
    return true;
  }
  const semUnderscore = normalizado.replace(/_/g, "");
  return DENYLIST_FRAGMENTO.some(
    (fragmento) => normalizado.includes(fragmento) || semUnderscore.includes(fragmento.replace(/_/g, ""))
  );
}

/**
 * Snapshot sanitizado de um item de importação.
 *
 * **Não é um `Record` qualquer serializado.** É construído campo a campo
 * a partir de uma whitelist, e cada campo passa pela denylist antes de
 * entrar. A razão é concreta: a tabela `users` do Helpdesk tem
 * `password`, `reset_token` e `reset_expires` na MESMA linha dos dados
 * de cadastro. Um `{...row}` traria os três junto para dentro de
 * `import_batch_items`, e a partir daí para dentro de qualquer relatório.
 *
 * Mesmo princípio que impediu id legado de vazar no Portal: montar
 * objeto novo em vez de espalhar o de origem.
 */
export class ImportItemSnapshot {
  private constructor(private readonly fields: Readonly<Record<string, SnapshotValue>>) {}

  /**
   * Monta o snapshot a partir de uma whitelist explícita de campos.
   *
   * @param allowedFields nomes de campo que o chamador declara permitidos
   * @param source objeto de origem — só as chaves da whitelist são lidas
   */
  public static fromWhitelist(
    allowedFields: readonly string[],
    source: Readonly<Record<string, unknown>>
  ): ImportItemSnapshot {
    const resultado: Record<string, SnapshotValue> = {};

    for (const field of allowedFields) {
      if (isForbiddenSnapshotField(field)) {
        throw new ForbiddenSnapshotFieldError(field);
      }
      if (!Object.hasOwn(source, field)) {
        continue;
      }
      resultado[field] = ImportItemSnapshot.coerce(source[field]);
    }

    return new ImportItemSnapshot(resultado);
  }

  /**
   * Reconstrói um snapshot JÁ PERSISTIDO, sem reaplicar a denylist.
   *
   * As três responsabilidades são deliberadamente distintas:
   *
   *   1. ESCRITA (`fromWhitelist`) — recusa o que a política ATUAL
   *      proíbe. É aqui, e só aqui, que a denylist decide o que pode
   *      entrar na trilha.
   *   2. PERSISTÊNCIA/RECONSTITUIÇÃO (este método) — interpreta de forma
   *      ESTÁVEL um registro que já foi aceito e gravado. Não consulta a
   *      denylist: os bytes já estão no banco, e reprovar na leitura não
   *      desfaz nada — só impede de ler.
   *   3. SAÍDA (`toRedactedJSON`) — nunca expõe um campo que HOJE é
   *      sensível, independentemente de quando a linha foi escrita.
   *
   * Por que separar: reaplicar a denylist na leitura acopla a validade
   * de dado histórico ao estado corrente de uma lista mutável. Bastaria
   * endurecer a denylist (exatamente o que esta entrega acabou de fazer,
   * acrescentando `hash`/`salt`/`authorization`) para que toda linha
   * antiga com um campo recém-proibido passasse a estourar na leitura —
   * e, como `GetImportBatchReportService` monta a página inteira num
   * `.map`, UMA linha derrubaria o relatório todo. A trilha de auditoria
   * existe para ser lida justamente quando algo deu errado; ela não pode
   * ficar ilegível por causa de uma política que mudou depois.
   */
  public static fromPersistedRecord(source: Readonly<Record<string, unknown>>): ImportItemSnapshot {
    const resultado: Record<string, SnapshotValue> = {};
    for (const field of Object.keys(source)) {
      resultado[field] = ImportItemSnapshot.coerce(source[field]);
    }
    return new ImportItemSnapshot(resultado);
  }

  /**
   * Valores complexos (objeto, array, função) são reduzidos a `null`:
   * um snapshot é um resumo plano de campos escalares, e aceitar
   * estrutura aninhada reabriria a porta para o registro bruto entrar
   * inteiro por uma chave permitida.
   */
  private static coerce(value: unknown): SnapshotValue {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return null;
  }

  /**
   * Representação crua — usada na persistência e no round-trip. NÃO deve
   * ser servida a um relatório: use `toRedactedJSON`.
   */
  public toJSON(): Readonly<Record<string, SnapshotValue>> {
    return { ...this.fields };
  }

  /**
   * Visão de SAÍDA: qualquer campo que a política ATUAL considere
   * sensível tem o valor substituído por um marcador fixo, e o NOME (só
   * o nome) é devolvido em `redactedFields` para registro.
   *
   * Redigir em vez de omitir é deliberado: omitir faria o campo sumir do
   * relatório sem deixar rastro, e quem audita precisa saber que havia
   * ali um campo que a política de hoje reprova — é sinal de que aquela
   * linha foi escrita sob regra mais frouxa e merece atenção. O marcador
   * é constante, então a saída continua determinística.
   *
   * Nunca devolve o valor sensível, em nenhuma circunstância.
   */
  public toRedactedJSON(): {
    readonly fields: Readonly<Record<string, SnapshotValue>>;
    readonly redactedFields: readonly string[];
  } {
    const visiveis: Record<string, SnapshotValue> = {};
    const redigidos: string[] = [];

    for (const field of Object.keys(this.fields).sort((a, b) => a.localeCompare(b, "en"))) {
      if (isForbiddenSnapshotField(field)) {
        visiveis[field] = REDACTED_MARKER;
        redigidos.push(field);
        continue;
      }
      visiveis[field] = this.fields[field] ?? null;
    }

    return { fields: visiveis, redactedFields: redigidos };
  }

  public isEmpty(): boolean {
    return Object.keys(this.fields).length === 0;
  }
}
