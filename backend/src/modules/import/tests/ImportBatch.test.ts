import { describe, expect, it } from "vitest";
import { ImportBatch } from "../domain/ImportBatch.js";
import { Fingerprint } from "../domain/value-objects/Fingerprint.js";
import { InvalidImportBatchTransitionError } from "../domain/value-objects/ImportBatchStatus.js";
import {
  ApplyWithoutDryRunError,
  DryRunBatchNotCompletedError,
  DryRunModeMismatchError,
  MappingRulesVersionMismatchError,
  SourceChangedSinceDryRunError,
  SourceSystemMismatchError,
  UnapprovedApplyError
} from "../domain/errors/ImportErrors.js";

const REGRAS = "helpdesk-v1";
const APROVADOR = "11111111-2222-3333-4444-555555555555";

const escopo = (records: Parameters<typeof Fingerprint.compute>[0]["records"]): string =>
  Fingerprint.compute({ mappingRulesVersion: REGRAS, records }).toString();

const ESCOPO_AFIP = escopo([
  { entityType: "users", legacyId: 35, fields: { active: 1, client_id: 75, role: "cliente" } },
  { entityType: "users", legacyId: 44, fields: { active: 1, client_id: 75, role: "cliente" } }
]);
const SNAPSHOT = escopo([{ entityType: "users", legacyId: 999, fields: { total: 170 } }]);

function novoDryRunConcluido(scopeFingerprint = ESCOPO_AFIP): ImportBatch {
  const batch = ImportBatch.startDryRun({
    sourceSystem: "PCTEC_HELPDESK",
    mappingRulesVersion: REGRAS,
    snapshotFingerprint: SNAPSHOT,
    scopeFingerprint,
    countsBefore: { identities: 7 }
  });
  batch.complete({ identities: 7 });
  return batch;
}

describe("ImportBatch — abertura", () => {
  it("dry-run nasce RUNNING, sem aprovação e sem lote de origem", () => {
    const batch = ImportBatch.startDryRun({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: SNAPSHOT,
      scopeFingerprint: ESCOPO_AFIP,
      countsBefore: { identities: 7 }
    });

    expect(batch.getMode().toString()).toBe("DRY_RUN");
    expect(batch.getStatus().toString()).toBe("RUNNING");
    expect(batch.getDryRunBatchPublicId()).toBeNull();
    expect(batch.getApprovedByIdentityPublicId()).toBeNull();
    expect(batch.getCountsAfter()).toBeNull();
  });

  it("apply válido referencia o dry-run e registra a aprovação", () => {
    const dryRun = novoDryRunConcluido();
    const apply = ImportBatch.startApply({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: SNAPSHOT,
      scopeFingerprint: ESCOPO_AFIP,
      countsBefore: { identities: 7 },
      dryRunBatch: dryRun,
      approvedByIdentityPublicId: APROVADOR
    });

    expect(apply.getMode().toString()).toBe("APPLY");
    expect(apply.getDryRunBatchPublicId()).toBe(dryRun.getPublicId());
    expect(apply.getApprovedByIdentityPublicId()).toBe(APROVADOR);
    expect(apply.getApprovedAt()).not.toBeNull();
    apply.assertApplyIsApproved();
  });
});

