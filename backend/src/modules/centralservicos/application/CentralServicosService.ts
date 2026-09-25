import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  PCTEC_CENTRAL_SERVICOS_APPLICATION_CODE,
  PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID
} from "../../application/domain/value-objects/ApplicationCodes.js";
import type { CentralServicosRepository } from "../domain/CentralServicosRepository.js";
import { ACTION_KINDS, AUDIENCE_HELPDESK, type VerificationResult } from "../domain/DelegationAssertion.js";
import { CentralServicosIdentityNotAuthorizedError, DelegationAssertionInvalidInputError } from "./errors/CentralServicosErrors.js";

/** Evento de auditoria mínimo; o adaptador MariaDB o grava em `audit_events`. */
export interface CentralServicosAuditEntry {
  readonly eventType: "delegation-assertion.issued" | "delegation-assertion.consumed";
  readonly aggregatePublicId: string;
  readonly actorPublicId: string;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, string | number>>;
}

export interface CentralServicosPersistence {
  readonly leitura: CentralServicosRepository;
  /** Escrita + auditoria na MESMA transação. */
  transacao<T>(fn: (repo: CentralServicosRepository, auditar: (e: CentralServicosAuditEntry) => Promise<void>) => Promise<T>): Promise<T>;
}

export interface AutorizacaoCentralServicos {
  readonly identityPublicId: string;
  readonly fullName: string;
  /** Perfil de camada 1 em PCTEC_CENTRAL_SERVICOS; null = sem acesso vigente. */
  readonly accessProfile: string | null;
  /** Perfis de camada 2 (N1_OPERADOR, APROVADOR_TI). Vazio sem acesso. */
  readonly roles: readonly string[];
}

export interface DependenciasCentralServicos {
  readonly persistencia: CentralServicosPersistence;
  readonly agora?: () => Date;
  /** Validade da asserção. Curta de propósito: cobre reenvios, não armazenamento. */
  readonly validadeAssercaoSegundos?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const CHAVE = /^[A-Za-z0-9:._-]{8,96}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/**
 * Fronteira do Ingressa para a PCTEC Central de Serviços N1.
 *
 * ## Por que um contrato próprio, e não um endpoint genérico de perfis
 *
 * Um `GET /identities/:id/access-profile?application=X` genérico,
 * servido a qualquer consumidor autenticado, deixaria a credencial de um
 * produto ler acesso e perfis de pessoas em TODOS os outros. Aqui a
 * aplicação é FIXA no código (`PCTEC_CENTRAL_SERVICOS`) e o namespace só
 * abre com a credencial da própria Central: vazar essa credencial expõe
 * o que a Central já podia ver, e nada além.
 *
 * ## Asserção de delegação
 *
 * A Central grava no Helpdesk em nome do operador. O Helpdesk não pode
 * confiar numa Identity que a Central apenas informa; então a Central
 * pede aqui, no momento do gesto, uma asserção OPACA amarrada a
 * (destinatário, chamado, chave da ação, tipo, hash do conteúdo,
 * validade). O Helpdesk verifica com o Ingressa, que devolve a Identity,
 * confere que a pessoa CONTINUA autorizada e consome a asserção uma única
 * vez.
 */
export class CentralServicosService {
  private readonly agora: () => Date;
  private readonly validadeMs: number;

  public constructor(private readonly deps: DependenciasCentralServicos) {
    this.agora = deps.agora ?? (() => new Date());
    const segundos = deps.validadeAssercaoSegundos ?? 3600;
    if (!Number.isInteger(segundos) || segundos < 60 || segundos > 86_400) {
      throw new Error("Validade da asserção deve estar entre 60 e 86400 segundos.");
    }
    this.validadeMs = segundos * 1000;
  }

  /**
   * Camadas 1 e 2 para a Central, numa resposta só. Identidade inexistente
   * ou fora de ACTIVE responde como "sem acesso", nunca como erro: o
   * produto só precisa saber se pode deixar a pessoa entrar.
   */
  public async autorizacao(identityPublicId: string): Promise<AutorizacaoCentralServicos> {
    if (!UUID.test(identityPublicId)) throw new DelegationAssertionInvalidInputError("identityPublicId");
    const linha = await this.deps.persistencia.leitura.identityAuthorization(identityPublicId, PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID);
    if (!linha || linha.status !== "ACTIVE" || linha.accessProfile === null) {
      return { identityPublicId, fullName: linha?.fullName ?? "", accessProfile: null, roles: [] };
    }
    const roles = await this.deps.persistencia.leitura.grantedRoles(identityPublicId, PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID);
    return { identityPublicId, fullName: linha.fullName, accessProfile: linha.accessProfile, roles };
  }

  private async exigirAutorizada(identityPublicId: string): Promise<void> {
    const a = await this.autorizacao(identityPublicId);
    if (a.accessProfile === null || a.roles.length === 0) throw new CentralServicosIdentityNotAuthorizedError();
  }

