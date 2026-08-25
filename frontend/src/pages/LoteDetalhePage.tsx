import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado, Paginacao } from "../components/ui.js";

const ACOES = ["", "CREATE", "SKIP", "CONFLICT", "QUARANTINE"];

export function LoteDetalhePage(): JSX.Element {
  const { publicId = "" } = useParams();
  const [acao, setAcao] = useState("");
  const [offset, setOffset] = useState(0);

  const { dados, carregando, erro } = usarRecurso(() => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (acao !== "") params.set("action", acao);
    return api.importBatchItems(publicId, params);
  }, [publicId, acao, offset]);

  return (
    <>
      <p className="subtitulo"><Link to="/admin/importacoes">← Importações</Link></p>
      <h2>Itens do lote</h2>
      <p className="subtitulo">
        <code>{publicId}</code> — campos sensíveis aparecem como <span className="redigido">[REDIGIDO]</span>,
        com o nome preservado para auditoria.
      </p>

      <div className="barra">
        <select aria-label="Filtrar por ação" value={acao} onChange={(e) => { setAcao(e.target.value); setOffset(0); }}>
          {ACOES.map((a) => <option key={a} value={a}>{a === "" ? "Todas as ações" : a}</option>)}
        </select>
      </div>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr><th>Origem</th><th>Entidade</th><th>Ação</th><th>Motivo</th><th>Destino</th><th>Snapshot</th></tr>
                </thead>
                <tbody>
                  {dados.items.map((item) => (
                    <tr key={item.public_id}>
                      <td>{item.source_entity_type}:{item.source_legacy_id}</td>
                      <td>{item.entity_kind}</td>
                      <td><Badge valor={item.action} /></td>
                      <td>{item.reason_code ?? "—"}</td>
                      <td>{item.target_public_id === null ? "—" : <code>{item.target_public_id.slice(0, 8)}…</code>}</td>
                      <td>
                        {item.after_snapshot === null ? "—" : (
                          <>
                            {Object.entries(item.after_snapshot.fields).map(([chave, valor]) => (
                              <div key={chave}>
                                <strong>{chave}:</strong>{" "}
                                <span className={valor === "[REDIGIDO]" ? "redigido" : undefined}>{String(valor)}</span>
                              </div>
                            ))}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao total={dados.total} limit={dados.limit} offset={dados.offset} onMudar={setOffset} />
          </>
        )}
      </Estado>
    </>
  );
}
