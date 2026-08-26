import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type EventoDeAuditoria } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Estado, Paginacao } from "../components/ui.js";

/**
 * Resumo legível por tipo de evento.
 *
 * Mapa explícito, e não uma transformação do identificador
 * (`identity.created` → "Identity created"): quem opera lê "Identidade
 * criada", não um nome técnico traduzido pela metade. Um tipo ainda não
 * mapeado cai no próprio identificador — nunca some da lista, porque
 * sumir de uma trilha de auditoria é pior que aparecer feio.
 */
const RESUMO: Readonly<Record<string, string>> = {
  "identity.created": "Identidade criada",
  "identity.activated": "Identidade ativada",
  "identity.blocked": "Identidade bloqueada",
  "identity.unblocked": "Identidade desbloqueada",
  "identity.inactivated": "Identidade inativada",
  "identity.reactivated": "Identidade reativada",
  "identity.deleted": "Identidade excluída logicamente",
  "identity.discarded": "Identidade pendente descartada",
  "identity.name-updated": "Nome atualizado",
  "identity.email-changed": "E-mail alterado",
  "identity.email-change-requested": "Alteração de e-mail solicitada",
  "identity.login-enabled": "Login habilitado",
  "identity.login-disabled": "Login desabilitado",
  "identity-invitation.created": "Convite criado",
  "identity-invitation.revoked": "Convite revogado",
  "identity-invitation.consumed": "Convite aceito",
  "identity-external-reference.created": "Vínculo externo de identidade criado",
  "session.created": "Sessão criada",
  "session.revoked": "Sessão revogada",
  "credential.created": "Senha definida",
  "credential.changed": "Senha alterada",
  "membership.created": "Vínculo criado",
  "membership.updated": "Vínculo alterado ou encerrado",
  "application-access.granted": "Acesso concedido",
  "application-access.revoked": "Acesso revogado",
  "organization.created": "Organização criada",
  "organization.renamed": "Organização renomeada",
  "organization-relationship.created": "Relacionamento entre organizações criado",
  "organization-external-reference.created": "Vínculo externo de organização criado",
  "sso.authorization-code.issued": "Código SSO emitido",
  "sso.authorization-code.consumed": "Código SSO consumido"
};

interface Alvo {
  readonly rota: string;
  readonly rotulo: string;
}

/**
 * Para onde a linha aponta.
 *
 * Nem todo agregado tem tela: convite, sessão, vínculo e acesso não são
 * páginas. Para esses, o destino útil é a PESSOA, que o payload já
 * carrega em `identityPublicId`. Só organização e identidade usam o
 * próprio `aggregate_public_id`.
 *
 * `null` quando não há destino honesto — melhor não oferecer link do que
 * oferecer um que leva a lugar nenhum.
 */
function alvoDoEvento(evento: EventoDeAuditoria): Alvo | null {
  const campos = evento.payload.fields;
  const texto = (chave: string): string | null =>
    typeof campos[chave] === "string" ? (campos[chave] as string) : null;

  const tipo = evento.event_type;

  if (tipo.startsWith("organization.")) {
    return { rota: `/admin/organizacoes/${evento.aggregate_public_id}`, rotulo: "Organização" };
  }
  if (tipo.startsWith("organization-relationship.")) {
    const filho = texto("childOrganizationPublicId");
    return filho === null ? null : { rota: `/admin/organizacoes/${filho}`, rotulo: "Organização" };
  }
  if (tipo.startsWith("organization-external-reference.")) {
    const org = texto("organizationPublicId");
    return org === null ? null : { rota: `/admin/organizacoes/${org}`, rotulo: "Organização" };
  }
  // `identity.` puro — nunca `identity-invitation.` nem
  // `identity-external-reference.`, cujo agregado NÃO é a pessoa.
  if (tipo.startsWith("identity.")) {
    return { rota: `/admin/usuarios/${evento.aggregate_public_id}`, rotulo: "Identidade" };
  }
  const identidade = texto("identityPublicId");
  return identidade === null ? null : { rota: `/admin/usuarios/${identidade}`, rotulo: "Identidade" };
}

function quando(iso: string): string {
  const instante = new Date(iso);
  return Number.isNaN(instante.getTime()) ? iso : instante.toLocaleString();
}

/**
 * Trilha de auditoria — somente leitura, mais recente primeiro.
 *
 * A tela não recalcula nada e não esconde nada por conta própria: a
 * ordenação, o teto de página e a redação do payload são todos do
 * servidor. Aqui só se decide como mostrar.
 */
