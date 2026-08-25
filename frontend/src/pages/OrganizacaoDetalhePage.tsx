import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado } from "../components/ui.js";
import { FormularioEditarOrganizacao } from "../components/formularios.js";

export function OrganizacaoDetalhePage(): JSX.Element {
  const { publicId = "" } = useParams();
  const { dados, carregando, erro, recarregar } = usarRecurso(() => api.organization(publicId), [publicId]);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function salvar(valores: { legalName: string; tradeName: string }): Promise<void> {
    if (dados === null) {
      return;
    }
    setSalvando(true);
    setAviso(null);
    try {
      const resultado = await api.renameOrganization(publicId, {
        legalName: valores.legalName,
        // Sempre enviado: a tela mostra o campo, então o que estiver
        // nele é a intenção — inclusive vazio, que significa limpar.
        tradeName: valores.tradeName,
        expectedVersion: dados.version
      });
      setEditando(false);
      setAviso({
        tipo: "ok",
        texto: resultado.changed
          ? `Organização atualizada (versão ${resultado.version}).`
          : "Nada mudou: o texto enviado era igual ao que já estava salvo."
      });
      // Recarrega do servidor em vez de costurar o novo nome na tela:
      // a versão e o restante do detalhe vêm da fonte, não daqui.
      recarregar();
    } catch (falha) {
      setAviso({
        tipo: "erro",
        texto: falha instanceof ApiError ? falha.message : "Falha inesperada. Nada foi alterado."
      });
      if (falha instanceof ApiError && falha.status === 409) {
        // Conflito de versão: o que está na tela já está velho.
        setEditando(false);
        recarregar();
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <p className="subtitulo"><Link to="/organizacoes">← Organizações</Link></p>
      <Estado carregando={carregando} erro={erro} vazio={dados === null}>
        {dados !== null && (
          <>
            <h2>{dados.legal_name}</h2>
            <p className="subtitulo">{dados.type} · <Badge valor={dados.status} /></p>

            {aviso !== null && (
              <div
                className={`aviso ${aviso.tipo === "ok" ? "aviso-ok" : "aviso-erro"}`}
                role={aviso.tipo === "ok" ? "status" : "alert"}
              >
                {aviso.texto}
              </div>
            )}

            <div className="barra">
              <button type="button" onClick={() => { setAviso(null); setEditando(true); }}>
                Editar organização
              </button>
            </div>

            <dl className="chave-valor">
              <dt>publicId</dt><dd><code>{dados.public_id}</code></dd>
              <dt>Nome fantasia</dt><dd>{dados.trade_name ?? "—"}</dd>
            </dl>

            {editando && (
              <FormularioEditarOrganizacao
                organizacao={dados}
                enviando={salvando}
                onCancelar={() => setEditando(false)}
                onConfirmar={(valores) => { void salvar(valores); }}
              />
            )}

            <div className="secao">
              <h3>Hierarquia</h3>
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
                          <td><Link to={`/organizacoes/${o.public_id}`}>{o.legal_name}</Link></td>
                          <td>{o.type}</td><td><Badge valor={o.status} /></td>
                        </tr>
                      ))}
                      {dados.children.map((o) => (
                        <tr key={`f-${o.public_id}`}>
                          <td>Empresa</td>
                          <td><Link to={`/organizacoes/${o.public_id}`}>{o.legal_name}</Link></td>
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
          </>
        )}
      </Estado>
    </>
  );
}
