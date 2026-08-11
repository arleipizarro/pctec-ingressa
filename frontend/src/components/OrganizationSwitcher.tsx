import type { PortalOrganization } from "../api/endpoints.js";

export interface OrganizationSwitcherProps {
  readonly organizations: readonly PortalOrganization[];
  readonly onSelect: (organizationPublicId: string) => void;
}

/**
 * G4 (v0.7.x). Só é renderizado quando há 2+ Organizations sem seleção
 * feita ainda (task G4, "2+ -> permitir escolha explícita"). Usa
 * exclusivamente `publicId` — nunca um índice de array ou ID interno
 * como valor de seleção.
 */
export function OrganizationSwitcher({ organizations, onSelect }: OrganizationSwitcherProps): JSX.Element {
  return (
    <div className="org-switcher">
      <h1>Selecione uma organização</h1>
      <p className="subtitle">Seu usuário está vinculado a mais de uma organização no PCTEC Ingressa.</p>
      <div className="org-switcher-list">
        {organizations.map((org) => (
          <button
            key={org.publicId}
            type="button"
            className="org-option"
            onClick={() => onSelect(org.publicId)}
          >
            <span className="org-option-name">{org.tradeName ?? org.legalName}</span>
            <span className="org-option-type">{org.type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
