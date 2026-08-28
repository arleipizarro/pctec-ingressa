import { DomainError } from "../../../shared/errors/DomainError.js";
import type { PortalReconciliationReader } from "../domain/PortalReconciliationPort.js";
import type { PortalClientMatchStatus } from "../domain/PortalClientMatch.js";
import { maskCnpj } from "../domain/value-objects/PortalDocument.js";
import type { MatchPortalClientByDocumentService } from "./MatchPortalClientByDocumentService.js";
import type {
  AutoLinkPortalOrganizationReferenceService,
  PortalAutoLinkStatus
} from "./AutoLinkPortalOrganizationReferenceService.js";

/** Palavra exigida no corpo da execução. Sem ela, nada é escrito. */
export const PORTAL_RECONCILIATION_CONFIRMATION = "RECONCILIAR";

export const PORTAL_RECONCILIATION_DEFAULT_LIMIT = 50;
export const PORTAL_RECONCILIATION_MAX_LIMIT = 200;
/** Teto do lote de execução — a tela reconcilia uma página, não a base. */
export const PORTAL_RECONCILIATION_MAX_EXECUTION = 50;

export type PortalReconciliationStatus = PortalClientMatchStatus | "ALREADY_LINKED";

export class PortalReconciliationConfirmationRequiredError extends DomainError {
  public readonly code = "PORTAL_RECONCILIATION_CONFIRMATION_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(`Confirme a execução digitando "${PORTAL_RECONCILIATION_CONFIRMATION}".`);
  }
}

export class PortalReconciliationSelectionInvalidError extends DomainError {
  public readonly code = "PORTAL_RECONCILIATION_SELECTION_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor(motivo: string) {
    super(`Seleção inválida para reconciliação: ${motivo}`);
  }
}

/**
 * Uma organização, classificada. **Sem documento inteiro em campo
 * nenhum** — nem o da Organization, nem o do cliente do Portal.
 */
export interface PortalReconciliationItem {
  readonly organizationPublicId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly status: PortalReconciliationStatus;
  /** Presença de CNPJ comparável na Organization — nunca o valor. */
  readonly hasDocument: boolean;
  readonly candidateCount: number;
  /** Só em `EXACT_UNIQUE`: o que a execução escreveria. */
  readonly suggestedLegacyId: number | null;
  readonly suggestedClientName: string | null;
  readonly suggestedClientDocumentMasked: string | null;
}

export interface PortalReconciliationDryRunResult {
  readonly items: readonly PortalReconciliationItem[];
  readonly counts: Readonly<Record<PortalReconciliationStatus, number>>;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** Quantas, nesta página, a execução escreveria. */
  readonly eligibleCount: number;
}

export interface PortalReconciliationExecutionItem {
  readonly organizationPublicId: string;
  readonly legalName: string;
  readonly status: PortalAutoLinkStatus | "NOT_ELIGIBLE";
  readonly legacyId: number | null;
  readonly referencePublicId: string | null;
  readonly reasonCode: string | null;
}

