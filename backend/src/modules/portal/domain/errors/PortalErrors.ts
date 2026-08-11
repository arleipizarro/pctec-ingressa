import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erro externo único para toda falha de autorização de escopo
 * organizacional dentro do Portal — G3 (v0.6.x).
 *
 * Mesma filosofia já aplicada a `ApplicationAccessDeniedError`
 * (Fase F): colapsa toda causa interna em um único código externo,
 * nunca expõe o motivo real. **Sempre 403 (`AUTHORIZATION`), nunca
 * 404** — devolver 404 aqui esconderia uma inconsistência interna sem
 * decisão formal (task G3, seção 14); 403 é a resposta correta tanto
 * para "esta Organization existe mas não está no seu escopo" quanto
 * para "esta Organization não existe" — em ambos os casos, a resposta
 * para quem pergunta é a mesma: você não tem acesso a ela por este
 * `identityPublicId`.
 *
 * Cobre: `organizationPublicId` fora do `PortalContext` efetivo da
 * Identity, `Organization` inexistente, `Organization` `INACTIVE`
 * (mesmo com `Membership` `ACTIVE` apontando para ela — defesa em
 * profundidade, ver `GetPortalContextService`).
 */
export class OrganizationAccessDeniedError extends DomainError {
  public readonly code = "ORGANIZATION_ACCESS_DENIED";
  public readonly classification = "AUTHORIZATION" as const;

  constructor() {
    super("Acesso negado a esta Organization.");
  }
}
