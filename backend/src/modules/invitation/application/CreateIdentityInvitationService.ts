import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { InvitationRepository } from "../domain/InvitationRepository.js";
import { Invitation } from "../domain/Invitation.js";
import {
  createInvitationCreatedEvent,
  createInvitationRevokedEvent
} from "../domain/events/InvitationDomainEvents.js";
import type { InvitationTokenGenerator } from "../infrastructure/token/invitationToken.js";
import { hashInvitationToken } from "../infrastructure/token/invitationToken.js";
import type { InvitationDelivery } from "./InvitationDelivery.js";

export interface InvitationCandidate {
  readonly identityPublicId: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: string;
  readonly loginEnabled: boolean;
  /** Existe QUALQUER `IdentityExternalReference`, em qualquer status. */
  readonly hasExternalReference: boolean;
  /** Existe ao menos uma `IdentityExternalReference` com status `ACTIVE`. */
  readonly hasActiveExternalReference: boolean;
  readonly hasCredential: boolean;
  readonly hasApplicationAccess: boolean;
}

export interface InvitationEligibilityReadRepository {
  loadCandidates(identityPublicIds: readonly string[]): Promise<readonly InvitationCandidate[]>;
}

export interface CreateIdentityInvitationRequest {
  readonly identityPublicIds: readonly string[];
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly invitedByPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface InvitationOutcome {
  readonly identityPublicId: string;
  readonly fullName: string;
  readonly outcome: "CREATED" | "SKIPPED";
  readonly reasonCode: string | null;
  readonly invitationPublicId: string | null;
  readonly expiresAt: string | null;
  readonly deliveryMode: string | null;
  readonly delivered: boolean;
  /**
   * Presente SOMENTE no modo manual e SOMENTE nesta resposta. Não é
   * persistido, não é reexibível, não vai para log nem para auditoria —
   * quem fechar a tela sem copiar precisa emitir um convite novo.
   */
  readonly manualLink: string | null;
}

export interface CreateIdentityInvitationResult {
  readonly deliveryMode: string;
  readonly results: readonly InvitationOutcome[];
}

/** Motivo da revogação automática dos convites anteriores da mesma pessoa. */
const SUPERSEDED = "SUPERSEDED";

/**
 * Emite convites de primeiro acesso para uma ou mais Identities — ação
 * administrativa, sempre com ADMIN autenticado como ator.
 *
 * **Elegibilidade (todas obrigatórias, verificadas por identidade):**
 * Identity `ACTIVE`; SEM `Credential LOCAL_PASSWORD` (convite é primeiro
 * acesso, nunca troca de senha — para trocar existe outro caminho); com
 * pelo menos um `ApplicationAccess` GRANTED (convidar quem não tem
 * acesso a produto nenhum entregaria uma senha que não abre nada); e
 * sem federação REVOGADA (ver abaixo).
 *
 * **Origem não é mais critério.** A regra anterior exigia federação
 * ACTIVE, o que na prática significava "só convido quem o importador do
 * Helpdesk trouxe". Isso barrava exatamente o caso que o provisionamento
 * administrativo criou: uma pessoa cadastrada AQUI, que nunca teve nem
 * deveria ter `IdentityExternalReference` — fabricar uma só para passar
 * na regra seria registrar um vínculo legado que não existe.
 *
 * O que a regra protegia continua protegido, e agora de forma direta:
 * uma identidade cuja federação foi REVOGADA (tem referência externa,
 * mas nenhuma `ACTIVE`) segue recusada, com
 * `IDENTITY_FEDERATION_INACTIVE`. Quem perdeu o vínculo com o sistema de
 * origem não volta pela porta do convite. A distinção é entre "nunca
 * teve vínculo" (conta local, legítima) e "tinha e perdeu" (recusada) —
 * um booleano `federated` não conseguia expressar as duas.
 *
 * **Uma identidade inelegível NUNCA derruba o lote.** Ela volta como
 * `SKIPPED` com o `reasonCode`, e as demais seguem. Falhar tudo por
 * causa de uma faria o ADMIN caçar qual das trinta era o problema.
 *
 * **Cada convite é uma transação própria.** Convites são independentes
 * entre si; uma transação única para o lote inteiro faria a falha de
 * escrita de um desfazer os já emitidos — inclusive os já ENTREGUES, que
 * não têm como ser desfeitos.
 *
 * **Revogação dos anteriores acontece DENTRO da transação do novo**, e é
 * o que garante no máximo um convite `PENDING` por pessoa: dois links
 * válidos ao mesmo tempo significam que revogar o que vazou não resolve.
 *
 * O token bruto existe apenas como variável local e dentro do link
 * entregue ao adaptador — nunca é persistido, logado ou auditado.
 */
export class CreateIdentityInvitationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly eligibilityReadRepository: InvitationEligibilityReadRepository,
    private readonly invitationRepositoryFactory: (connection: Queryable) => InvitationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository,
    private readonly tokenGenerator: InvitationTokenGenerator,
    private readonly delivery: InvitationDelivery,
    private readonly ttlSeconds: number,
    /** Base pública da UI do Ingressa (ex.: `https://ingressa-dev.pctec.com.br`). */
    private readonly publicBaseUrl: string,
    /** Caminho da tela de definição de senha. O token vai no FRAGMENTO. */
    private readonly invitePath: string = "/convite"
  ) {}

  public async execute(request: CreateIdentityInvitationRequest): Promise<CreateIdentityInvitationResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const invitedByPublicId = IdentityPublicId.fromString(request.invitedByPublicId).toString();

    // Deduplica preservando a ordem em que o ADMIN selecionou — a tela
    // devolve os resultados na mesma sequência da lista dele.
    const solicitados = [...new Set(request.identityPublicIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    const candidatos = await this.eligibilityReadRepository.loadCandidates(solicitados);
    const porPublicId = new Map(candidatos.map((candidato) => [candidato.identityPublicId, candidato]));

    const results: InvitationOutcome[] = [];
    for (const identityPublicId of solicitados) {
      const candidato = porPublicId.get(identityPublicId);
      const motivo = candidato === undefined ? "IDENTITY_NOT_FOUND" : motivoDeInelegibilidade(candidato);
      if (candidato === undefined || motivo !== null) {
        results.push({
          identityPublicId,
          fullName: candidato?.fullName ?? "",
          outcome: "SKIPPED",
          reasonCode: motivo ?? "IDENTITY_NOT_FOUND",
          invitationPublicId: null,
          expiresAt: null,
          deliveryMode: null,
          delivered: false,
          manualLink: null
        });
        continue;
      }

      results.push(await this.emitirPara(candidato, invitedByPublicId, correlationId));
    }

    return { deliveryMode: this.delivery.mode, results };
  }

  private async emitirPara(
    candidato: InvitationCandidate,
    invitedByPublicId: string,
    correlationId: string
  ): Promise<InvitationOutcome> {
    const rawToken = this.tokenGenerator.generate();
    const tokenHash = hashInvitationToken(rawToken);

    const invitation = await this.unitOfWork.runInTransaction(async (connection) => {
      const invitationRepository = this.invitationRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);
      const agora = new Date();

      const revogados = await invitationRepository.revokePendingByIdentity(
        candidato.identityPublicId,
        agora,
        SUPERSEDED
      );

      const novo = Invitation.create({
        identityPublicId: candidato.identityPublicId,
        tokenHash,
        invitedByPublicId,
        deliveryMode: this.delivery.mode,
        ttlSeconds: this.ttlSeconds,
        correlationId,
        now: agora
      });
      await invitationRepository.insert(novo);

      const eventos = [
        ...revogados.map((revogado) =>
          createInvitationRevokedEvent(
            {
              aggregatePublicId: revogado.getPublicId().toString(),
              actorPublicId: invitedByPublicId,
              correlationId,
              occurredAt: agora
            },
            {
              invitationPublicId: revogado.getPublicId().toString(),
              identityPublicId: revogado.getIdentityPublicId(),
              reason: SUPERSEDED
            }
          )
        ),
        createInvitationCreatedEvent(
          {
            aggregatePublicId: novo.getPublicId().toString(),
            actorPublicId: invitedByPublicId,
            correlationId,
            occurredAt: agora
          },
          {
            invitationPublicId: novo.getPublicId().toString(),
            identityPublicId: novo.getIdentityPublicId(),
            deliveryMode: novo.getDeliveryMode(),
            expiresAt: novo.getExpiresAt().toISOString()
          }
        )
      ];
      await auditEventRepository.insertMany(eventos.map((evento) => AuditEvent.fromDomainEvent(evento)));

      return novo;
    });

    // Entrega só DEPOIS do commit: entregar dentro da transação poderia
    // mandar um link que um rollback posterior tornaria inválido.
    const resultado = await this.delivery.deliver({
      identityPublicId: candidato.identityPublicId,
      fullName: candidato.fullName,
      email: candidato.email,
      link: `${this.publicBaseUrl.replace(/\/+$/, "")}${this.invitePath}#${rawToken}`,
      expiresAt: invitation.getExpiresAt()
    });

    return {
      identityPublicId: candidato.identityPublicId,
      fullName: candidato.fullName,
      outcome: "CREATED",
      reasonCode: null,
      invitationPublicId: invitation.getPublicId().toString(),
      expiresAt: invitation.getExpiresAt().toISOString(),
      deliveryMode: invitation.getDeliveryMode(),
      delivered: resultado.delivered,
      manualLink: resultado.manualLink ?? null
    };
  }
}

/** `null` significa elegível. A ordem é a de diagnóstico mais útil ao ADMIN. */
function motivoDeInelegibilidade(candidato: InvitationCandidate): string | null {
  if (candidato.status !== "ACTIVE") {
    return "IDENTITY_NOT_ACTIVE";
  }
  // Federação REVOGADA barra; ausência total de federação não. Conta
  // criada localmente pelo ADMIN nunca teve referência externa — e não
  // deve ganhar uma para caber numa regra.
  if (candidato.hasExternalReference && !candidato.hasActiveExternalReference) {
    return "IDENTITY_FEDERATION_INACTIVE";
  }
  if (candidato.hasCredential) {
    return "CREDENTIAL_ALREADY_EXISTS";
  }
  if (!candidato.hasApplicationAccess) {
    return "NO_APPLICATION_ACCESS";
  }
  return null;
}
