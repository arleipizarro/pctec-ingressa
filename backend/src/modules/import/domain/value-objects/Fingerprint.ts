import { createHash } from "node:crypto";
import { DomainError } from "../../../../shared/errors/DomainError.js";

const HEX_64 = /^[0-9a-f]{64}$/;

export class InvalidFingerprintError extends DomainError {
  public readonly code = "FINGERPRINT_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("fingerprint inválido: esperado SHA-256 em hexadecimal minúsculo (64 caracteres).");
  }
}

/**
 * Entrada canônica do cálculo de fingerprint.
 *
 * `records` é a lista de registros que compõem o material hashado. Cada
 * registro é identificado por `(entityType, legacyId)` e traz somente os
 * campos RELEVANTES PARA A DECISÃO do importador — nunca a linha inteira
 * da origem.
 */
export interface FingerprintRecord {
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

export interface FingerprintInput {
  readonly mappingRulesVersion: string;
  readonly records: readonly FingerprintRecord[];
}

/**
 * Identificador do formato do material canônico. Entra no próprio
 * material: se a serialização mudar, os fingerprints mudam junto e um
 * dry-run aprovado sob o formato antigo não autoriza um apply calculado
 * sob o novo — o gate falha fechado, em vez de comparar maçã com
 * laranja.
 */
const CANONICAL_FORMAT = "pctec-ingressa/import-fingerprint/v1";

/**
 * Serializa de forma DETERMINÍSTICA e SEM AMBIGUIDADE.
 *
 * Determinismo: registros ordenados por `entityType` e depois por
 * `legacyId` (como string, para não depender de coerção numérica), e as
 * chaves de cada registro ordenadas alfabeticamente. Duas execuções
 * sobre o mesmo material produzem exatamente a mesma string,
 * independentemente da ordem em que o conector leu as linhas ou de como
 * o driver montou os objetos.
 *
 * Sem ambiguidade: a serialização é JSON, não concatenação com
 * delimitadores. A versão anterior montava `chave=valor` unido por `|`,
 * o que colapsava casos distintos no MESMO material — e este material é
 * o que autoriza o apply (ver `ImportBatch.startApply` /
 * `SourceChangedSinceDryRunError`). Dois exemplos reais que colidiam:
 *
 *   - `{campo: null}` e `{campo: ""}` viravam ambos `campo=`, porque
 *     `String(x ?? "")` apaga a diferença entre ausência e vazio. Um
 *     campo cadastral alternando NULL <-> "" entre o dry-run e o apply
 *     passava como "escopo inalterado".
 *   - `{a: "b|c=d"}` e `{a: "b", c: "d"}` produziam a mesma string,
 *     porque `|` e `=` são dados válidos dentro de um valor e não eram
 *     escapados.
 *
 * O JSON resolve os dois: `null` e `""` têm representações distintas, os
 * tipos (string, número, booleano) são preservados em vez de virarem
 * texto, e aspas/barras dentro de valores são escapadas pelo próprio
 * serializador. Os campos viram uma LISTA DE PARES já ordenada, não um
 * objeto — assim a ordem não depende da ordem de inserção de chaves do
 * runtime.
 *
 * `mappingRulesVersion` entra no material hashado de propósito: a mesma
 * origem, lida sob regras diferentes, é um lote diferente. Aprovar um
 * dry-run de `helpdesk-v1` não pode autorizar um apply de `helpdesk-v2`.
 *
 * O material cobre EXCLUSIVAMENTE os registros recebidos em
 * `input.records`. Quem escolhe o que entra é o chamador: o
 * `scopeFingerprint` recebe só o escopo do lote, e por isso cadastro
 * novo fora do escopo não derruba a aprovação.
 */
function canonicalize(input: FingerprintInput): string {
  const registros = [...input.records]
    .sort((a, b) => {
      const porTipo = a.entityType.localeCompare(b.entityType, "en");
      if (porTipo !== 0) {
        return porTipo;
      }
      return String(a.legacyId).localeCompare(String(b.legacyId), "en");
    })
    .map((record) => {
      const pares = Object.keys(record.fields)
        .sort((a, b) => a.localeCompare(b, "en"))
        .map((chave) => {
          const valor = record.fields[chave];
          // `undefined` (chave presente sem valor) vira null; `null`
          // permanece null e continua distinto de "".
          return [chave, valor === undefined ? null : valor] as const;
        });
      return [record.entityType, String(record.legacyId), pares] as const;
    });

  return JSON.stringify([CANONICAL_FORMAT, input.mappingRulesVersion, registros]);
}

/**
 * Value Object Fingerprint — SHA-256 hexadecimal de um material
 * canônico.
 *
 * Dois fingerprints, dois papéis (ver migration 0020):
 *
 * - `snapshotFingerprint`: tudo que foi lido da origem. Forense.
 * - `scopeFingerprint`: SOMENTE o escopo do lote + os registros
 *   necessários para resolvê-lo + a versão das regras. É o que autoriza
 *   o apply.
 *
 * A separação existe por uma razão prática: o Helpdesk recebe cadastro
 * novo o tempo todo. Se o apply exigisse a base inteira imóvel entre o
 * dry-run e a aprovação, nenhum lote jamais seria aplicado. Um usuário
 * criado em outro cliente não pode derrubar a aprovação de um lote de
 * AFIP — mas mudar o e-mail de alguém DENTRO do lote deve derrubar.
 */
export class Fingerprint {
  private constructor(private readonly value: string) {}

  public static fromString(rawValue: string): Fingerprint {
    const normalizado = rawValue.trim().toLowerCase();
    if (!HEX_64.test(normalizado)) {
      throw new InvalidFingerprintError();
    }
    return new Fingerprint(normalizado);
  }

  /** Calcula o fingerprint a partir do material canônico. */
  public static compute(input: FingerprintInput): Fingerprint {
    const digest = createHash("sha256").update(canonicalize(input), "utf-8").digest("hex");
    return new Fingerprint(digest);
  }

  /** Exposto para teste e diagnóstico — nunca persistido. */
  public static canonicalMaterial(input: FingerprintInput): string {
    return canonicalize(input);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: Fingerprint): boolean {
    return this.value === other.value;
  }
}
