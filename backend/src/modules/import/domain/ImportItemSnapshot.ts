import { DomainError } from "../../../shared/errors/DomainError.js";
import { REDACTED_MARKER, isForbiddenSnapshotField } from "../../../shared/security/redactionPolicy.js";

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
 * A política de redação mora em `shared/security/redactionPolicy.ts`
 * desde a tela de auditoria (v0.11.x): a mesma pergunta — "este nome de
 * campo pode ser exibido?" — passou a ser feita também pelo contexto
 * `audit`, e duas cópias divergiriam no primeiro nome acrescentado de um
 * lado só.
 *
 * Reexportados aqui para não quebrar quem já importava deste módulo.
 */
export { REDACTED_MARKER, isForbiddenSnapshotField } from "../../../shared/security/redactionPolicy.js";

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