export interface PortalReconciliationExecutionResult {
  readonly items: readonly PortalReconciliationExecutionItem[];
  readonly linked: number;
  readonly alreadyLinked: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Reconciliação administrativa das organizações que já existem.
 *
 * É a resposta para "e as empresas que foram criadas antes disto?" — e
 * a resposta NÃO é um script de banco. Nenhuma consulta manual, nenhum
 * `INSERT` avulso: a mesma tela, a mesma autorização, a mesma auditoria.
 *
 * ## Duas operações, deliberadamente separadas
 *
 * **`dryRun` não escreve.** Nem uma linha, nem um lote de importação,
 * nem um evento. Ele lista contagens e candidatas — `publicId`, nomes e
 * a classificação — para que a decisão seja tomada olhando o que
 * aconteceria. Um dry-run que registrasse algo já seria uma execução
 * pequena.
 *
 * **`execute` exige confirmação literal e uma lista explícita de
 * organizações.** Não existe "reconciliar tudo": a seleção vem da
 * página que a pessoa acabou de ler. E mesmo com a lista em mãos, cada
 * organização é **reclassificada do zero** antes de qualquer escrita —
 * o dry-run é uma fotografia, e a fonte pode ter mudado entre uma coisa
 * e outra.
 *
 * ## Só `EXACT_UNIQUE` escreve
 *
 * A garantia não é uma checagem repetida aqui: é o próprio
 * `AutoLinkPortalOrganizationReferenceService`, que só chama o serviço
 * de vínculo quando o CNPJ bate com exatamente um cliente. Repetir a
 * condição neste arquivo daria duas cópias da mesma regra.
 *
 * ## Uma falha não contamina as outras
 *
 * Cada organização é uma transação própria, dentro do serviço de
 * vínculo. O laço aqui não tem `try` que engula silêncio: o `AutoLink`
 * já devolve `FAILED` com código em vez de lançar, então a empresa
 * seguinte é processada com o mesmo estado limpo, e o resultado diz,
 * organização por organização, o que aconteceu com cada uma.
 */
export class ReconcilePortalOrganizationReferencesService {
  public constructor(
    private readonly reader: PortalReconciliationReader,
    private readonly matchService: MatchPortalClientByDocumentService,
    private readonly autoLinkService: AutoLinkPortalOrganizationReferenceService
  ) {}

  public async dryRun(filtros: {
    readonly limit?: unknown;
    readonly offset?: unknown;
  }): Promise<PortalReconciliationDryRunResult> {
    const limit = normalizarLimite(filtros.limit);
    const offset = normalizarOffset(filtros.offset);
    const pagina = await this.reader.listCandidates({ limit, offset });

    const items: PortalReconciliationItem[] = [];
    for (const candidata of pagina.items) {
      items.push(await this.classificar(candidata));
    }

    const counts: Record<PortalReconciliationStatus, number> = {
      EXACT_UNIQUE: 0,
      NOT_FOUND: 0,
      AMBIGUOUS: 0,
      DOCUMENT_MISSING_OR_INVALID: 0,
      ALREADY_LINKED: 0
    };
    for (const item of items) {
      counts[item.status] += 1;
    }

    return {
      items,
      counts,
      total: pagina.total,
      limit: pagina.limit,
      offset: pagina.offset,
      eligibleCount: counts.EXACT_UNIQUE
    };
  }

  public async execute(request: {
    readonly organizationPublicIds: unknown;
    readonly confirmation: unknown;
    readonly actorPublicId: string;
    readonly correlationId?: string | undefined;
  }): Promise<PortalReconciliationExecutionResult> {
    if (request.confirmation !== PORTAL_RECONCILIATION_CONFIRMATION) {
      throw new PortalReconciliationConfirmationRequiredError();
    }
    const selecionadas = normalizarSelecao(request.organizationPublicIds);

    // Reduz a seleção ao que é elegível ESTRUTURALMENTE (COMPANY
    // ACTIVE que existe). O que sobrar da lista do cliente é reportado
    // como `NOT_ELIGIBLE` em vez de sumir: uma organização que o ADMIN
    // pediu e não foi tocada precisa aparecer no resultado.
    const candidatas = await this.reader.findCandidates(selecionadas);
    const porPublicId = new Map(candidatas.map((c) => [c.organizationPublicId, c]));

    const items: PortalReconciliationExecutionItem[] = [];
    for (const publicId of selecionadas) {
      const candidata = porPublicId.get(publicId);
      if (candidata === undefined) {
        items.push({
          organizationPublicId: publicId,
          legalName: "",
          status: "NOT_ELIGIBLE",
          legacyId: null,
          referencePublicId: null,
          reasonCode: "PORTAL_RECONCILIATION_ORGANIZATION_NOT_ELIGIBLE"
        });
        continue;
      }

      // Reclassificação do zero, dentro do AutoLink: nada aqui confia
      // no que o dry-run viu. Só `EXACT_UNIQUE` chega a escrever, e a
      // escrita é a do serviço oficial de vínculo.
      const resultado = await this.autoLinkService.execute({
        organizationPublicId: candidata.organizationPublicId,
        actorPublicId: request.actorPublicId,
        correlationId: request.correlationId
      });

      items.push({
        organizationPublicId: candidata.organizationPublicId,
        legalName: candidata.legalName,
        status: resultado.status,
        legacyId: resultado.legacyId,
        referencePublicId: resultado.referencePublicId,
        reasonCode: resultado.reasonCode
      });
    }

    return {
      items,
      linked: items.filter((i) => i.status === "LINKED").length,
      alreadyLinked: items.filter((i) => i.status === "ALREADY_LINKED").length,
      failed: items.filter((i) => i.status === "FAILED").length,
      skipped: items.filter(
        (i) => i.status !== "LINKED" && i.status !== "ALREADY_LINKED" && i.status !== "FAILED"
      ).length
    };
  }

