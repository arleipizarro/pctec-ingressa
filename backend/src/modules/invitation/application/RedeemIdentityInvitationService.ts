import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import type { CredentialRepository } from "../../security/domain/CredentialRepository.js";
import { Credential } from "../../security/domain/Credential.js";
import { CredentialType } from "../../security/domain/value-objects/CredentialType.js";
import { PlainPassword } from "../../security/domain/value-objects/PlainPassword.js";
import type { PasswordHasher } from "../../security/application/BootstrapFirstCredentialService.js";
import type { InvitationRepository } from "../domain/InvitationRepository.js";
import { createInvitationConsumedEvent } from "../domain/events/InvitationDomainEvents.js";
import { InvitationNotUsableError } from "../domain/errors/InvitationErrors.js";
import { hashInvitationToken } from "../infrastructure/token/invitationToken.js";

export interface PreviewInvitationResult {
  readonly fullName: string;
  readonly expiresAt: string;
}

export interface RedeemInvitationRequest {
  readonly token: string;
  readonly password: string;
  readonly passwordConfirmation: string;
  readonly correlationId?: string | undefined;
}

export interface RedeemInvitationResult {
  readonly identityPublicId: string;
  readonly credentialPublicId: string;
  readonly loginEnabled: boolean;
}

/**
 * Consome um convite e cria a `Credential LOCAL_PASSWORD` da pessoa —
 * rota PÚBLICA (quem a usa ainda não tem como autenticar).
 *
 * **Ordem deliberada: política de senha ANTES do consumo.** Uma senha
 * curta demais é erro de digitação, não tentativa de ataque — queimar o
 * convite por isso obrigaria o ADMIN a emitir outro a cada engano. Só
 * depois que a senha é aceita é que o convite é consumido.
 *
 * **Consumo atômico** (`UPDATE ... WHERE status = 'PENDING'`) na mesma
 * transação que cria a Credential e habilita o login: ou a pessoa sai
 * daqui com senha definida e login habilitado, ou nada aconteceu. Duas
 * requisições simultâneas com o mesmo token não podem produzir duas
 * Credentials — e não produzem, porque só uma vence o `UPDATE`.
 *
 * `enableLogin` usa como ator a PRÓPRIA identidade — quem habilitou o
 * login foi ela, ao definir a senha, não a plataforma. Nunca
 * `"BOOTSTRAP"`.
 *
 * **Nunca lê nem altera senha de sistema legado algum.** A senha nasce
 * aqui, escolhida pelo titular, e vive só como hash Argon2id.
 */
export class RedeemIdentityInvitationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly invitationRepositoryFactory: (connection: Queryable) => InvitationRepository,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly credentialRepositoryFactory: (connection: Queryable) => CredentialRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly readOnlyInvitationRepository: InvitationRepository,
    private readonly readOnlyIdentityRepository: IdentityRepository
  ) {}

  /**
   * Abre a tela sem gastar o convite — leitura pura.
   *
   * Devolve só o nome e a validade: o suficiente para a pessoa
   * reconhecer que o convite é dela. Nunca e-mail, nunca publicId — quem
   * abre esta tela ainda não provou ser ninguém.
   */
  public async preview(rawToken: string): Promise<PreviewInvitationResult> {
    const invitation = await this.readOnlyInvitationRepository.findUsableByTokenHash(
      hashInvitationToken(rawToken),
      new Date()
    );
    if (invitation === undefined) {
      throw new InvitationNotUsableError("NOT_FOUND_OR_EXPIRED");
    }
    const identity = await this.readOnlyIdentityRepository.findByPublicId(
      IdentityPublicId.fromString(invitation.getIdentityPublicId())
    );
    if (identity === undefined || identity.getStatus().toString() !== "ACTIVE") {
      throw new InvitationNotUsableError("IDENTITY_NOT_USABLE");
    }
    return {
      fullName: identity.getFullName().toString(),
      expiresAt: invitation.getExpiresAt().toISOString()
    };
  }

  public async execute(request: RedeemInvitationRequest): Promise<RedeemInvitationResult> {
    const correlationId = request.correlationId ?? randomUUID();
    // Política de senha (comprimento mínimo + blacklist, ADR-029) —
    // aplicada pelo MESMO Value Object usado no bootstrap, nunca
    // reimplementada aqui.
    const plainPassword = PlainPassword.createWithConfirmation(request.password, request.passwordConfirmation);
    const tokenHash = hashInvitationToken(request.token);
    const passwordHash = await this.passwordHasher.hash(plainPassword);

    return this.unitOfWork.runInTransaction(async (connection) => {
      const invitationRepository = this.invitationRepositoryFactory(connection);
      const identityRepository = this.identityRepositoryFactory(connection);
      const credentialRepository = this.credentialRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);
      const agora = new Date();

      const invitation = await invitationRepository.consumeByTokenHash(tokenHash, agora);
      if (invitation === undefined) {
        throw new InvitationNotUsableError("NOT_CONSUMABLE");
      }

      const identityPublicId = invitation.getIdentityPublicId();
      const identity = await identityRepository.findByPublicId(IdentityPublicId.fromString(identityPublicId));
      if (identity === undefined || identity.getStatus().toString() !== "ACTIVE") {
        throw new InvitationNotUsableError("IDENTITY_NOT_USABLE");
      }

      // Defesa em profundidade: a elegibilidade já exigiu ausência de
      // credencial na emissão, mas entre emitir e consumir cabe outra
      // coisa ter criado uma. `UNIQUE(identity_public_id, type)` também
      // barraria — com um erro de driver, não com uma resposta de
      // domínio.
      const existente = await credentialRepository.findByIdentityAndType(
        identityPublicId,
        CredentialType.localPassword()
      );
      if (existente !== undefined) {
        throw new InvitationNotUsableError("CREDENTIAL_ALREADY_EXISTS");
      }

      const credential = Credential.createForInvitedIdentity({
        identityPublicId,
        passwordHash,
        correlationId
      });
      await credentialRepository.insert(credential);

      const versaoOriginal = identity.getVersion();
      identity.enableLogin({
        actor: ActorPublicId.fromIdentityPublicId(IdentityPublicId.fromString(identityPublicId)),
        expectedVersion: versaoOriginal,
        correlationId
      });
      if (identity.getVersion() !== versaoOriginal) {
        await identityRepository.update(identity, versaoOriginal);
      }

      const eventos = [
        ...credential.pullDomainEvents(),
        ...identity.pullDomainEvents(),
        createInvitationConsumedEvent(
          {
            aggregatePublicId: invitation.getPublicId().toString(),
            actorPublicId: identityPublicId,
            correlationId,
            occurredAt: agora
          },
          {
            invitationPublicId: invitation.getPublicId().toString(),
            identityPublicId,
            credentialPublicId: credential.getPublicId().toString()
          }
        )
      ];
      await auditEventRepository.insertMany(eventos.map((evento) => AuditEvent.fromDomainEvent(evento)));

      return {
        identityPublicId,
        credentialPublicId: credential.getPublicId().toString(),
        loginEnabled: identity.isLoginEnabled()
      };
    });
  }
}
