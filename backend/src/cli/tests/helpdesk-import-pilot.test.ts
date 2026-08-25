import { describe, expect, it } from "vitest";
import { parseArgs, PilotCliUsageError, formatReport } from "../helpdesk-import-pilot.js";

const UUID_LOTE = "3f9c1a2e-7d4b-4e5a-9c3f-000000000001";
const UUID_APROVADOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const UUID_ORG = "971ec096-e7de-4cc1-be06-2b4709565757";
const MAPEAMENTO = ["--expected-source-client-id=75", `--target-organization-public-id=${UUID_ORG}`];

describe("CLI do piloto — argumentos", () => {
  it("é DRY_RUN por padrão, sem precisar pedir", () => {
    expect(parseArgs(MAPEAMENTO).mode).toBe("DRY_RUN");
    expect(parseArgs(["--dry-run", ...MAPEAMENTO]).mode).toBe("DRY_RUN");
  });

  it("exige o mapeamento explícito nos dois modos — não há default", () => {
    expect(() => parseArgs([])).toThrow(/--expected-source-client-id/);
    expect(() => parseArgs(["--expected-source-client-id=75"])).toThrow(/--target-organization-public-id/);
    expect(() => parseArgs([`--target-organization-public-id=${UUID_ORG}`])).toThrow(
      /--expected-source-client-id/
    );
    expect(() => parseArgs(["--apply", `--dry-run-batch=${UUID_LOTE}`, `--approved-by=${UUID_APROVADOR}`])).toThrow(
      /--expected-source-client-id/
    );
  });

  it("recusa mapeamento malformado em vez de adivinhar", () => {
    expect(() => parseArgs(["--expected-source-client-id=0", `--target-organization-public-id=${UUID_ORG}`])).toThrow(
      /inteiro positivo/
    );
    expect(() => parseArgs(["--expected-source-client-id=abc", `--target-organization-public-id=${UUID_ORG}`])).toThrow(
      /inteiro positivo/
    );
    expect(() => parseArgs(["--expected-source-client-id=75", "--target-organization-public-id=bosque"])).toThrow(
      /publicId/
    );
  });

  it("devolve o mapeamento informado, sem transformá-lo", () => {
    const args = parseArgs(MAPEAMENTO);
    expect(args.expectedSourceClientId).toBe(75);
    expect(args.targetOrganizationPublicId).toBe(UUID_ORG);
  });

  it("recusa --apply sem o lote de dry-run aprovado", () => {
    expect(() => parseArgs(["--apply", ...MAPEAMENTO])).toThrow(PilotCliUsageError);
    expect(() => parseArgs(["--apply", ...MAPEAMENTO, `--approved-by=${UUID_APROVADOR}`])).toThrow(
      /--dry-run-batch/
    );
  });

  it("recusa --apply sem identificar quem aprovou", () => {
    expect(() => parseArgs(["--apply", ...MAPEAMENTO, `--dry-run-batch=${UUID_LOTE}`])).toThrow(/--approved-by/);
  });

  it("recusa lote ou aprovador que não sejam publicId", () => {
    expect(() =>
      parseArgs(["--apply", ...MAPEAMENTO, "--dry-run-batch=ultimo", `--approved-by=${UUID_APROVADOR}`])
    ).toThrow(PilotCliUsageError);
    expect(() =>
      parseArgs(["--apply", ...MAPEAMENTO, `--dry-run-batch=${UUID_LOTE}`, "--approved-by=admin"])
    ).toThrow(PilotCliUsageError);
  });

  it("aceita APPLY completo", () => {
    const args = parseArgs([
      "--apply",
      ...MAPEAMENTO,
      `--dry-run-batch=${UUID_LOTE}`,
      `--approved-by=${UUID_APROVADOR}`
    ]);
    expect(args).toEqual({
      mode: "APPLY",
      expectedSourceClientId: 75,
      targetOrganizationPublicId: UUID_ORG,
      dryRunBatchPublicId: UUID_LOTE,
      approvedByIdentityPublicId: UUID_APROVADOR
    });
  });

  it("recusa --dry-run e --apply juntos", () => {
    expect(() => parseArgs(["--dry-run", "--apply", ...MAPEAMENTO])).toThrow(PilotCliUsageError);
  });

  it.each(["--all", "--ids=35,44,45", "--client=75", "--group=27", "--client-group=27"])(
    "não existe %s — o escopo não se amplia por linha de comando",
    (flag) => {
      expect(() => parseArgs([flag, ...MAPEAMENTO])).toThrow(PilotCliUsageError);
    }
  );
});

describe("CLI do piloto — relatório", () => {
  it("mostra fingerprints e contagens sem nenhum dado pessoal", () => {
    const texto = formatReport({
      batchPublicId: UUID_LOTE,
      mode: "DRY_RUN",
      status: "COMPLETED",
      organizationPublicId: "org-1",
      organizationLegalName: "AFIP - BOSQUE",
      applicationPublicId: "app-1",
      snapshotFingerprint: "a".repeat(64),
      scopeFingerprint: "b".repeat(64),
      mappingRulesVersion: "helpdesk-v1",
      countsBefore: { identities: 7 },
      countsAfter: { identities: 9 },
      countsByAction: { CREATE: 8 },
      users: [
        {
          sourceLegacyId: 35,
          actionsByEntityKind: { IDENTITY: "CREATE" },
          reasonCodes: ["CREATED_FROM_SOURCE"],
          writtenTargets: {}
        }
      ],
      recordedItems: 8,
      resumedUsers: [],
      expectedSourceClientId: 75,
      sourceClientName: "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA - BOSQUE"
    });

    expect(texto).toContain("users:35");
    expect(texto).toContain("a".repeat(64));
    expect(texto).toContain("controle negativo users:45");
    expect(texto).not.toMatch(/@/);
  });
});
