import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado } from "../components/ui.js";
import { FormularioAssociarGrupo, FormularioEditarOrganizacao } from "../components/formulariosOrganizacao.js";

type AcaoPendente = { tipo: "editar" } | { tipo: "associar" } | null;

export function OrganizacaoDetalhePage(): JSX.Element {
  const { publicId = "" } = useParams();
  const { dados, carregando, erro, recarregar } = usarRecurso(() => api.organization(publicId), [publicId]);
  // Grupos para o seletor: carregados junto da tela para que o
  // formulário abra pronto, sem um segundo "carregando" dentro do modal.
  const { dados: grupos } = usarRecurso(
    () => api.organizations(new URLSearchParams({ type: "BUSINESS_GROUP", status: "ACTIVE", limit: "200" })),
    []
  );

  const [acao, setAcaoPendente] = useState<AcaoPendente>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  /**
   * Executa uma mutação e reconcilia a tela.
   *
   * O `recarregar()` no sucesso não é cosmético: sem ele a tela
   * continuaria mostrando a `version` anterior, e o próximo salvamento
   * enviaria uma versão velha que o backend recusaria com 409.
   */
  async function executar(operacao: () => Promise<unknown>, sucesso: string): Promise<void> {
    setEnviando(true);
    setMensagem(null);
    try {
      await operacao();
      setMensagem({ tipo: "ok", texto: sucesso });
      setAcaoPendente(null);
      recarregar();
    } catch (falha) {
      // 403, 409 e 422 já chegam como frase em português vinda de
      // `api.ts`; o formulário fica aberto para a pessoa corrigir.
      setMensagem({ tipo: "erro", texto: falha instanceof ApiError ? falha.message : "Falha ao executar a ação." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <p className="subtitulo"><Link to="/admin/organizacoes">← Organizações</Link></p>
      <Estado carregando={carregando} erro={erro} vazio={dados === null}>
        {dados !== null && (
          <>
            <h2>{dados.legal_name}</h2>
            <p className="subtitulo">{dados.type} · <Badge valor={dados.status} /></p>

            {mensagem !== null && (
              <div className={`aviso ${mensagem.tipo === "ok" ? "aviso-ok" : "aviso-erro"}`} role="alert">{mensagem.texto}</div>
            )}

            <dl className="chave-valor">
              <dt>publicId</dt><dd><code>{dados.public_id}</code></dd>
              <dt>Nome fantasia</dt><dd>{dados.trade_name ?? "—"}</dd>
            </dl>

            <div className="secao barra">
              <button type="button" onClick={() => setAcaoPendente({ tipo: "editar" })}>Editar organização</button>
              {/* Associação inicial: só COMPANY, e só enquanto não tem
                  grupo. Trocar ou encerrar não é possível nesta fatia. */}
              {dados.type === "COMPANY" && dados.parents.length === 0 && (
                <button type="button" onClick={() => setAcaoPendente({ tipo: "associar" })}>
                  Associar a um grupo
                </button>
              )}
            </div>

            <div className="secao">
              <h3>Hierarquia</h3>
              {dados.type === "COMPANY" && dados.parents.length > 0 && (
                <p className="subtitulo">
                  Grupo atual: <strong>{dados.parents[0]?.trade_name ?? dados.parents[0]?.legal_name}</strong>. Trocar ou
                  encerrar o vínculo ainda não é possível por esta tela — o relacionamento não tem ciclo de vida no
                  modelo atual, e alterá-lo exigiria apagar o histórico.
                </p>
              )}
              {dados.parents.length === 0 && dados.children.length === 0 ? (
                <div className="vazio">Sem relacionamentos cadastrados.</div>
              ) : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Relação</th><th>Organização</th><th>Tipo</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.parents.map((o) => (
                        <tr key={`p-${o.public_id}`}>
                          <td>Grupo</td>
                          <td><Link to={`/admin/organizacoes/${o.public_id}`}>{o.legal_name}</Link></td>
                          <td>{o.type}</td><td><Badge valor={o.status} /></td>
                        </tr>
                      ))}
                      {dados.children.map((o) => (
                        <tr key={`f-${o.public_id}`}>
                          <td>Empresa</td>
                          <td><Link to={`/admin/organizacoes/${o.public_id}`}>{o.legal_name}</Link></td>
                          <td>{o.type}</td><td><Badge valor={o.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Referências externas</h3>
              {dados.externalReferences.length === 0 ? <div className="vazio">Sem referências externas.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Sistema</th><th>Entidade</th><th>Id legado</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.externalReferences.map((r) => (
                        <tr key={r.public_id}>
                          <td>{r.system_code}</td><td>{r.entity_type}</td><td>{r.legacy_id}</td>
                          <td><Badge valor={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Membros</h3>
              {dados.members.length === 0 ? <div className="vazio">Sem membros.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Pessoa</th><th>Perfil</th><th>Escopo</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.members.map((m) => (
                        <tr key={m.public_id}>
                          <td>{m.full_name}</td><td>{m.profile}</td><td>{m.scope}</td><td><Badge valor={m.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Aplicações dos membros ativos</h3>
              {dados.applications.length === 0 ? <div className="vazio">Nenhum acesso concedido.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Aplicação</th><th>Perfil</th><th>Pessoas</th></tr></thead>
                    <tbody>
                      {dados.applications.map((a) => (
                        <tr key={`${a.application_code}-${a.access_profile}`}>
                          <td>{a.application_code}</td><td>{a.access_profile}</td><td>{a.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {acao?.tipo === "editar" && (
              <FormularioEditarOrganizacao
                organizacao={dados}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(legalName, tradeName) =>
                  void executar(
                    () => api.renameOrganization(publicId, { legalName, tradeName, expectedVersion: dados.version }),
                    "Organização atualizada."
                  )
                }
              />
            )}

            {acao?.tipo === "associar" && (
              <FormularioAssociarGrupo
                grupos={grupos?.items ?? []}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(parentPublicId) =>
                  void executar(
                    () => api.associateParent(publicId, parentPublicId),
                    "Empresa associada ao grupo."
                  )
                }
              />
            )}
          </>
        )}
      </Estado>
    </>
  );
}