describe("ImportBatch — apply é recusado sem as garantias", () => {
  it("sem dry-run informado", () => {
    expect(() => ImportBatch.assertDryRunProvided(null)).toThrow(ApplyWithoutDryRunError);
    expect(() => ImportBatch.assertDryRunProvided("   ")).toThrow(ApplyWithoutDryRunError);
  });

  it("dry-run ainda RUNNING", () => {
    const dryRun = ImportBatch.startDryRun({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: SNAPSHOT,
      scopeFingerprint: ESCOPO_AFIP,
      countsBefore: {}
    });

    expect(() =>
      ImportBatch.startApply({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: REGRAS,
        snapshotFingerprint: SNAPSHOT,
        scopeFingerprint: ESCOPO_AFIP,
        countsBefore: {},
        dryRunBatch: dryRun,
        approvedByIdentityPublicId: APROVADOR
      })
    ).toThrow(DryRunBatchNotCompletedError);
  });

  it("lote referenciado não é um dry-run", () => {
    const dryRun = novoDryRunConcluido();
    const apply = ImportBatch.startApply({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: SNAPSHOT,
      scopeFingerprint: ESCOPO_AFIP,
      countsBefore: {},
      dryRunBatch: dryRun,
      approvedByIdentityPublicId: APROVADOR
    });
    apply.complete({});

    expect(() =>
      ImportBatch.startApply({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: REGRAS,
        snapshotFingerprint: SNAPSHOT,
        scopeFingerprint: ESCOPO_AFIP,
        countsBefore: {},
        dryRunBatch: apply,
        approvedByIdentityPublicId: APROVADOR
      })
    ).toThrow(DryRunModeMismatchError);
  });

  it("origem mudou dentro do escopo desde o dry-run", () => {
    const dryRun = novoDryRunConcluido();
    // O e-mail de um usuário DO LOTE mudou -> outro scopeFingerprint.
    const escopoAlterado = escopo([
      { entityType: "users", legacyId: 35, fields: { active: 1, client_id: 78, role: "cliente" } },
      { entityType: "users", legacyId: 44, fields: { active: 1, client_id: 75, role: "cliente" } }
    ]);

    expect(() =>
      ImportBatch.startApply({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: REGRAS,
        snapshotFingerprint: SNAPSHOT,
        scopeFingerprint: escopoAlterado,
        countsBefore: {},
        dryRunBatch: dryRun,
        approvedByIdentityPublicId: APROVADOR
      })
    ).toThrow(SourceChangedSinceDryRunError);
  });

  it("versão de regras diferente", () => {
    const dryRun = novoDryRunConcluido();
    expect(() =>
      ImportBatch.startApply({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: "helpdesk-v2",
        snapshotFingerprint: SNAPSHOT,
        scopeFingerprint: ESCOPO_AFIP,
        countsBefore: {},
        dryRunBatch: dryRun,
        approvedByIdentityPublicId: APROVADOR
      })
    ).toThrow(MappingRulesVersionMismatchError);
  });

  it("sistema de origem diferente", () => {
    const dryRun = novoDryRunConcluido();
    expect(() =>
      ImportBatch.startApply({
        sourceSystem: "PCTEC_PORTAL",
        mappingRulesVersion: REGRAS,
        snapshotFingerprint: SNAPSHOT,
        scopeFingerprint: ESCOPO_AFIP,
        countsBefore: {},
        dryRunBatch: dryRun,
        approvedByIdentityPublicId: APROVADOR
      })
    ).toThrow(SourceSystemMismatchError);
  });

  it("sem aprovador registrado", () => {
    const dryRun = novoDryRunConcluido();
    expect(() =>
      ImportBatch.startApply({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: REGRAS,
        snapshotFingerprint: SNAPSHOT,
        scopeFingerprint: ESCOPO_AFIP,
        countsBefore: {},
        dryRunBatch: dryRun,
        approvedByIdentityPublicId: "  "
      })
    ).toThrow(UnapprovedApplyError);
  });
});

describe("ImportBatch — transições de estado", () => {
  it("RUNNING aceita COMPLETED, FAILED e ABORTED", () => {
    for (const encerrar of [
      (b: ImportBatch) => b.complete({ identities: 2 }),
      (b: ImportBatch) => b.fail("origem indisponível"),
      (b: ImportBatch) => b.abort("cancelado pelo operador")
    ]) {
      const batch = ImportBatch.startDryRun({
        sourceSystem: "PCTEC_HELPDESK",
        mappingRulesVersion: REGRAS,
        snapshotFingerprint: SNAPSHOT,
        scopeFingerprint: ESCOPO_AFIP,
        countsBefore: {}
      });
      expect(() => encerrar(batch)).not.toThrow();
      expect(batch.getStatus().isTerminal()).toBe(true);
      expect(batch.getFinishedAt()).not.toBeNull();
    }
  });

  it("nenhum estado terminal volta atrás", () => {
    const batch = novoDryRunConcluido();
    expect(() => batch.complete({})).toThrow(InvalidImportBatchTransitionError);
    expect(() => batch.fail("x")).toThrow(InvalidImportBatchTransitionError);
    expect(() => batch.abort("x")).toThrow(InvalidImportBatchTransitionError);
  });

  it("lote terminal não aceita mais itens", () => {
    const batch = novoDryRunConcluido();
    expect(() => batch.assertAcceptsItems()).toThrow();
  });

  it("motivo de falha é colapsado e truncado — stack trace não cabe", () => {
    const batch = ImportBatch.startDryRun({
      sourceSystem: "PCTEC_HELPDESK",
      mappingRulesVersion: REGRAS,
      snapshotFingerprint: SNAPSHOT,
      scopeFingerprint: ESCOPO_AFIP,
      countsBefore: {}
    });
    batch.fail(`erro\n  at algum.lugar\n  at outro.lugar${"x".repeat(900)}`);

    const motivo = batch.getFailureReason() ?? "";
    expect(motivo.length).toBeLessThanOrEqual(500);
    expect(motivo).not.toContain("\n");
    expect(motivo.endsWith("...")).toBe(true);
  });
});
