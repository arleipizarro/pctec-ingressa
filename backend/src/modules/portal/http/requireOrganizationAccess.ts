import type { NextFunction, Response } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import { AuthenticationContextMissingError } from "../../authorization/http/requireApplicationAccess.js";
import type { RequireOrganizationAccessService } from "../application/RequireOrganizationAccessService.js";
import { DomainError } from "../../../shared/errors/DomainError.js";

export interface RequireOrganizationAccessOptions {
  /** Nome do parâmetro de rota que carrega o organizationPublicId solicitado (ex.: ":organizationPublicId"). */
  readonly paramName: string;
}

/**
 * Erro de wiring — CRÍTICO para segurança, não apenas cosmético
 * (revisão pré-commit de G3, item 4). `requireOrganizationAccess`
 * exige que `requireApplicationAccess` (`PCTEC_PORTAL`) já tenha
 * rodado ANTES na cadeia — detectado pela presença de
 * `req.authorization` (só preenchido por `requireApplicationAccess`
 * com sucesso). Sem esta checagem, uma rota montada incorretamente como
 * `requireAuthenticatedSession → requireOrganizationAccess` (pulando
 * `requireApplicationAccess`) permitiria que uma Identity com
 * `Membership` válido, mas SEM nenhum `ApplicationAccess(PCTEC_PORTAL)`,
 * alcançasse uma rota comercial do Portal — `GetPortalContextService`/
 * `RequireOrganizationAccessService` nunca consultam `ApplicationAccess`
 * (é um boundary deliberadamente diferente, ver
 * `GetPortalContextService.ts`), então nada mais nesta cadeia impediria
 * isso. Esta checagem é a defesa estrutural contra exatamente esse
 * bypass — falha rápido, nunca silenciosamente permite.
 */
export class OrganizationAccessRequiresApplicationAccessError extends DomainError {
  public readonly code = "ORGANIZATION_ACCESS_REQUIRES_APPLICATION_ACCESS";
  public readonly classification = "AUTHORIZATION" as const;

  constructor() {
    super(
      "requireOrganizationAccess exige que requireApplicationAccess(PCTEC_PORTAL) já tenha rodado antes na cadeia — wiring incorreto."
    );
  }
}

/**
 * Erro de wiring — rota montada com `createRequireOrganizationAccess`
 * mas sem o parâmetro nomeado em `options.paramName` na definição da
 * rota Express. Nunca deveria acontecer em produção (erro de
 * programação na montagem da rota), mesmo princípio de
 * `AuthenticationContextMissingError` (falha sanitizada, não 500 bruto).
 */
export class OrganizationAccessRouteParamMissingError extends DomainError {
  public readonly code = "ORGANIZATION_ACCESS_ROUTE_PARAM_MISSING";
  public readonly classification = "AUTHORIZATION" as const;

  constructor(paramName: string) {
    super(`Parâmetro de rota "${paramName}" ausente — requireOrganizationAccess mal configurado.`);
  }
}

/**
 * Middleware HTTP reutilizável — G3 (v0.6.x). **Pipeline canônico
 * obrigatório, sempre nesta ordem, para qualquer rota comercial futura
 * (formalizado na revisão pré-commit de G3, item 4):**
 *
 * ```
 * requireAuthenticatedSession
 *   → requireApplicationAccess(PCTEC_PORTAL, <perfil permitido>)
 *   → requireOrganizationAccess
 *   → handler comercial
 * ```
 *
 * Exige, nesta ordem: `req.auth` já presente (produzido por
 * `requireAuthenticatedSession`) E `req.authorization` já presente
 * (produzido por `requireApplicationAccess` — checagem NOVA, ver
 * `OrganizationAccessRequiresApplicationAccessError` acima: sem ela,
 * uma Identity com `Membership` válido mas sem `ApplicationAccess(PCTEC_PORTAL)`
 * conseguiria bypassar a exigência de acesso à aplicação). Também exige
 * um `organizationPublicId` como parâmetro de rota; nunca aceita esse
 * valor sem revalidar contra o `PortalContext` efetivo da Identity
 * (task G3, seção 13/14).
 *
 * **Não montado em nenhuma rota real nesta entrega** — G3 não inventa
 * endpoint comercial falso (task, seção 22). Preparado e testado como
 * peça reutilizável para G4+, incluindo o teste estrutural que prova
 * que a checagem de `req.authorization` bloqueia o wiring incorreto
 * descrito acima.
 *
 * Falha sempre repassada via `next(error)`, mesmo padrão de
 * `requireApplicationAccess` — o handler de erro centralizado decide o
 * status HTTP.
 */
export function createRequireOrganizationAccess(
  requireOrganizationAccessService: RequireOrganizationAccessService,
  options: RequireOrganizationAccessOptions
) {
  return function requireOrganizationAccess(req: RequestWithAuthorization, res: Response, next: NextFunction): void {
    if (req.auth === undefined) {
      next(new AuthenticationContextMissingError());
      return;
    }

    if (req.authorization === undefined) {
      next(new OrganizationAccessRequiresApplicationAccessError());
      return;
    }

    const rawOrganizationPublicId = req.params[options.paramName];
    if (rawOrganizationPublicId === undefined || Array.isArray(rawOrganizationPublicId)) {
      next(new OrganizationAccessRouteParamMissingError(options.paramName));
      return;
    }
    const organizationPublicId: string = rawOrganizationPublicId;

    requireOrganizationAccessService
      .execute(req.auth.identityPublicId, organizationPublicId)
      .then(() => next())
      .catch(next);
  };
}
