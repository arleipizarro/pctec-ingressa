import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { CreateOrganizationExternalReferenceService } from "../modules/organization/application/CreateOrganizationExternalReferenceService.js";
import { LinkPortalOrganizationReferenceService } from "../modules/organization/application/LinkPortalOrganizationReferenceService.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { composePortalCatalog } from "../modules/portal/infrastructure/PortalCatalogComposition.js";
import { composeHelpdeskImport } from "../modules/import/infrastructure/HelpdeskImportComposition.js";
import { HelpdeskImportSelection } from "../modules/import/domain/wizard/HelpdeskImportSelection.js";
import {
  WIZARD_APPLY_CONFIRMATION
} from "../modules/import/application/RunHelpdeskImportWizardService.js";
import { WIZARD_MAPPING_RULES_VERSION } from "../modules/import/domain/wizard/HelpdeskImportScope.js";
import { CreateIdentityInvitationService } from "../modules/invitation/application/CreateIdentityInvitationService.js";
import { MariaDbInvitationEligibilityReadRepository } from "../modules/invitation/infrastructure/persistence/MariaDbInvitationEligibilityReadRepository.js";
import { MariaDbInvitationRepository } from "../modules/invitation/infrastructure/persistence/MariaDbInvitationRepository.js";
import { CryptoInvitationTokenGenerator } from "../modules/invitation/infrastructure/token/invitationToken.js";
import { NodemailerInvitationEmailTransport, resolveSmtpSecure } from "../modules/invitation/infrastructure/delivery/NodemailerInvitationEmailTransport.js";
import { SmtpInvitationDelivery } from "../modules/invitation/infrastructure/delivery/SmtpInvitationDelivery.js";
type Mode = "DRY_RUN" | "APPLY";

interface CliArgs {
  readonly mode: Mode;
  readonly actorPublicId: string;
  readonly manifestPath: string;
  readonly reportPath: string;
  readonly sendInvitations: boolean;
  readonly confirmation?: string;
}

interface ManifestEntry {
  readonly sourceClientId: number;
  readonly sourceClientName: string;
  readonly selectedSourceUserIds: readonly number[];
  readonly dryRunBatchPublicId: string;
  readonly scopeFingerprint: string;
  readonly countsByAction: Readonly<Record<string, number>>;
}

