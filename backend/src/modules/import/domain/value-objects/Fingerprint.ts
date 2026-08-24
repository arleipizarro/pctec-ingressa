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
 * Serializa de forma DETERMINÍSTICA: registros ordenados por
 * `entityType` e depois por `legacyId` (como string, para não depender
 * de coerção numérica), e as chaves de cada registro ordenadas
 * alfabeticamente. Duas execuções sobre o mesmo material produzem
 * exatamente a mesma string, independentemente da ordem em que o
 * conector leu as linhas ou de como o driver montou os objetos.
 *
 * `mappingRulesVersion` entra no material hashado de propósito: a mesma
 * origem, lida sob regras diferentes, é um lote diferente. Aprovar um
 * dry-run de `helpdesk-v1` não pode autorizar um apply de `helpdesk-v2`.
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
      const chaves = Object.keys(record.fields).sort((a, b) => a.localeCompare(b, "en"));
      const campos = chaves.map((chave) => `${chave}=${String(record.fields[chave] ?? "")}`).join("|");
      return `${record.entityType}#${String(record.legacyId)}{${campos}}`;
    });

  return `rules=${input.mappingRulesVersion}\n${registros.join("\n")}`;
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
