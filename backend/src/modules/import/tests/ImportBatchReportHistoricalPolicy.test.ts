import { describe, expect, it } from "vitest";
import { GetImportBatchReportService } from "../application/GetImportBatchReportService.js";
import { ImportBatch } from "../domain/ImportBatch.js";
import { ImportBatchItem } from "../domain/ImportBatchItem.js";
import { REDACTED_MARKER } from "../domain/ImportItemSnapshot.js";
import { Fingerprint } from "../domain/value-objects/Fingerprint.js";
import { MappingRulesVersion } from "../domain/value-objects/MappingRulesVersion.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportBatchItemPage, ImportBatchItemRepository } from "../domain/ImportBatchItemRepository.js";
import type { Queryable } from "../../../shared/database/Queryable.js";

const REGRAS = "helpdesk-v1";
const FP = Fingerprint.compute({
  mappingRulesVersion: MappingRulesVersion.create(REGRAS),
  records: [{ entityType: "users", legacyId: 35, fields: { active: 1 } }]
}).toString();
const LOTE = "0f4d1c22-1111-4a2b-9c3d-000000000001";

// Valor sintético — nenhum dado real de origem é lido neste teste.
const VALOR_SENSIVEL_SINTETICO = "valor-sintetico-que-nao-pode-vazar";

const lote = ImportBatch.reconstitute({
  internalId: 1,
  publicId: LOTE,
  sourceSystem: "PCTEC_HELPDESK",
  mappingRulesVersion: REGRAS,
  snapshotFingerprint: FP,
  scopeFingerprint: FP,
  mode: "DRY_RUN",
  status: "COMPLETED",
  dryRunBatchPublicId: null,
  approvedByIdentityPublicId: null,
  approvedAt: null,
  countsBefore: {},
  countsAfter: { identities: 3 },
  failureReason: null,
  startedAt: new Date("2026-08-01T00:00:00.000Z"),
  finishedAt: new Date("2026-08-01T00:01:00.000Z"),
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:01:00.000Z")
});

/**
 * Linha gravada sob política ANTIGA — quando `bcrypt_hash` ainda passava
 * pela denylist. É exatamente o que sobra no banco depois de a política
 * ser endurecida.
 */
function itemHistorico(indice: number): ImportBatchItem {
  return ImportBatchItem.reconstitute({
    internalId: indice,
    publicId: `aaaaaaaa-0000-4000-8000-00000000000${indice}`,
    batchPublicId: LOTE,
    entityKind: "IDENTITY",
    sourceEntityType: "users",
    sourceLegacyId: 900 + indice,
    action: "CREATE",
    targetPublicId: null,
    beforeSnapshot: null,
    afterSnapshot: { id: 900 + indice, name: "Fulano Sintético", bcrypt_hash: VALOR_SENSIVEL_SINTETICO },
    reasonCode: null,
    errorMessage: null,
    createdAt: new Date("2026-08-01T00:00:30.000Z")
  });
}

function itemNormal(indice: number): ImportBatchItem {
  return ImportBatchItem.reconstitute({
    internalId: indice,
    publicId: `bbbbbbbb-0000-4000-8000-00000000000${indice}`,
    batchPublicId: LOTE,
    entityKind: "IDENTITY",
    sourceEntityType: "users",
    sourceLegacyId: 800 + indice,
    action: "CREATE",
    targetPublicId: null,
    beforeSnapshot: null,
    afterSnapshot: { id: 800 + indice, name: "Beltrano Sintético", email: "sintetico@example.invalid" },
    reasonCode: null,
    errorMessage: null,
    createdAt: new Date("2026-08-01T00:00:40.000Z")
  });
}

function servicoCom(items: readonly ImportBatchItem[]): GetImportBatchReportService {
  const batchRepository: ImportBatchRepository = {
    insert: async () => {},
    updateOutcome: async () => {},
    findByPublicId: async () => lote,
    findRunningBySourceSystem: async () => undefined
  };
  const itemRepository: ImportBatchItemRepository = {
    insert: async () => {},
    insertMany: async () => {},
    list: async (): Promise<ImportBatchItemPage> => ({ items: [...items], total: items.length, limit: 50, offset: 0 }),
    countByAction: async () => ({ CREATE: items.length }),
    findProcessedSourceKeys: async () => new Set<string>()
  } as unknown as ImportBatchItemRepository;

  return new GetImportBatchReportService({} as Queryable, () => batchRepository, () => itemRepository);
}

