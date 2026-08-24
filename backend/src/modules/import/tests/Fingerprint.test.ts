import { describe, expect, it } from "vitest";
import { Fingerprint, InvalidFingerprintError, type FingerprintRecord } from "../domain/value-objects/Fingerprint.js";
import { MappingRulesVersion } from "../domain/value-objects/MappingRulesVersion.js";

const REGRAS = "helpdesk-v1";

/** Escopo do lote piloto: os dois usuários company-only da Bosque. */
const ESCOPO: readonly FingerprintRecord[] = [
  { entityType: "users", legacyId: 35, fields: { role: "cliente", active: 1, client_id: 75 } },
  { entityType: "users", legacyId: 44, fields: { role: "cliente", active: 1, client_id: 75 } },
  { entityType: "clients", legacyId: 75, fields: { active: 1 } }
];

const fp = (records: readonly FingerprintRecord[], rules = REGRAS): string =>
  Fingerprint.compute({ mappingRulesVersion: MappingRulesVersion.create(rules), records }).toString();

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
    //
    // O que este teste prova: o scopeFingerprint é função EXCLUSIVA da
    // lista de escopo. Simulamos o mundo mudando ao redor — a base
    // "depois" tem um usuário a mais, de outro cliente — e recalculamos
    // o escopo a partir dessa base nova. O escopo em si não mudou, logo
    // o fingerprint não pode mudar.
    const baseAntes: readonly FingerprintRecord[] = ESCOPO;
    const baseDepois: readonly FingerprintRecord[] = [
      ...ESCOPO,
      { entityType: "users", legacyId: 200, fields: { role: "cliente", active: 1, client_id: 13 } }
    ];

    // Recorte do escopo do lote (clientes 75) sobre cada base.
    const soDoEscopo = (base: readonly FingerprintRecord[]): readonly FingerprintRecord[] =>
      base.filter((r) => r.fields["client_id"] === 75 || (r.entityType === "clients" && r.legacyId === 75));

    const escopoAntes = fp(soDoEscopo(baseAntes));
    const escopoDepois = fp(soDoEscopo(baseDepois));

    // 1. O recorte "depois" é de fato calculado sobre uma base maior...
    expect(baseDepois.length).toBeGreaterThan(baseAntes.length);
    // 2. ...mas o escopo recortado é o mesmo, e o fingerprint também.
    expect(escopoDepois).toBe(escopoAntes);
    // 3. Se o registro de fora TIVESSE entrado no material, o hash mudaria
    //    — é isso que torna o item 2 uma afirmação com conteúdo.
    expect(fp(baseDepois)).not.toBe(escopoAntes);
  });

  it("mudança DENTRO do escopo muda o fingerprint (contraprova do teste acima)", () => {
    const escopoAntes = fp(ESCOPO);
    const escopoAlterado: readonly FingerprintRecord[] = [
      { entityType: "users", legacyId: 35, fields: { role: "cliente", active: 0, client_id: 75 } },
      ESCOPO[1] as FingerprintRecord,
      ESCOPO[2] as FingerprintRecord
    ];
    expect(fp(escopoAlterado)).not.toBe(escopoAntes);
  });

  it("snapshotFingerprint e scopeFingerprint são independentes", () => {
    const snapshotAmplo = fp([
      ...ESCOPO,
      { entityType: "users", legacyId: 200, fields: { role: "cliente", active: 1, client_id: 13 } }
    ]);
    expect(snapshotAmplo).not.toBe(fp(ESCOPO));
  });
});

