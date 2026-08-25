import { describe, expect, it } from "vitest";
import { ImportBatch } from "../domain/ImportBatch.js";
import { ImportBatchStatus } from "../domain/value-objects/ImportBatchStatus.js";
import { Fingerprint } from "../domain/value-objects/Fingerprint.js";
import { MappingRulesVersion } from "../domain/value-objects/MappingRulesVersion.js";
import { MappingRulesVersionMismatchError } from "../domain/errors/ImportErrors.js";
import { InvalidImportBatchTransitionError } from "../domain/value-objects/ImportBatchStatus.js";
import { PILOT_MAPPING_RULES_VERSION } from "../domain/pilot/HelpdeskPilotScope.js";

/**
 * Obsolescência do lote planejado sob `helpdesk-v1`.
 *
 * O lote `5fdec8c8-…` do primeiro dry-run continua no banco como
 * evidência histórica. Ele NÃO é apagado e NÃO é reaberto — um lote
 * COMPLETED é terminal por construção. O que o torna inaplicável é a
 * versão das regras: o planner mudou (destino explícito, UPDATE virou
 * QUARANTINE), a versão subiu para `helpdesk-v2`, e `startApply`
 * compara as duas antes de qualquer escrita.
 *
 * Este teste fixa esse comportamento como regressão: enquanto a versão
 * corrente for `v2`, nenhum lote `v1` autoriza apply.
 */
const V1 = "helpdesk-v1";
const FP = Fingerprint.compute({
  mappingRulesVersion: MappingRulesVersion.create(V1),
  records: [{ entityType: "users", legacyId: 35, fields: { active: true } }]
}).toString();

function loteV1Concluido(): ImportBatch {
  return ImportBatch.reconstitute({
    internalId: 1,
    publicId: "5fdec8c8-550f-422e-b405-b10d31857e4f",
    sourceSystem: "PCTEC_HELPDESK",
    mappingRulesVersion: V1,
    snapshotFingerprint: FP,
    scopeFingerprint: FP,
    mode: "DRY_RUN",
    status: "COMPLETED",
    dryRunBatchPublicId: null,
    approvedByIdentityPublicId: null,
    approvedAt: null,
    countsBefore: { identities: 7 },
    countsAfter: { identities: 9 },
    failureReason: null,
    startedAt: new Date("2026-08-25T10:21:39.705Z"),
    finishedAt: new Date("2026-08-25T10:21:39.716Z"),
    createdAt: new Date("2026-08-25T10:21:39.705Z"),
    updatedAt: new Date("2026-08-25T10:21:39.716Z")
  });
}

describe("lote helpdesk-v1 — obsoleto pelas regras, preservado como evidência", () => {
  it("não autoriza apply sob as regras correntes", () => {
    expect(PILOT_MAPPING_RULES_VERSION).toBe("helpdesk-v2");

    expect(() =>
      ImportBatch.startApply({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: PILOT_MAPPING_RULES_VERSION,
        snapshotFingerprint: FP,
        scopeFingerprint: FP,
        countsBefore: {},
        dryRunBatch: loteV1Concluido(),
        approvedByIdentityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec"
      })
    ).toThrow(MappingRulesVersionMismatchError);
  });

  it("a recusa cita as duas versões, para o operador não procurar no lugar errado", () => {
    try {
      ImportBatch.startApply({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: PILOT_MAPPING_RULES_VERSION,
        snapshotFingerprint: FP,
        scopeFingerprint: FP,
        countsBefore: {},
        dryRunBatch: loteV1Concluido(),
        approvedByIdentityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec"
      });
      expect.unreachable("deveria ter recusado");
    } catch (error) {
      expect((error as Error).message).toContain("helpdesk-v1");
      expect((error as Error).message).toContain("helpdesk-v2");
    }
  });

  it("nunca foi aprovado: um dry-run não carrega aprovação", () => {
    const lote = loteV1Concluido();
    expect(lote.getApprovedByIdentityPublicId()).toBeNull();
    expect(lote.getApprovedAt()).toBeNull();
    expect(lote.getMode().isDryRun()).toBe(true);
  });

  it("permanece COMPLETED — o domínio não reabre nem reescreve estado terminal", () => {
    const lote = loteV1Concluido();
    expect(lote.getStatus().isTerminal()).toBe(true);
    expect(() => lote.abort("obsoleto")).toThrow(InvalidImportBatchTransitionError);
    expect(() => lote.fail("obsoleto")).toThrow(InvalidImportBatchTransitionError);
    expect(lote.getStatus().toString()).toBe("COMPLETED");
    expect(ImportBatchStatus.create("COMPLETED").canTransitionTo(ImportBatchStatus.create("ABORTED"))).toBe(false);
  });
});