/**
 * Linha histórica com ESTRUTURA ANINHADA carregando um segredo numa
 * chave interna. A denylist só olha nomes de primeiro nível — `perfil` é
 * inocente —, então a proteção aqui é o colapso de `coerce`. Este teste
 * fecha o ciclo pelo relatório: nem a reconstituição estoura, nem o
 * segredo chega à resposta.
 */
const SEGREDO_ANINHADO = "SEGREDO-ANINHADO-SINTETICO";

function itemComAninhado(indice: number): ImportBatchItem {
  return ImportBatchItem.reconstitute({
    internalId: indice,
    publicId: `cccccccc-0000-4000-8000-00000000000${indice}`,
    batchPublicId: LOTE,
    entityKind: "IDENTITY",
    sourceEntityType: "users",
    sourceLegacyId: 700 + indice,
    action: "CREATE",
    targetPublicId: null,
    beforeSnapshot: null,
    afterSnapshot: {
      id: 700 + indice,
      name: "Sicrano Sintético",
      perfil: { password: SEGREDO_ANINHADO },
      tags: [SEGREDO_ANINHADO]
    },
    reasonCode: null,
    errorMessage: null,
    createdAt: new Date("2026-08-01T00:00:50.000Z")
  });
}

describe("relatório — snapshot histórico com estrutura aninhada", () => {
  it("a página não cai e o segredo aninhado não aparece na resposta", async () => {
    const relatorio = await servicoCom([itemNormal(1), itemComAninhado(2)]).execute({ batchPublicId: LOTE });

    expect(relatorio.items).toHaveLength(2);
    expect(JSON.stringify(relatorio)).not.toContain(SEGREDO_ANINHADO);
  });

  it("o campo aninhado chega como null — valor destruído, não mascarado", async () => {
    const relatorio = await servicoCom([itemComAninhado(2)]).execute({ batchPublicId: LOTE });
    const item = relatorio.items[0];

    expect(item?.after?.["perfil"]).toBeNull();
    expect(item?.after?.["tags"]).toBeNull();
    expect(item?.after?.["name"]).toBe("Sicrano Sintético");
  });
});

describe("relatório — snapshot histórico com campo que passou a ser proibido", () => {
  it("a página inteira NÃO cai por causa de uma linha antiga", async () => {
    const relatorio = await servicoCom([itemNormal(1), itemHistorico(2), itemNormal(3)]).execute({
      batchPublicId: LOTE
    });

    expect(relatorio.items).toHaveLength(3);
    expect(relatorio.total).toBe(3);
  });

  it("o valor sensível NUNCA aparece na resposta, em nenhuma chave", async () => {
    const relatorio = await servicoCom([itemNormal(1), itemHistorico(2)]).execute({ batchPublicId: LOTE });
    expect(JSON.stringify(relatorio)).not.toContain(VALOR_SENSIVEL_SINTETICO);
  });

  it("o campo é redigido de forma determinística e registrado só pelo NOME", async () => {
    const relatorio = await servicoCom([itemHistorico(2)]).execute({ batchPublicId: LOTE });
    const item = relatorio.items[0];

    expect(item?.redactedFields).toEqual(["bcrypt_hash"]);
    expect(item?.after?.["bcrypt_hash"]).toBe(REDACTED_MARKER);
  });

  it("os campos legítimos da MESMA linha continuam legíveis", async () => {
    const relatorio = await servicoCom([itemHistorico(2)]).execute({ batchPublicId: LOTE });
    const item = relatorio.items[0];

    expect(item?.after?.["id"]).toBe(902);
    expect(item?.after?.["name"]).toBe("Fulano Sintético");
  });

  it("linhas sem campo sensível saem com redactedFields vazio", async () => {
    const relatorio = await servicoCom([itemNormal(1)]).execute({ batchPublicId: LOTE });
    const item = relatorio.items[0];

    expect(item?.redactedFields).toEqual([]);
    expect(item?.after?.["email"]).toBe("sintetico@example.invalid");
  });

  it("a paginação continua íntegra — limit/offset preservados", async () => {
    const relatorio = await servicoCom([itemHistorico(2)]).execute({ batchPublicId: LOTE, limit: 50, offset: 0 });
    expect(relatorio.limit).toBe(50);
    expect(relatorio.offset).toBe(0);
  });
});