export function AuditoriaPage(): JSX.Element {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [tipo, setTipo] = useState("");
  const [ator, setAtor] = useState("");
  const [entidade, setEntidade] = useState("");
  const [offset, setOffset] = useState(0);
  const [aberto, setAberto] = useState<EventoDeAuditoria | null>(null);

  const { dados: tipos } = usarRecurso(() => api.auditEventTypes(), []);

  const { dados, carregando, erro } = usarRecurso(() => {
    const params = new URLSearchParams();
    if (de !== "") params.set("from", de);
    if (ate !== "") params.set("to", ate);
    if (tipo !== "") params.set("eventType", tipo);
    if (ator.trim() !== "") params.set("actorPublicId", ator.trim());
    if (entidade.trim() !== "") params.set("aggregatePublicId", entidade.trim());
    params.set("offset", String(offset));
    return api.auditEvents(params);
  }, [de, ate, tipo, ator, entidade, offset]);

  function aoFiltrar(aplicar: () => void): void {
    aplicar();
    // Trocar filtro sem voltar ao início mostraria a página 3 de um
    // resultado novo — quase sempre vazia, e parecendo "não há nada".
    setOffset(0);
  }

  return (
    <>
      <h2>Auditoria</h2>
      <p className="subtitulo">
        Registro imutável do que aconteceu na plataforma, do mais recente para o mais antigo.
      </p>

      <div className="barra">
        <label>
          De{" "}
          <input
            type="date"
            aria-label="Início do período"
            value={de}
            onChange={(e) => aoFiltrar(() => setDe(e.target.value))}
          />
        </label>
        <label>
          Até{" "}
          <input
            type="date"
            aria-label="Fim do período"
            value={ate}
            onChange={(e) => aoFiltrar(() => setAte(e.target.value))}
          />
        </label>
        <select
          aria-label="Filtrar por evento"
          value={tipo}
          onChange={(e) => aoFiltrar(() => setTipo(e.target.value))}
        >
          <option value="">Todos os eventos</option>
          {(tipos?.items ?? []).map((t) => (
            <option key={t} value={t}>{RESUMO[t] ?? t}</option>
          ))}
        </select>
      </div>

      <div className="barra">
        <input
          aria-label="Filtrar por ator"
          placeholder="publicId do ator…"
          value={ator}
          onChange={(e) => aoFiltrar(() => setAtor(e.target.value))}
        />
        <input
          aria-label="Filtrar por entidade"
          placeholder="publicId da entidade afetada…"
          value={entidade}
          onChange={(e) => aoFiltrar(() => setEntidade(e.target.value))}
        />
      </div>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr>
                    <th>Data/hora</th><th>Evento</th><th>Ator</th><th>Entidade afetada</th><th>Resumo</th><th />
                  </tr>
                </thead>
                <tbody>
                  {dados.items.map((evento) => {
                    const alvo = alvoDoEvento(evento);
                    return (
                      <tr key={evento.event_public_id}>
                        <td>{quando(evento.occurred_at)}</td>
                        <td><code>{evento.event_type}</code></td>
                        <td>{evento.actor_full_name ?? <code>{evento.actor_public_id}</code>}</td>
                        <td>
                          {alvo === null ? (
                            <code>{evento.aggregate_public_id}</code>
                          ) : (
                            <Link to={alvo.rota}>{alvo.rotulo}</Link>
                          )}
                        </td>
                        <td>{RESUMO[evento.event_type] ?? evento.event_type}</td>
                        <td>
                          <button type="button" onClick={() => setAberto(evento)}>Detalhe</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginacao total={dados.total} limit={dados.limit} offset={dados.offset} onMudar={setOffset} />
          </>
        )}
      </Estado>

      {aberto !== null && (
        <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Detalhe do evento">
          <div className="modal">
            <h3>{RESUMO[aberto.event_type] ?? aberto.event_type}</h3>
            <dl className="chave-valor">
              <dt>Evento</dt><dd><code>{aberto.event_type}</code> (v{aberto.event_version})</dd>
              <dt>Ocorrido em</dt><dd>{quando(aberto.occurred_at)}</dd>
              <dt>Registrado em</dt><dd>{quando(aberto.persisted_at)}</dd>
              <dt>Ator</dt>
              <dd>
                {aberto.actor_full_name ?? "—"} <code>{aberto.actor_public_id}</code>
              </dd>
              <dt>Entidade afetada</dt><dd><code>{aberto.aggregate_public_id}</code></dd>
              <dt>Correlação</dt><dd><code>{aberto.correlation_id}</code></dd>
              {aberto.causation_id !== null && (
                <>
                  <dt>Causado por</dt><dd><code>{aberto.causation_id}</code></dd>
                </>
              )}
            </dl>

            <h4>Dados do evento</h4>
            {Object.keys(aberto.payload.fields).length === 0 ? (
              <div className="vazio">Sem dados adicionais.</div>
            ) : (
              <div className="tabela-rolavel">
                <table>
                  <thead><tr><th>Campo</th><th>Valor</th></tr></thead>
                  <tbody>
                    {Object.entries(aberto.payload.fields).map(([campo, valor]) => (
                      <tr key={campo}>
                        <td><code>{campo}</code></td>
                        <td>{valor === null ? "—" : String(valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {aberto.payload.redactedFields.length > 0 && (
              <p className="subtitulo">
                Campos redigidos pela política de sigilo: {aberto.payload.redactedFields.join(", ")}. O
                registro existe; o valor não é exibido em lugar nenhum.
              </p>
            )}

            <div className="acoes">
              <button type="button" className="primario" onClick={() => setAberto(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
