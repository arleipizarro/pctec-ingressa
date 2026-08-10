import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../../application/domain/ApplicationAccessRepository.js";
import { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import { AccessProfile } from "../../application/domain/value-objects/AccessProfile.js";
import { ApplicationAccessDeniedError } from "../domain/errors/AuthorizationErrors.js";

export interface AuthorizeApplicationAccessRequest {
  readonly identityPublicId: string;
  readonly applicationCode: string;
  readonly requiredProfile: string;
}

export interface AuthorizedApplicationAccess {
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly applicationCode: string;
  readonly accessProfile: string;
}

/**
 * Decide se uma Identity JÁ AUTENTICADA pode acessar uma aplicação com
 * um perfil mínimo exigido — v0.6.x, Fase F (ADR-028, "Authorization /
 * ApplicationAccess Enforcement").
 *
 * **Boundary estrito, nunca cruzado (task, seção 6):**
 * - Nunca retorna `Session` — não é responsabilidade deste serviço saber
 *   que sessões existem.
 * - Nunca autentica senha — recebe `identityPublicId` já provado por
 *   quem chama (o middleware `requireAuthenticatedSession`, antes
 *   deste).
 * - Nunca valida cookie — não conhece HTTP.
 * - Nunca cria `AuthenticatedPrincipal` novo — esse conceito pertence
 *   exclusivamente à autenticação (`ValidateSessionService`).
 *
 * **Resolve aplicação por CÓDIGO, nunca por UUID hardcoded** (task,
 * seção 7) — `applicationCode` chega como string (ex.:
 * `ApplicationCodes.PCTEC_INGRESSA_APPLICATION_CODE`), resolvida aqui
 * via `ApplicationRepository.findByCode()`.
 *
 * **8 regras de autorização (task, seção 8), na ordem verificada:**
 * 1. `Identity` já autenticada — pressuposto pelo chamador (não
 *    reverificado aqui — reverificar autenticação seria papel de
 *    `ValidateSessionService`, não deste serviço).
 * 2. `Application` existe.
 * 3. `Application.status = ACTIVE`.
 * 4. `ApplicationAccess` existe.
 * 5. Pertence à mesma Identity (garantido pela própria consulta —
 *    `findByIdentityAndApplication` já filtra por `identityPublicId`).
 * 6. Pertence à aplicação correta (idem — filtrado por
 *    `applicationPublicId` resolvido).
 * 7. `ApplicationAccess.status = GRANTED`.
 * 8. `accessProfile` satisfaz o perfil exigido.
 *
 * Qualquer falha → `ApplicationAccessDeniedError` (403,
 * `APPLICATION_ACCESS_DENIED`) — nunca 401 (a autenticação já ocorreu
 * antes). Todas as causas colapsam externamente na mesma resposta —
 * `reason` interno distinto, nunca exposto (ver
 * `AuthorizationErrors.ts`).
 */
export class AuthorizeApplicationAccessService {
  public constructor(
    private readonly applicationRepository: ApplicationRepository,
    private readonly applicationAccessRepository: ApplicationAccessRepository
  ) {}

  public async execute(request: AuthorizeApplicationAccessRequest): Promise<AuthorizedApplicationAccess> {
    const applicationCode = ApplicationCode.create(request.applicationCode);
    const requiredProfile = AccessProfile.create(request.requiredProfile);

    const application = await this.applicationRepository.findByCode(applicationCode);
    if (application === undefined) {
      throw new ApplicationAccessDeniedError("APPLICATION_NOT_FOUND");
    }

    if (!application.isActive()) {
      throw new ApplicationAccessDeniedError("APPLICATION_NOT_ACTIVE");
    }

    const applicationAccess = await this.applicationAccessRepository.findByIdentityAndApplication(
      request.identityPublicId,
      application.getPublicId().toString()
    );
    if (applicationAccess === undefined) {
      throw new ApplicationAccessDeniedError("ACCESS_NOT_FOUND");
    }

    if (!applicationAccess.isGranted()) {
      throw new ApplicationAccessDeniedError("ACCESS_NOT_GRANTED");
    }

    if (!applicationAccess.getAccessProfile().equals(requiredProfile)) {
      throw new ApplicationAccessDeniedError("PROFILE_INSUFFICIENT");
    }

    return {
      identityPublicId: request.identityPublicId,
      applicationPublicId: application.getPublicId().toString(),
      applicationCode: application.getCode().toString(),
      accessProfile: applicationAccess.getAccessProfile().toString()
    };
  }
}