  private async classificar(candidata: {
    readonly organizationPublicId: string;
    readonly legalName: string;
    readonly tradeName: string | null;
    readonly documentNumber: string | null;
    readonly activePortalReferences: number;
  }): Promise<PortalReconciliationItem> {
    const base = {
      organizationPublicId: candidata.organizationPublicId,
      legalName: candidata.legalName,
      tradeName: candidata.tradeName,
      hasDocument: candidata.documentNumber !== null && candidata.documentNumber.trim().length > 0,
      suggestedLegacyId: null,
      suggestedClientName: null,
      suggestedClientDocumentMasked: null
    };

    // Já vinculada vem ANTES da consulta à fonte: quem já tem
    // referência não é candidata, e ir ao Portal para descobrir isso
    // seria uma varredura por empresa sem nenhuma decisão dependendo
    // dela. Mais de uma referência ACTIVE também cai aqui — e continua
    // sem escrita, porque o serviço de vínculo recusa cadastro ambíguo.
    if (candidata.activePortalReferences > 0) {
      return { ...base, status: "ALREADY_LINKED", candidateCount: candidata.activePortalReferences };
    }

    const correspondencia = await this.matchService.execute(candidata.documentNumber);
    if (correspondencia.status === "EXACT_UNIQUE" && correspondencia.client !== undefined) {
      return {
        ...base,
        status: "EXACT_UNIQUE",
        candidateCount: 1,
        suggestedLegacyId: correspondencia.client.id,
        suggestedClientName: correspondencia.client.nome,
        suggestedClientDocumentMasked: maskCnpj(correspondencia.client.documentDigits)
      };
    }
    return { ...base, status: correspondencia.status, candidateCount: correspondencia.candidateCount };
  }
}

function normalizarLimite(bruto: unknown): number {
  const numero = Number(bruto);
  if (!Number.isInteger(numero) || numero <= 0) {
    return PORTAL_RECONCILIATION_DEFAULT_LIMIT;
  }
  return Math.min(numero, PORTAL_RECONCILIATION_MAX_LIMIT);
}

function normalizarOffset(bruto: unknown): number {
  const numero = Number(bruto);
  return Number.isInteger(numero) && numero > 0 ? numero : 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A lista vem do cliente, então ela é validada como se viesse de um
 * desconhecido — porque vem. Formato, duplicidade e tamanho, todos
 * antes de qualquer I/O.
 */
function normalizarSelecao(bruto: unknown): readonly string[] {
  if (!Array.isArray(bruto)) {
    throw new PortalReconciliationSelectionInvalidError("informe a lista de organizações.");
  }
  const ids = [...new Set(bruto.filter((v): v is string => typeof v === "string").map((v) => v.trim()))];
  if (ids.length === 0) {
    throw new PortalReconciliationSelectionInvalidError("nenhuma organização selecionada.");
  }
  if (ids.length > PORTAL_RECONCILIATION_MAX_EXECUTION) {
    throw new PortalReconciliationSelectionInvalidError(
      `no máximo ${PORTAL_RECONCILIATION_MAX_EXECUTION} organizações por execução.`
    );
  }
  if (ids.some((id) => !UUID.test(id))) {
    throw new PortalReconciliationSelectionInvalidError("publicId inválido na lista.");
  }
  return ids;
}