describe("Fingerprint — serialização inequívoca (regressões de colisão)", () => {
  // A versão anterior montava `chave=valor` unido por `|`, e o material
  // é o que autoriza o apply. Cada caso abaixo colidia.

  it("null e string vazia produzem fingerprints DIFERENTES", () => {
    const comNull = fp([{ entityType: "users", legacyId: 1, fields: { email: null } }]);
    const comVazio = fp([{ entityType: "users", legacyId: 1, fields: { email: "" } }]);
    expect(comNull).not.toBe(comVazio);
  });

  it("null e string vazia continuam cada um determinístico", () => {
    const a = fp([{ entityType: "users", legacyId: 1, fields: { email: null } }]);
    const b = fp([{ entityType: "users", legacyId: 1, fields: { email: null } }]);
    expect(a).toBe(b);
  });

  it("valor contendo os antigos separadores não colide com outra estrutura de campos", () => {
    // `{a: "b|c=d"}` versus `{a: "b", c: "d"}` — na concatenação antiga
    // os dois viravam a mesma string.
    const umCampo = fp([{ entityType: "users", legacyId: 1, fields: { a: "b|c=d" } }]);
    const doisCampos = fp([{ entityType: "users", legacyId: 1, fields: { a: "b", c: "d" } }]);
    expect(umCampo).not.toBe(doisCampos);
  });

  it("valor contendo aspas e barra é escapado sem colidir", () => {
    const comAspas = fp([{ entityType: "users", legacyId: 1, fields: { nome: 'a"b' } }]);
    const comBarra = fp([{ entityType: "users", legacyId: 1, fields: { nome: "a\\b" } }]);
    expect(comAspas).not.toBe(comBarra);
    expect(comAspas).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tipos são preservados — número 1 não colide com string \"1\", nem booleano com texto", () => {
    const numero = fp([{ entityType: "users", legacyId: 1, fields: { active: 1 } }]);
    const texto = fp([{ entityType: "users", legacyId: 1, fields: { active: "1" } }]);
    const booleano = fp([{ entityType: "users", legacyId: 1, fields: { active: true } }]);
    expect(new Set([numero, texto, booleano]).size).toBe(3);
  });

  it("ordem das chaves não altera o hash, mas trocar valores entre chaves altera", () => {
    const ordemA = fp([{ entityType: "users", legacyId: 1, fields: { a: "x", b: "y" } }]);
    const ordemB = fp([{ entityType: "users", legacyId: 1, fields: { b: "y", a: "x" } }]);
    const trocado = fp([{ entityType: "users", legacyId: 1, fields: { a: "y", b: "x" } }]);
    expect(ordemA).toBe(ordemB);
    expect(trocado).not.toBe(ordemA);
  });

  it("legacyId numérico e string são o mesmo registro (normalização explícita)", () => {
    const numerico = fp([{ entityType: "users", legacyId: 35, fields: { a: 1 } }]);
    const textual = fp([{ entityType: "users", legacyId: "35", fields: { a: 1 } }]);
    expect(numerico).toBe(textual);
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

  it("material canônico inclui a versão das regras e o identificador de formato", () => {
    const material = Fingerprint.canonicalMaterial({ mappingRulesVersion: MappingRulesVersion.create(REGRAS), records: ESCOPO });
    expect(material).toContain(REGRAS);
    expect(material).toContain("pctec-ingressa/import-fingerprint/v1");
  });

  it("material canônico é JSON válido — serialização inequívoca, não concatenação", () => {
    const material = Fingerprint.canonicalMaterial({ mappingRulesVersion: MappingRulesVersion.create(REGRAS), records: ESCOPO });
    expect(() => JSON.parse(material)).not.toThrow();
    const [formato, regras] = JSON.parse(material) as [string, string, unknown];
    expect(formato).toBe("pctec-ingressa/import-fingerprint/v1");
    expect(regras).toBe(REGRAS);
  });
});

/**
 * O material canônico e a comparação de versão feita por
 * `ImportBatch.startApply` precisam enxergar EXATAMENTE o mesmo valor.
 * Enquanto o campo era `string` crua, não enxergavam: o VO normalizava
 * (`trim` + `toLowerCase`), o hash não. Dry-run com `helpdesk-v1` e apply
 * com `HELPDESK-V1` passavam na checagem de versão e falhavam na de
 * fingerprint, e o operador recebia "a origem mudou" para dado que não
 * mudou.
 */
describe("Fingerprint — versão das regras entra normalizada", () => {
  it("caixa diferente, mesma versão canônica: mesmo fingerprint", () => {
    expect(fp(ESCOPO, "HELPDESK-V1")).toBe(fp(ESCOPO, "helpdesk-v1"));
  });

  it("espaços em volta não alteram o fingerprint", () => {
    expect(fp(ESCOPO, "  helpdesk-v1  ")).toBe(fp(ESCOPO, "helpdesk-v1"));
    expect(fp(ESCOPO, " HELPDESK-V1 ")).toBe(fp(ESCOPO, "helpdesk-v1"));
  });

  it("versão semanticamente diferente continua produzindo fingerprint diferente", () => {
    // Contraprova: a normalização não pode colapsar versões distintas —
    // é justamente por isso que a versão entra no material.
    expect(fp(ESCOPO, "helpdesk-v2")).not.toBe(fp(ESCOPO, "helpdesk-v1"));
    expect(fp(ESCOPO, "HELPDESK-V2")).not.toBe(fp(ESCOPO, "helpdesk-v1"));
  });

  it("o material canônico carrega o valor normalizado, nunca o texto cru", () => {
    const material = Fingerprint.canonicalMaterial({
      mappingRulesVersion: MappingRulesVersion.create(" HELPDESK-V1 "),
      records: ESCOPO
    });
    const [, regras] = JSON.parse(material) as [string, string, unknown];
    expect(regras).toBe("helpdesk-v1");
  });
});
