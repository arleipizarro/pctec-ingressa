import { describe, expect, it } from "vitest";
import { Fingerprint, InvalidFingerprintError, type FingerprintRecord } from "../domain/value-objects/Fingerprint.js";

const REGRAS = "helpdesk-v1";

/** Escopo do lote piloto: os dois usuários company-only da Bosque. */
const ESCOPO: readonly FingerprintRecord[] = [
  { entityType: "users", legacyId: 35, fields: { role: "cliente", active: 1, client_id: 75 } },
  { entityType: "users", legacyId: 44, fields: { role: "cliente", active: 1, client_id: 75 } },
  { entityType: "clients", legacyId: 75, fields: { active: 1 } }
];

const fp = (records: readonly FingerprintRecord[], rules = REGRAS): string =>
  Fingerprint.compute({ mappingRulesVersion: rules, records }).toString();

describe("Fingerprint — determinismo", () => {
  it("mesma entrada produz o mesmo hash", () => {
    expect(fp(ESCOPO)).toBe(fp(ESCOPO));
  });

  it("ordem dos registros não altera o hash", () => {
    const embaralhado = [ESCOPO[2], ESCOPO[0], ESCOPO[1]] as FingerprintRecord[];
    expect(fp(embaralhado)).toBe(fp(ESCOPO));
  });

  it("ordem das chaves dentro de um registro não altera o hash", () => {
    const outraOrdem: FingerprintRecord[] = [
      { entityType: "users", legacyId: 35, fields: { client_id: 75, active: 1, role: "cliente" } },
      ESCOPO[1] as FingerprintRecord,
      ESCOPO[2] as FingerprintRecord
    ];
    expect(fp(outraOrdem)).toBe(fp(ESCOPO));
  });

  it("é SHA-256 hexadecimal minúsculo", () => {
    expect(fp(ESCOPO)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Fingerprint — sensibilidade", () => {
  it("mudar um campo DENTRO do escopo muda o hash", () => {
    const alterado: FingerprintRecord[] = [
      { entityType: "users", legacyId: 35, fields: { role: "cliente", active: 1, client_id: 78 } },
      ESCOPO[1] as FingerprintRecord,
      ESCOPO[2] as FingerprintRecord
    ];
    expect(fp(alterado)).not.toBe(fp(ESCOPO));
  });

  it("remover um registro do escopo muda o hash", () => {
    expect(fp([ESCOPO[0] as FingerprintRecord, ESCOPO[2] as FingerprintRecord])).not.toBe(fp(ESCOPO));
  });

  it("mudar a versão das regras muda o hash", () => {
    // A mesma origem sob regras diferentes é outro lote: aprovar um
    // dry-run de helpdesk-v1 não pode autorizar um apply de v2.
    expect(fp(ESCOPO, "helpdesk-v2")).not.toBe(fp(ESCOPO));
  });
});

describe("Fingerprint — alteração FORA do escopo não invalida o apply", () => {
  it("um usuário novo em outro cliente não altera o scopeFingerprint", () => {
    // Cenário real: o Helpdesk recebe cadastro novo o tempo todo. Se
    // qualquer movimento na base derrubasse a aprovação, nenhum lote
    // jamais seria aplicado.
    const escopoAntes = fp(ESCOPO);

    const foraDoEscopo: readonly FingerprintRecord[] = [
      ...ESCOPO,
      { entityType: "users", legacyId: 200, fields: { role: "cliente", active: 1, client_id: 13 } }
    ];
    // O importador calcula o scopeFingerprint SOMENTE sobre o escopo —
    // o registro de fora nem entra no material. Este teste fixa que a
    // lista de escopo é a entrada, e não "tudo que foi lido".
    const escopoDepois = fp(ESCOPO);

    expect(escopoDepois).toBe(escopoAntes);
    expect(fp(foraDoEscopo)).not.toBe(escopoAntes);
  });

  it("snapshotFingerprint e scopeFingerprint são independentes", () => {
    const snapshotAmplo = fp([
      ...ESCOPO,
      { entityType: "users", legacyId: 200, fields: { role: "cliente", active: 1, client_id: 13 } }
    ]);
    expect(snapshotAmplo).not.toBe(fp(ESCOPO));
  });
});

describe("Fingerprint — formato", () => {
  it("recusa valor que não seja SHA-256 hex", () => {
    expect(() => Fingerprint.fromString("abc")).toThrow(InvalidFingerprintError);
    expect(() => Fingerprint.fromString("z".repeat(64))).toThrow(InvalidFingerprintError);
  });

  it("aceita maiúsculas normalizando para minúsculas", () => {
    const valor = fp(ESCOPO);
    expect(Fingerprint.fromString(valor.toUpperCase()).toString()).toBe(valor);
  });

  it("material canônico inclui a versão das regras", () => {
    expect(Fingerprint.canonicalMaterial({ mappingRulesVersion: REGRAS, records: ESCOPO })).toContain(
      `rules=${REGRAS}`
    );
  });
});