interface RolloutManifest {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly mappingRulesVersion: string;
  readonly actorPublicId: string;
  readonly entries: readonly ManifestEntry[];
  readonly skipped: readonly { sourceClientId: number; reason: string }[];
  readonly errors: readonly { sourceClientId: number; code: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function valueOf(argv: readonly string[], flag: string): string | undefined {
  const withEquals = argv.find((item) => item.startsWith(`${flag}=`));
  if (withEquals !== undefined) return withEquals.slice(flag.length + 1).trim();
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1]?.trim() : undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const apply = argv.includes("--apply");
  const dryRun = argv.includes("--dry-run");
  if (apply === dryRun) throw new Error("Informe exatamente um de --dry-run ou --apply.");

  const actorPublicId = valueOf(argv, "--actor") ?? "";
  if (!UUID.test(actorPublicId)) throw new Error("--actor=<identityPublicId ADMIN> é obrigatório.");

  const manifestPath = valueOf(argv, "--manifest") ?? "";
  if (!manifestPath.startsWith("/")) throw new Error("--manifest deve ser um caminho absoluto.");

  const reportPath = valueOf(argv, "--report") ?? `${manifestPath}.report.json`;
  if (!reportPath.startsWith("/")) throw new Error("--report deve ser um caminho absoluto.");

  const confirmation = valueOf(argv, "--confirmation");
  if (apply && confirmation !== WIZARD_APPLY_CONFIRMATION) {
    throw new Error(`--apply exige --confirmation=${WIZARD_APPLY_CONFIRMATION}.`);
  }

  return {
    mode: apply ? "APPLY" : "DRY_RUN",
    actorPublicId: actorPublicId.toLowerCase(),
    manifestPath,
    reportPath,
    sendInvitations: argv.includes("--send-invitations"),
    ...(confirmation !== undefined ? { confirmation } : {})
  };
}
function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function createLinkService(pool: ReturnType<typeof createPool>): LinkPortalOrganizationReferenceService {
  return new LinkPortalOrganizationReferenceService(
    new MariaDbUnitOfWork(pool),
    (connection) => new MariaDbOrganizationRepository(connection),
    (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
    (unitOfWork) =>
      new CreateOrganizationExternalReferenceService(
        unitOfWork,
        (connection) => new MariaDbOrganizationRepository(connection),
        (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection)
      )
  );
}

function createInvitationService(
  pool: ReturnType<typeof createPool>,
  env: ReturnType<typeof loadEnv>
): CreateIdentityInvitationService {
  const transport = new NodemailerInvitationEmailTransport({
    host: env.INGRESSA_SMTP_HOST,
    port: env.INGRESSA_SMTP_PORT,
    user: env.INGRESSA_SMTP_USER,
    password: env.INGRESSA_SMTP_PASSWORD,
    from: env.INGRESSA_SMTP_FROM,
    secure: resolveSmtpSecure(env.INGRESSA_SMTP_PORT, env.INGRESSA_SMTP_SECURE),
    requireTls: env.NODE_ENV === "production"
  });
  const delivery = new SmtpInvitationDelivery(transport, {
    fromLabel: "Portal do Cliente PCTEC",
    supportContact: "a PCTEC",
    products: [
      {
        nome: "Portal do Cliente",
        descricao: "Consulte contratos, equipamentos, informações financeiras e chamados."
      }
    ]
  });
  return new CreateIdentityInvitationService(
    new MariaDbUnitOfWork(pool),
    new MariaDbInvitationEligibilityReadRepository(pool),
    (connection) => new MariaDbInvitationRepository(connection),
    (connection) => new MariaDbAuditEventRepository(connection),
    new CryptoInvitationTokenGenerator(),
    delivery,
    env.INVITATION_TTL_SECONDS,
    env.INGRESSA_PUBLIC_BASE_URL
  );
}

async function listAllCompanies(
  catalog: ReturnType<typeof composeHelpdeskImport>["catalogService"]
) {
  const items: Awaited<ReturnType<typeof catalog.listCompanies>>["items"][number][] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await catalog.listCompanies({ limit: 100, offset });
    items.push(...page.items);
    if (offset + page.items.length >= page.total || page.items.length === 0) break;
  }
  return items;
}

async function runDryRun(
  args: CliArgs,
  wizard: ReturnType<typeof composeHelpdeskImport>["wizardService"],
  catalog: ReturnType<typeof composeHelpdeskImport>["catalogService"]
): Promise<RolloutManifest> {
  const entries: ManifestEntry[] = [];
  const skipped: { sourceClientId: number; reason: string }[] = [];
  const errors: { sourceClientId: number; code: string }[] = [];

  for (const company of await listAllCompanies(catalog)) {
    if (!company.active) {
      skipped.push({ sourceClientId: company.sourceClientId, reason: "SOURCE_CLIENT_INACTIVE" });
      continue;
    }
    try {
      const users = await catalog.listUsers(company.sourceClientId);
      const selectedSourceUserIds = users.items
        .filter((user) => user.eligible)
        .map((user) => user.sourceUserId);
      if (selectedSourceUserIds.length === 0) {
        skipped.push({ sourceClientId: company.sourceClientId, reason: "NO_ELIGIBLE_USERS" });
        continue;
      }
      const selection = HelpdeskImportSelection.create({
        sourceClientId: company.sourceClientId,
        selectedSourceUserIds
      });
      const result = await wizard.execute({
        mode: "DRY_RUN",
        selection,
        actorIdentityPublicId: args.actorPublicId
      });
      entries.push({
        sourceClientId: company.sourceClientId,
        sourceClientName: company.name,
        selectedSourceUserIds,
        dryRunBatchPublicId: result.batchPublicId,
        scopeFingerprint: result.scopeFingerprint,
        countsByAction: result.countsByAction
      });
    } catch (error) {
      errors.push({ sourceClientId: company.sourceClientId, code: errorCode(error) });
    }
  }

  const manifest: RolloutManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mappingRulesVersion: WIZARD_MAPPING_RULES_VERSION,
    actorPublicId: args.actorPublicId,
    entries,
    skipped,
    errors
  };
  await writeFile(args.manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}

function assertManifest(value: unknown): RolloutManifest {
  if (value === null || typeof value !== "object") throw new Error("Manifesto inválido.");
  const manifest = value as RolloutManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error("Versão do manifesto inválida.");
  }
  if (manifest.mappingRulesVersion !== WIZARD_MAPPING_RULES_VERSION) {
    throw new Error("Manifesto foi gerado sob outra versão das regras.");
  }
  return manifest;
}

async function readManifest(path: string): Promise<RolloutManifest> {
  return assertManifest(JSON.parse(await readFile(path, "utf8")) as unknown);
}

async function collectLinkedIdentities(
  sourceClientId: number,
  selectedSourceUserIds: readonly number[],
  catalog: ReturnType<typeof composeHelpdeskImport>["catalogService"]
): Promise<readonly string[]> {
  const selected = new Set(selectedSourceUserIds);
  const users = await catalog.listUsers(sourceClientId);
  return users.items
    .filter((user) => selected.has(user.sourceUserId) && user.linkedIdentity !== null)
    .map((user) => user.linkedIdentity!.identityPublicId);
}

