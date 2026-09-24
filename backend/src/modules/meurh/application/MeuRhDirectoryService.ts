import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { ExistingConnectionUnitOfWork } from "../../../shared/database/ExistingConnectionUnitOfWork.js";
import { MariaDbMeuRhReadRepository, type IdentidadeNoDiretorio, type IdentidadeResumida, type OrganizacaoResumida } from "../infrastructure/persistence/MariaDbMeuRhReadRepository.js";
import type { CreateIdentityService } from "../../identity/application/CreateIdentityService.js";
import type { CreateOrganizationService } from "../../organization/application/CreateOrganizationService.js";
import type { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import type { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import type { MembershipRepository } from "../../organization/domain/MembershipRepository.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { MembershipProfile } from "../../organization/domain/value-objects/MembershipProfile.js";
import { PCTEC_MEU_RH_APPLICATION_CODE, PCTEC_MEU_RH_APPLICATION_PUBLIC_ID } from "../../application/domain/value-objects/ApplicationCodes.js";
import { Email } from "../../identity/domain/value-objects/Email.js";
import {
  MeuRhActivationActorNotEligibleError,
  MeuRhIdentityNotFoundError,
  MeuRhMembershipNotFoundError,
  MeuRhOrganizationAmbiguousError,
  MeuRhOrganizationNotActiveError
} from "./errors/MeuRhErrors.js";

/**
 * Fronteira service-to-service do PCTEC Meu RH.
 *
 * Existe porque o CRUD de IDENTIDADE pertence ao Ingressa, e não ao
 * produto consumidor (ADR-001). O Meu RH mantém cargo, área, gestor e
 * situação do vínculo no banco DELE; identidade, organização,
 * Membership e ApplicationAccess continuam aqui, escritos pelos mesmos
 * Application Services que a UI administrativa já usa — nenhum caminho
 * de escrita paralelo foi criado para este consumidor.
 *
 * **Toda operação é IDEMPOTENTE.** A importação inicial de colaboradores
 * é reexecutável por desenho, e um endpoint que falhasse na segunda
 * chamada obrigaria o importador a adivinhar o estado antes de agir.
 * "Já existia" é uma resposta de sucesso, com o campo que diz isso.
 *
 * **O que este serviço NUNCA faz:** tocar credencial, senha, hash,
 * provedor de autenticação ou `login_enabled` de quem já existe. O
 * primeiro acesso de uma identidade criada aqui continua passando pelo
 * fluxo de convite do Ingressa, sem exceção e sem atalho.
 */

const PERFIL_DO_VINCULO = "EMPLOYEE";
const ESCOPO_DO_VINCULO = "ORGANIZATION_ONLY";
const PERFIL_DE_ACESSO_PADRAO = "USER";

/**
 * Actor usado quando o Meu RH não informa um. `SYSTEM` é o marcador
 * reservado da plataforma — nunca um UUID inventado fingindo ser uma
 * pessoa.
 */
const ATOR_PADRAO = "SYSTEM";

export interface ResultadoDeOrganizacao {
  readonly organization: OrganizacaoResumida;
  readonly created: boolean;
}

export interface ResultadoDeColaborador {
  readonly identity: IdentidadeResumida;
  readonly identityCreated: boolean;
  readonly membershipCreated: boolean;
  readonly applicationAccessGranted: boolean;
}

/**
 * O que a ativação fez com a identidade, ANTES do convite.
 *
 * - `ACTIVATED`: estava PENDING e passou a ACTIVE agora;
 * - `ALREADY_ACTIVE`: nada a fazer — o convite decide o resto;
 * - `NO_ACCESS`: sem `ApplicationAccess` ao Meu RH, nada foi escrito;
 * - `NOT_ACTIVATABLE`: BLOCKED, INACTIVE etc. — outra decisão, outro fluxo;
 * - `NOT_FOUND`: publicId desconhecido.
 */
export type ResultadoDaAtivacao = "ACTIVATED" | "ALREADY_ACTIVE" | "NO_ACCESS" | "NOT_ACTIVATABLE" | "NOT_FOUND";

export interface MeuRhDirectoryDeps {
  readonly pool: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository;
  readonly membershipRepositoryFactory: (connection: Queryable) => MembershipRepository;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
  readonly createIdentityServiceFactory: (uow: UnitOfWork) => CreateIdentityService;
  readonly createOrganizationServiceFactory: (uow: UnitOfWork) => CreateOrganizationService;
  readonly createMembershipServiceFactory: (uow: UnitOfWork) => CreateMembershipService;
  readonly grantApplicationAccessServiceFactory: (uow: UnitOfWork) => GrantApplicationAccessService;
}

export class MeuRhDirectoryService {
  public constructor(private readonly deps: MeuRhDirectoryDeps) {}

  private leitura(connection: Queryable = this.deps.pool): MariaDbMeuRhReadRepository {
    return new MariaDbMeuRhReadRepository(connection);
  }

  /**
   * Resolve a empresa (COMPANY) pelo nome e a cria se não existir.
   *
   * A busca é pela forma NORMALIZADA (minúsculas, espaços colapsados) e
   * cobre `legal_name` e `trade_name` — é isso que impede "PCTEC
   * Outsourcing", "pctec outsourcing" e " PCTEC  Outsourcing " virarem
   * três empresas.
   *
   * `alsoKnownAs` acrescenta nomes EQUIVALENTES declarados pelo
   * chamador, e existe por um caso real: a empresa já cadastrada no
   * Cadastro Mestre pode estar sob outra grafia do mesmo nome comercial.
   * Sem poder declarar a equivalência, a resolução criaria uma segunda
   * COMPANY para uma empresa que já existe — que é justamente a
   * duplicidade que este método deveria impedir. A equivalência é
   * CONFIGURAÇÃO explícita, nunca heurística de semelhança: adivinhar
   * que dois nomes parecidos são a mesma empresa erraria no dia em que
   * duas empresas de verdade tivessem nomes parecidos.
   *
   * Sempre COMPANY, nunca BUSINESS_GROUP: um grupo empresarial não
   * emprega ninguém, e o vínculo de colaborador é com a empresa.
   *
   * Mais de uma correspondência é RECUSADA, nunca resolvida por chute.
   */
  public async garantirOrganizacao(entrada: {
    readonly legalName: string;
    readonly tradeName?: string | undefined;
    readonly alsoKnownAs?: readonly string[] | undefined;
    readonly actorPublicId?: string | undefined;
    readonly correlationId?: string | undefined;
  }): Promise<ResultadoDeOrganizacao> {
    const nome = entrada.legalName.trim().replace(/\s+/g, " ");
    const correlationId = entrada.correlationId ?? randomUUID();
    const nomesEquivalentes = [nome, ...(entrada.alsoKnownAs ?? [])];

    const candidatas = await this.leitura().organizacoesPorNome(nomesEquivalentes, "COMPANY");
    if (candidatas.length > 1) {
      throw new MeuRhOrganizationAmbiguousError(nome, candidatas.length);
    }
    const existente = candidatas[0];
    if (existente !== undefined) {
      if (existente.status !== "ACTIVE") {
        throw new MeuRhOrganizationNotActiveError();
      }
      return { organization: existente, created: false };
    }

    const criada = await this.deps
      .createOrganizationServiceFactory(this.deps.unitOfWork)
      .execute({
        type: "COMPANY",
        legalName: nome,
        ...(entrada.tradeName === undefined ? {} : { tradeName: entrada.tradeName }),
        actorPublicId: entrada.actorPublicId ?? ATOR_PADRAO,
        correlationId
      });

    // Relê pela projeção para devolver exatamente a mesma forma do
    // caminho "já existia" — dois formatos diferentes para o mesmo
    // recurso é o tipo de detalhe que quebra o cliente só na segunda
    // execução.
    const confirmada = (await this.leitura().organizacoesPorNome([nome], "COMPANY"))[0];
    return {
      organization: confirmada ?? {
        publicId: criada.publicId,
        type: criada.type,
        legalName: nome,
        tradeName: entrada.tradeName ?? null,
        status: criada.status
      },
      created: true
    };
  }

  public async identidadePorEmail(email: string): Promise<IdentidadeResumida | null> {
    // `Email.create()` é o MESMO normalizador usado na escrita de
    // identidade. Reimplementar "minúsculas e trim" aqui garantiria que,
    // no primeiro caso de borda, a busca e a gravação discordariam.
    const normalizado = Email.create(email).normalized();
    return (await this.leitura().identidadePorEmailNormalizado(normalizado)) ?? null;
  }

  public async identidade(publicId: string): Promise<IdentidadeResumida> {
    const identidade = await this.leitura().identidadePorPublicId(publicId);
    if (identidade === undefined) {
      throw new MeuRhIdentityNotFoundError();
    }
    return identidade;
  }

  public async diretorio(organizationPublicId: string): Promise<readonly IdentidadeNoDiretorio[]> {
    return this.leitura().diretorioDaOrganizacao(organizationPublicId);
  }

  public async perfilDeAcesso(identityPublicId: string): Promise<string | null> {
    return (await this.leitura().perfilDeAcesso(identityPublicId, PCTEC_MEU_RH_APPLICATION_PUBLIC_ID)) ?? null;
  }

  /**
   * Garante identidade + vínculo EMPLOYEE + acesso a PCTEC_MEU_RH.
   *
   * Os três passos rodam na MESMA transação: uma identidade criada sem
   * vínculo, ou um vínculo sem acesso, é um estado intermediário que
   * ninguém pediu e que a próxima execução teria de adivinhar como
   * consertar.
   *
   * Reconciliação por E-MAIL NORMALIZADO. Quem já existe é reaproveitado
   * como está: nome, status, `login_enabled`, credencial e provedor
   * permanecem intocados. Criar identidade só acontece quando o e-mail
   * não corresponde a nenhuma.
   */
  public async garantirColaborador(entrada: {
    readonly organizationPublicId: string;
    readonly fullName: string;
    readonly email: string;
    readonly accessProfile?: string | undefined;
    readonly actorPublicId?: string | undefined;
    readonly correlationId?: string | undefined;
  }): Promise<ResultadoDeColaborador> {
    const correlationId = entrada.correlationId ?? randomUUID();
    const ator = entrada.actorPublicId ?? ATOR_PADRAO;
    const perfilDeAcesso = entrada.accessProfile ?? PERFIL_DE_ACESSO_PADRAO;
    const emailNormalizado = Email.create(entrada.email).normalized();

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const interna = new ExistingConnectionUnitOfWork(connection);
      const leitura = this.leitura(connection);

      let identidade = await leitura.identidadePorEmailNormalizado(emailNormalizado);
      let identityCreated = false;

      if (identidade === undefined) {
        const criada = await this.deps.createIdentityServiceFactory(interna).execute({
          type: "HUMAN",
          fullName: entrada.fullName,
          email: entrada.email,
          actorPublicId: ator,
          correlationId
        });
        identidade = await leitura.identidadePorPublicId(criada.publicId);
        if (identidade === undefined) {
          throw new MeuRhIdentityNotFoundError();
        }
        identityCreated = true;
      }

      const membershipRepository = this.deps.membershipRepositoryFactory(connection);
      const jaTemVinculo = await membershipRepository.existsByIdentityOrganizationAndProfile(
        identidade.publicId,
        entrada.organizationPublicId,
        MembershipProfile.create(PERFIL_DO_VINCULO)
      );

      let membershipCreated = false;
      if (!jaTemVinculo) {
        await this.deps.createMembershipServiceFactory(interna).execute({
          identityPublicId: identidade.publicId,
          organizationPublicId: entrada.organizationPublicId,
          profile: PERFIL_DO_VINCULO,
          scope: ESCOPO_DO_VINCULO,
          actorPublicId: ator,
          correlationId
        });
        membershipCreated = true;
      }

      const perfilAtual = await leitura.perfilDeAcesso(identidade.publicId, PCTEC_MEU_RH_APPLICATION_PUBLIC_ID);
      let applicationAccessGranted = false;
      if (perfilAtual === undefined) {
        await this.deps.grantApplicationAccessServiceFactory(interna).execute({
          identityPublicId: identidade.publicId,
          applicationCode: PCTEC_MEU_RH_APPLICATION_CODE,
          accessProfile: perfilDeAcesso,
          grantedByIdentityPublicId: identidade.publicId,
          correlationId
        });
        applicationAccessGranted = true;
      }
      // Perfil já concedido NUNCA é elevado aqui. Promover alguém a
      // ADMIN é um ato administrativo deliberado, e não um efeito
      // colateral de reexecutar uma importação.

      return { identity: identidade, identityCreated, membershipCreated, applicationAccessGranted };
    });
  }

  /**
   * Encerra ou reativa o vínculo EMPLOYEE da identidade com a empresa.
   *
   * Pedir o estado em que o vínculo JÁ está é sucesso silencioso
   * (`changed: false`), e não conflito: o Meu RH chama isto ao ativar e
   * desativar colaborador, e uma reexecução de um comando já aplicado
   * não é erro de quem chamou.
   */
  public async definirSituacaoDoVinculo(entrada: {
    readonly identityPublicId: string;
    readonly organizationPublicId: string;
    readonly status: "ACTIVE" | "INACTIVE";
    readonly reason?: string | undefined;
    readonly actorPublicId?: string | undefined;
    readonly correlationId?: string | undefined;
  }): Promise<{ membership: { publicId: string; status: string }; changed: boolean }> {
    const correlationId = entrada.correlationId ?? randomUUID();
    const ator = entrada.actorPublicId ?? ATOR_PADRAO;
    const motivo = entrada.reason ?? "PCTEC Meu RH — mudança de situação do colaborador";

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const membershipRepository = this.deps.membershipRepositoryFactory(connection);
      const auditEventRepository = this.deps.auditEventRepositoryFactory(connection);

      const vinculos = await membershipRepository.findAllByIdentityPublicId(entrada.identityPublicId);
      const vinculo = vinculos.find(
        (candidato) =>
          candidato.getOrganizationPublicId() === entrada.organizationPublicId &&
          candidato.getProfile().toString() === PERFIL_DO_VINCULO
      );
      if (vinculo === undefined) {
        throw new MeuRhMembershipNotFoundError();
      }

      if (vinculo.getStatus() === entrada.status) {
        return { membership: { publicId: vinculo.getPublicId().toString(), status: vinculo.getStatus() }, changed: false };
      }

      const versaoEsperada = vinculo.getVersion();
      if (entrada.status === "INACTIVE") {
        vinculo.end({ actorPublicId: ator, reason: motivo, correlationId });
      } else {
        vinculo.reactivate({ actorPublicId: ator, reason: motivo, correlationId });
      }

      await membershipRepository.update(vinculo, versaoEsperada);
      await auditEventRepository.insertMany(vinculo.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento)));

      return { membership: { publicId: vinculo.getPublicId().toString(), status: vinculo.getStatus() }, changed: true };
    });
  }

  /**
   * Primeiro passo do fluxo oficial de ativação: PENDING → ACTIVE.
   *
   * **Por que existe.** O importador cria as identidades dos
   * colaboradores em PENDING, e o convite de primeiro acesso EXIGE
   * ACTIVE (`CreateIdentityInvitationService`). A rota de ativação do Meu
   * RH chamava só o convite — que respondia `SKIPPED/IDENTITY_NOT_ACTIVE`
   * para exatamente as pessoas que ela deveria ativar. O participante
   * recebia o questionário, nunca recebia senha, e o login do Ingressa
   * recusava qualquer tentativa.
   *
   * A transição é a do domínio (`identity.activate()`), com ator real e
   * evento `identity.activated` — nunca UPDATE de status. Não toca
   * credencial nem `login_enabled`: esses continuam nascendo só no
   * resgate do convite, pela própria pessoa.
   *
   * Só ativa quem já tem `ApplicationAccess` ao Meu RH — é o acesso que
   * dá propósito à ativação — e só a pedido de um ator ACTIVE que também
   * o tem. Qualquer outro estado que não PENDING fica como está.
   */
  public async ativarParaPrimeiroAcesso(entrada: {
    readonly identityPublicId: string;
    readonly actorPublicId: string;
    readonly correlationId?: string | undefined;
  }): Promise<ResultadoDaAtivacao> {
    const correlationId = entrada.correlationId ?? randomUUID();
    const ator = ActorPublicId.required(IdentityPublicId.fromString(entrada.actorPublicId).toString());
    const alvo = IdentityPublicId.fromString(entrada.identityPublicId);

    if ((await this.perfilDeAcesso(ator.toString())) === null) {
      throw new MeuRhActivationActorNotEligibleError();
    }
    if ((await this.perfilDeAcesso(alvo.toString())) === null) {
      return "NO_ACCESS";
    }

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.deps.identityRepositoryFactory(connection);
      const auditEventRepository = this.deps.auditEventRepositoryFactory(connection);

      const quemPede = await identityRepository.findByPublicId(IdentityPublicId.fromString(ator.toString()));
      if (quemPede === undefined || quemPede.getStatus().toString() !== "ACTIVE") {
        throw new MeuRhActivationActorNotEligibleError();
      }

      const identidade = await identityRepository.findByPublicId(alvo);
      if (identidade === undefined) {
        return "NOT_FOUND";
      }
      const status = identidade.getStatus().toString();
      if (status === "ACTIVE") {
        return "ALREADY_ACTIVE";
      }
      if (status !== "PENDING") {
        return "NOT_ACTIVATABLE";
      }

      const versaoOriginal = identidade.getVersion();
      identidade.activate({ actor: ator, expectedVersion: versaoOriginal, correlationId });
      await identityRepository.update(identidade, versaoOriginal);
      await auditEventRepository.insertMany(
        identidade.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento))
      );
      return "ACTIVATED";
    });
  }
}
