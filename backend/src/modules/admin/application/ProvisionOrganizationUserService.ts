import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { ExistingConnectionUnitOfWork } from "../../../shared/database/ExistingConnectionUnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import { PublicId as OrganizationPublicId } from "../../organization/domain/value-objects/PublicId.js";
import { MembershipScope } from "../../organization/domain/value-objects/MembershipScope.js";
import { MembershipOrganizationNotFoundError } from "../../organization/domain/errors/MembershipErrors.js";
import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import { ApplicationNotFoundError } from "../../application/domain/errors/ApplicationErrors.js";
import type { CreateIdentityService } from "../../identity/application/CreateIdentityService.js";
import type { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import type { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import {
  UserProvisioningApplicationNotActiveError,
  UserProvisioningApplicationsRequiredError,
  UserProvisioningScopeNotAllowedForCompanyError
} from "./errors/UserProvisioningErrors.js";

/**
 * Perfil de acesso concedido pelo provisionamento — SEMPRE `USER`.
 *
 * Não vem do pedido, e é de propósito. `ADMIN` é administração da
 * plataforma; conceder isso junto com o cadastro faria de uma tela de
 * "criar usuário" um caminho silencioso para criar administrador. A
 * concessão administrativa continua sendo ação separada e explícita, na
 * tela da Identity, onde o ADMIN escolhe o perfil olhando para ela.
 *
 * Fixar aqui, e não na tela, é o que torna a regra real: um POST direto
 * na rota não consegue pedir outro perfil, porque não há campo para isso.
 */
const PERFIL_DE_ACESSO = "USER" as const;

export interface ProvisionOrganizationUserRequest {
  readonly organizationPublicId: string;
  readonly fullName: string;
  readonly email: string;
  readonly membershipProfile: string;
  readonly membershipScope: string;
  /** Códigos de aplicação — ao menos um, todas ACTIVE. */
  readonly applicationCodes: readonly string[];
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface ProvisionedApplicationAccess {
  readonly applicationCode: string;
  readonly accessProfile: string;
}

export interface ProvisionOrganizationUserResult {
  readonly identityPublicId: string;
  readonly fullName: string;
  readonly email: string;
  /** `ACTIVE` — ativada pelo ADMIN nesta mesma transação. */
  readonly status: string;
  /** `false` — só o aceite do convite habilita login. */
  readonly loginEnabled: boolean;
  readonly membership: {
    readonly publicId: string;
    readonly organizationPublicId: string;
    readonly profile: string;
    readonly scope: string;
    readonly status: string;
  };
  readonly applicationAccesses: readonly ProvisionedApplicationAccess[];
}

export interface ProvisionOrganizationUserDeps {
  readonly unitOfWork: UnitOfWork;
  readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository;
  readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository;
  readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
  /**
   * Fábricas, não instâncias: cada serviço precisa nascer sobre a
   * UnitOfWork DESTA transação. Recebê-los prontos os traria amarrados
   * ao pool, que é exatamente o que quebraria a atomicidade.
   */
  readonly createIdentityServiceFactory: (uow: UnitOfWork) => CreateIdentityService;
  readonly createMembershipServiceFactory: (uow: UnitOfWork) => CreateMembershipService;
  readonly grantApplicationAccessServiceFactory: (uow: UnitOfWork) => GrantApplicationAccessService;
}

/**
 * Provisiona uma pessoa dentro de uma organização: Identity, vínculo e
 * acessos — **tudo numa transação só**.
 *
 * ## O que acontece, e em que estado a pessoa fica
 *
 * 1. `Identity.create()` — nasce `PENDING`, `login_enabled = 0`;
 * 2. `identity.activate()` com o ADMIN como ator — `PENDING → ACTIVE`,
 *    transição legítima da máquina de estados, sem SQL manual e sem
 *    forçar coluna;
 * 3. `Membership` na organização escolhida;
 * 4. `ApplicationAccess` GRANTED, perfil `USER`, para cada aplicação.
 *
 * Ao fim: `ACTIVE`, `login_enabled = 0`, **sem Credential**. É o estado
 * exato que o convite exige — e o único que permite à pessoa definir a
 * própria senha depois.
 *
 * ## Por que a ativação é ato do ADMIN, e não do convite
 *
 * O nome "ativada por convite" descreveria outro domínio.
 * `RedeemIdentityInvitationService` EXIGE a Identity já `ACTIVE` (no
 * `preview` e no `execute`) e só chama `enableLogin()` — ele nunca
 * ativa. Deixar a pessoa `PENDING` aqui produziria um convite que o
 * próprio resgate recusaria. Quem ativa é quem cadastrou, e o convite
 * faz o que sempre fez: cria a Credential e liga o login.
 *
 * ## Nenhuma Credential
 *
 * Não há import de `CredentialRepository` neste arquivo. A senha nasce
 * uma vez só, escolhida pelo titular, no resgate do convite.
 *
 * ## O convite NÃO faz parte desta transação
 *
 * De propósito. `CreateIdentityInvitationService` entrega o link DEPOIS
 * do commit — entregar dentro da transação mandaria um link que um
 * rollback posterior tornaria inválido. Então o convite é etapa
 * posterior, chamada pela rota: se falhar, o usuário permanece
 * provisionado e correto, e o ADMIN reemite pela ação "Criar convite"
 * que já existe. Um usuário sem convite é um estado recuperável; um
 * convite sem usuário, não.
 *
 * ## Nenhuma referência externa
 *
 * Pessoa cadastrada aqui não veio do Helpdesk nem do Portal. Nada é
 * inferido de sistema de origem algum.
 */
export class ProvisionOrganizationUserService {
  public constructor(private readonly deps: ProvisionOrganizationUserDeps) {}

  public async execute(
    request: ProvisionOrganizationUserRequest
  ): Promise<ProvisionOrganizationUserResult> {
    // Formato antes de I/O. `MembershipProfile` fica por conta de
    // `CreateMembershipService`, que já o valida — repetir aqui seria a
    // segunda cópia da mesma lista de valores.
    const organizationPublicId = OrganizationPublicId.fromString(request.organizationPublicId);
    const scope = MembershipScope.create(request.membershipScope);
    const actor = ActorPublicId.required(request.actorPublicId);
    const correlationId = request.correlationId ?? randomUUID();

    // Deduplica preservando a ordem da tela; códigos vazios somem.
    const codigos = [...new Set(request.applicationCodes.map((c) => c.trim()).filter((c) => c.length > 0))];
    if (codigos.length === 0) {
      throw new UserProvisioningApplicationsRequiredError();
    }
    const applicationCodes = codigos.map((codigo) => ApplicationCode.create(codigo));

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const interna = new ExistingConnectionUnitOfWork(connection);
      const organizationRepository = this.deps.organizationRepositoryFactory(connection);
      const identityRepository = this.deps.identityRepositoryFactory(connection);
      const applicationRepository = this.deps.applicationRepositoryFactory(connection);
      const auditEventRepository = this.deps.auditEventRepositoryFactory(connection);

      // ---- Tudo que pode reprovar é conferido ANTES da primeira escrita.
      //
      // Não é preciosismo: a alternativa é criar a Identity, falhar na
      // terceira aplicação e depender do rollback. O rollback funciona,
      // mas queima um public_id e um AUTO_INCREMENT a cada engano de
      // digitação — e, mais importante, transforma "aplicação inativa"
      // num erro que só aparece depois de metade do trabalho feito.

      const organizacao = await organizationRepository.findByPublicId(organizationPublicId);
      if (organizacao === undefined) {
        throw new MembershipOrganizationNotFoundError(organizationPublicId.toString());
      }
      // Organização INACTIVE é reprovada por `CreateMembershipService`
      // (`MEMBERSHIP_ORGANIZATION_NOT_ACTIVE`) — não duplico a checagem
      // aqui; o tipo é o que preciso ler agora, para o escopo.
      if (organizacao.getType().isCompany() && scope.includesDescendants()) {
        throw new UserProvisioningScopeNotAllowedForCompanyError();
      }

      const aplicacoes = [];
      for (const applicationCode of applicationCodes) {
        const aplicacao = await applicationRepository.findByCode(applicationCode);
        if (aplicacao === undefined) {
          throw new ApplicationNotFoundError(applicationCode.toString());
        }
        if (!aplicacao.isActive()) {
          throw new UserProvisioningApplicationNotActiveError(applicationCode.toString());
        }
        aplicacoes.push(aplicacao);
      }

      // ---- Escritas.

      // E-mail duplicado vira `IDENTITY_EMAIL_ALREADY_EXISTS` (409) aqui
      // dentro, pelo serviço que já detém a regra.
      const identidade = await this.deps.createIdentityServiceFactory(interna).execute({
        type: "HUMAN",
        fullName: request.fullName,
        email: request.email,
        actorPublicId: actor.toString(),
        correlationId
      });

      // Ativação formal. `CreateIdentityService` não devolve o agregado,
      // então recarrego pela MESMA conexão — a Identity recém-inserida
      // está visível dentro da transação.
      const agregado = await identityRepository.findByPublicId(
        IdentityPublicId.fromString(identidade.publicId)
      );
      if (agregado === undefined) {
        // Inalcançável: acabou de ser inserida NESTA transação, pela
        // MESMA conexão. Se acontecer, é falha de infraestrutura — não
        // um erro de domínio que a tela deva traduzir. Sobe como 500 e
        // o rollback desfaz tudo, que é a resposta certa: nunca seguir
        // adiante com um estado que não se consegue reler.
        throw new Error(
          `Identity ${identidade.publicId} não relida na própria transação que a criou.`
        );
      }
      const versaoOriginal = agregado.getVersion();
      agregado.activate({ actor, expectedVersion: versaoOriginal, correlationId });
      await identityRepository.update(agregado, versaoOriginal);
      await auditEventRepository.insertMany(
        agregado.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento))
      );

      const vinculo = await this.deps.createMembershipServiceFactory(interna).execute({
        identityPublicId: identidade.publicId,
        organizationPublicId: organizationPublicId.toString(),
        profile: request.membershipProfile,
        scope: scope.toString(),
        actorPublicId: actor.toString(),
        correlationId
      });

      const acessos: ProvisionedApplicationAccess[] = [];
      const concessao = this.deps.grantApplicationAccessServiceFactory(interna);
      for (const aplicacao of aplicacoes) {
        const concedido = await concessao.execute({
          identityPublicId: identidade.publicId,
          applicationCode: aplicacao.getCode().toString(),
          accessProfile: PERFIL_DE_ACESSO,
          grantedByIdentityPublicId: actor.toString(),
          correlationId
        });
        acessos.push({
          applicationCode: concedido.applicationCode,
          accessProfile: concedido.accessProfile
        });
      }

      return {
        identityPublicId: identidade.publicId,
        fullName: agregado.getFullName().toString(),
        email: agregado.getEmail().toString(),
        status: agregado.getStatus().toString(),
        loginEnabled: agregado.isLoginEnabled(),
        membership: {
          publicId: vinculo.publicId,
          organizationPublicId: vinculo.organizationPublicId,
          profile: vinculo.profile,
          scope: vinculo.scope,
          status: vinculo.status
        },
        applicationAccesses: acessos
      };
    });
  }
}
