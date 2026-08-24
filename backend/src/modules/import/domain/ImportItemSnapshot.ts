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
  "private_key"
];

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

  public toJSON(): Readonly<Record<string, SnapshotValue>> {
    return { ...this.fields };
  }

  public isEmpty(): boolean {
    return Object.keys(this.fields).length === 0;
  }
}