async function sendInvitations(
  identityPublicIds: readonly string[],
  actorPublicId: string,
  service: CreateIdentityInvitationService
) {
  const unique = [...new Set(identityPublicIds)];
  const results: Array<Record<string, unknown>> = [];
  for (const identityPublicId of unique) {
    try {
      const outcome = await service.execute({
        identityPublicIds: [identityPublicId],
        invitedByPublicId: actorPublicId,
        correlationId: randomUUID()
      });
      results.push(outcome.results[0] as unknown as Record<string, unknown>);
    } catch (error) {
      results.push({
        identityPublicId,
        outcome: "FAILED",
        reasonCode: errorCode(error),
        delivered: false
      });
    }
  }
  return results;
}

async function runApply(
  args: CliArgs,
  manifest: RolloutManifest,
  wizard: ReturnType<typeof composeHelpdeskImport>["wizardService"],
  catalog: ReturnType<typeof composeHelpdeskImport>["catalogService"],
  invitationService: CreateIdentityInvitationService
) {
  const applied: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  const invitationCandidates: string[] = [];

  for (const entry of manifest.entries) {
    try {
      const selection = HelpdeskImportSelection.create({
        sourceClientId: entry.sourceClientId,
        selectedSourceUserIds: entry.selectedSourceUserIds
      });
      const result = await wizard.execute({
        mode: "APPLY",
        selection,
        actorIdentityPublicId: args.actorPublicId,
        dryRunBatchPublicId: entry.dryRunBatchPublicId,
        confirmation: args.confirmation,
        correlationId: randomUUID()
      });
      const portalReady =
        result.portalIntegration?.status === "LINKED" ||
        result.portalIntegration?.status === "ALREADY_LINKED";
      applied.push({
        sourceClientId: entry.sourceClientId,
        batchPublicId: result.batchPublicId,
        users: result.users.length,
        portalIntegration: result.portalIntegration
      });
      if (portalReady) {
        invitationCandidates.push(
          ...(await collectLinkedIdentities(
            entry.sourceClientId,
            entry.selectedSourceUserIds,
            catalog
          ))
        );
      }
    } catch (error) {
      failures.push({ sourceClientId: entry.sourceClientId, code: errorCode(error) });
    }
  }

  const invitations = args.sendInvitations
    ? await sendInvitations(invitationCandidates, args.actorPublicId, invitationService)
    : [];

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    manifestPath: args.manifestPath,
    applied,
    failures,
    invitationsRequested: args.sendInvitations,
    invitations
  };
  await writeFile(args.reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  return report;
}
function summarizeDryRun(manifest: RolloutManifest) {
  const users = manifest.entries.reduce(
    (total, entry) => total + entry.selectedSourceUserIds.length,
    0
  );
  const actions = manifest.entries.reduce<Record<string, number>>((total, entry) => {
    for (const [action, count] of Object.entries(entry.countsByAction)) {
      total[action] = (total[action] ?? 0) + count;
    }
    return total;
  }, {});
  return {
    mode: "DRY_RUN",
    companies: manifest.entries.length,
    users,
    actions,
    skippedCompanies: manifest.skipped.length,
    errors: manifest.errors,
    manifestPath: ""
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const ingressaPool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });

  const linkService = createLinkService(ingressaPool);
  const portal = composePortalCatalog(ingressaPool, linkService);
  const helpdesk = composeHelpdeskImport(ingressaPool, portal.autoLinkService);
  try {
    if (args.mode === "DRY_RUN") {
      const manifest = await runDryRun(args, helpdesk.wizardService, helpdesk.catalogService);
      const summary = { ...summarizeDryRun(manifest), manifestPath: args.manifestPath };
      process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
      return;
    }

    const manifest = await readManifest(args.manifestPath);
    const invitationService = createInvitationService(ingressaPool, env);
    const report = await runApply(
      args,
      manifest,
      helpdesk.wizardService,
      helpdesk.catalogService,
      invitationService
    );
    process.stdout.write(
      JSON.stringify(
        {
          mode: "APPLY",
          companiesApplied: report.applied.length,
          failures: report.failures,
          invitationsCreated: report.invitations.filter((item) => item["outcome"] === "CREATED").length,
          invitationsSkipped: report.invitations.filter((item) => item["outcome"] === "SKIPPED").length,
          invitationsFailed: report.invitations.filter((item) => item["outcome"] === "FAILED").length,
          reportPath: args.reportPath
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    await helpdesk.sourcePool.end();
    await portal.sourcePool.end();
    await ingressaPool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`[portal-users-rollout] ${errorCode(error)}\n`);
  process.exitCode = 2;
});