  /** Emite a asserção para UMA ação. O token volta só nesta resposta. */
  public async emitirAssercao(entrada: {
    readonly identityPublicId: unknown;
    readonly ticketId: unknown;
    readonly idempotencyKey: unknown;
    readonly actionKind: unknown;
    readonly contentSha256: unknown;
    readonly correlationId?: string | undefined;
  }): Promise<{ readonly assertion: string; readonly assertionPublicId: string; readonly expiresAt: string }> {
    const identityPublicId = String(entrada.identityPublicId ?? "");
    if (!UUID.test(identityPublicId)) throw new DelegationAssertionInvalidInputError("identityPublicId");
    const ticketId = entrada.ticketId;
    if (typeof ticketId !== "number" || !Number.isSafeInteger(ticketId) || ticketId <= 0) {
      throw new DelegationAssertionInvalidInputError("ticketId");
    }
    if (typeof entrada.idempotencyKey !== "string" || !CHAVE.test(entrada.idempotencyKey)) {
      throw new DelegationAssertionInvalidInputError("idempotencyKey");
    }
    if (typeof entrada.actionKind !== "string" || !(ACTION_KINDS as readonly string[]).includes(entrada.actionKind)) {
      throw new DelegationAssertionInvalidInputError("actionKind");
    }
    if (typeof entrada.contentSha256 !== "string" || !SHA256_HEX.test(entrada.contentSha256)) {
      throw new DelegationAssertionInvalidInputError("contentSha256");
    }
    await this.exigirAutorizada(identityPublicId);

    const token = randomBytes(32).toString("base64url");
    const agora = this.agora();
    const expiresAt = new Date(agora.getTime() + this.validadeMs);
    const publicId = randomUUID();
    const idempotencyKey = entrada.idempotencyKey;
    const actionKind = entrada.actionKind;
    const contentSha256 = entrada.contentSha256;

    await this.deps.persistencia.transacao(async (repo, auditar) => {
      await repo.insertAssertion({
        publicId,
        tokenHash: sha256(token),
        issuerApplicationPublicId: PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID,
        audienceApplicationCode: AUDIENCE_HELPDESK,
        identityPublicId,
        ticketId,
        idempotencyKey,
        actionKind,
        contentSha256,
        issuedAt: agora,
        expiresAt
      });
      await auditar({
        eventType: "delegation-assertion.issued",
        aggregatePublicId: publicId,
        actorPublicId: identityPublicId,
        correlationId: entrada.correlationId ?? randomUUID(),
        payload: {
          assertionPublicId: publicId,
          issuerApplicationCode: PCTEC_CENTRAL_SERVICOS_APPLICATION_CODE,
          audienceApplicationCode: AUDIENCE_HELPDESK,
          ticketId,
          actionKind,
          expiresAt: expiresAt.toISOString()
        }
      });
    });
    return { assertion: token, assertionPublicId: publicId, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Verifica e CONSOME. A ordem importa:
   *   1. token desconhecido, destinatário errado ou amarração diferente →
   *      INVALID (nada é consumido: a asserção continua servindo à ação
   *      verdadeira);
   *   2. já consumida → ALREADY_USED;
   *   3. vencida → EXPIRED;
   *   4. pessoa sem autorização AGORA (perfil revogado, identidade
   *      bloqueada) → REVOKED;
   *   5. consumo atômico; quem perder a corrida recebe ALREADY_USED.
   */
  public async verificarAssercao(entrada: {
    readonly assertion: unknown;
    readonly audience: string;
    readonly consumer: string;
    readonly ticketId: unknown;
    readonly idempotencyKey: unknown;
    readonly actionKind: unknown;
    readonly contentSha256: unknown;
    readonly correlationId?: string | undefined;
  }): Promise<VerificationResult> {
    if (typeof entrada.assertion !== "string" || !TOKEN.test(entrada.assertion)) {
      return { status: "INVALID", reason: "UNKNOWN" };
    }
    const registro = await this.deps.persistencia.leitura.assertionByTokenHash(sha256(entrada.assertion));
    if (!registro) return { status: "INVALID", reason: "UNKNOWN" };
    if (registro.audienceApplicationCode !== entrada.audience) return { status: "INVALID", reason: "WRONG_AUDIENCE" };
    if (
      registro.ticketId !== entrada.ticketId ||
      registro.idempotencyKey !== entrada.idempotencyKey ||
      registro.actionKind !== entrada.actionKind ||
      registro.contentSha256 !== entrada.contentSha256
    ) {
      return { status: "INVALID", reason: "BINDING_MISMATCH" };
    }
    if (registro.consumedAt) {
      return { status: "ALREADY_USED", assertionPublicId: registro.publicId, consumedAt: registro.consumedAt.toISOString() };
    }
    const agora = this.agora();
    if (registro.expiresAt.getTime() <= agora.getTime()) return { status: "EXPIRED" };
    const autorizacao = await this.autorizacao(registro.identityPublicId);
    if (autorizacao.accessProfile === null || autorizacao.roles.length === 0) return { status: "REVOKED" };

    const issuerCode = (await this.deps.persistencia.leitura.applicationCodeByPublicId(registro.issuerApplicationPublicId)) ?? "";
    const consumiu = await this.deps.persistencia.transacao(async (repo, auditar) => {
      if (!(await repo.consumeAssertion(registro.id, entrada.consumer, agora))) return false;
      await auditar({
        eventType: "delegation-assertion.consumed",
        aggregatePublicId: registro.publicId,
        actorPublicId: registro.identityPublicId,
        correlationId: entrada.correlationId ?? randomUUID(),
        payload: {
          assertionPublicId: registro.publicId,
          consumer: entrada.consumer,
          ticketId: registro.ticketId,
          actionKind: registro.actionKind
        }
      });
      return true;
    });
    if (!consumiu) {
      const atual = await this.deps.persistencia.leitura.assertionByTokenHash(registro.tokenHash);
      return {
        status: "ALREADY_USED",
        assertionPublicId: registro.publicId,
        consumedAt: (atual?.consumedAt ?? agora).toISOString()
      };
    }
    return {
      status: "VALID",
      assertionPublicId: registro.publicId,
      identityPublicId: registro.identityPublicId,
      issuerApplicationCode: issuerCode
    };
  }
}
