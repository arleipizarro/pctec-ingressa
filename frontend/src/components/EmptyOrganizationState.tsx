/**
 * G4 (v0.7.x). Zero Organizations é um estado LEGÍTIMO (200, nunca 403
 * — task G4, "Organization": "0 organizations: mostrar estado vazio
 * amigável... Não tratar isso como erro 403"). Renderizado DENTRO do
 * shell autenticado (o usuário está de fato autenticado e autorizado a
 * usar o Portal — só ainda não tem nenhum vínculo comercial).
 */
export function EmptyOrganizationState(): JSX.Element {
  return (
    <div className="empty-org-state">
      <h1>Nenhuma organização vinculada</h1>
      <p>Seu acesso ao PCTEC Ingressa está ativo, mas nenhuma organização está vinculada ao seu usuário.</p>
    </div>
  );
}
