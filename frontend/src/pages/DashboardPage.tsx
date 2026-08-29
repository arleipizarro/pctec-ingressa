import { Link } from "react-router-dom";
import { api } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado } from "../components/ui.js";
import { rotulo, rotuloDeAcesso, rotuloDeIdentidades } from "../apresentacao.js";

export function DashboardPage(): JSX.Element {
  const { dados, carregando, erro } = usarRecurso(() => api.summary(), []);

  return (
    <>
      <h2>Painel</h2>
      <p className="subtitulo">Situação atual da plataforma.</p>
      <Estado carregando={carregando} erro={erro} vazio={dados === null}>
        {dados !== null && (
          <>
            <div className="cards">
              {dados.identitiesByStatus.map((linha) => (
                <div className="card" key={`i-${linha.status}`}>
                  <div className="rotulo">{rotuloDeIdentidades(linha.status)}</div>
                  <div className="valor">{linha.total}</div>
                </div>
              ))}
              <div className="card">
                <div className="rotulo">Vínculos ativos</div>
                <div className="valor">{dados.activeMemberships}</div>
              </div>
              {dados.grantedAccessesByApplication.map((linha) => (
                <div className="card" key={`a-${linha.applicationCode}-${linha.accessProfile}`}>
                  <div className="rotulo">{rotuloDeAcesso(linha.applicationCode, linha.accessProfile)}</div>
                  <div className="valor">{linha.total}</div>
                </div>
              ))}
            </div>

            {dados.importAlerts.length > 0 && (
              <div className="aviso aviso-erro" role="alert">
                Importações com pendência:{" "}
                {dados.importAlerts.map((a) => `${a.total} ${rotulo(a.action)}`).join(" · ")}
              </div>
            )}

            <div className="secao">
              <h3>Organizações</h3>
              <div className="tabela-rolavel">
                <table>
                  <thead><tr><th>Tipo</th><th>Status</th><th>Total</th></tr></thead>
                  <tbody>
                    {dados.organizationsByTypeStatus.map((linha) => (
                      <tr key={`${linha.type}-${linha.status}`}>
                        <td>{rotulo(linha.type)}</td>
                        <td><Badge valor={linha.status} /></td>
                        <td>{linha.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="secao">
              <h3>Últimos lotes de importação</h3>
              {dados.latestImportBatches.length === 0 ? (
                <div className="vazio">Nenhum lote registrado.</div>
              ) : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Lote</th><th>Origem</th><th>Modo</th><th>Status</th><th>Regras</th></tr></thead>
                    <tbody>
                      {dados.latestImportBatches.map((lote) => (
                        <tr key={lote.public_id}>
                          <td><Link to={`/admin/importacoes/${lote.public_id}`}>{lote.public_id.slice(0, 8)}…</Link></td>
                          <td>{lote.source_system}</td>
                          <td><Badge valor={lote.mode} /></td>
                          <td><Badge valor={lote.status} /></td>
                          <td>{lote.mapping_rules_version}</td>
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
