import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado, Paginacao } from "../components/ui.js";

export function OrganizacoesPage(): JSX.Element {
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [offset, setOffset] = useState(0);

  const { dados, carregando, erro } = usarRecurso(() => {
    const params = new URLSearchParams();
    if (tipo !== "") params.set("type", tipo);
    if (busca.trim().length >= 2) params.set("q", busca.trim());
    params.set("offset", String(offset));
    return api.organizations(params);
  }, [tipo, busca, offset]);

  return (
    <>
      <h2>Organizações</h2>
      <p className="subtitulo">Grupos econômicos e empresas.</p>

      <div className="barra">
        <input aria-label="Buscar organização" placeholder="Buscar por razão social…" value={busca}
          onChange={(e) => { setBusca(e.target.value); setOffset(0); }} />
        <select aria-label="Filtrar por tipo" value={tipo} onChange={(e) => { setTipo(e.target.value); setOffset(0); }}>
          <option value="">Todos os tipos</option>
          <option value="BUSINESS_GROUP">BUSINESS_GROUP</option>
          <option value="COMPANY">COMPANY</option>
        </select>
      </div>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="tabela-rolavel">
              <table>
                <thead><tr><th>Razão social</th><th>Nome fantasia</th><th>Tipo</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {dados.items.map((o) => (
                    <tr key={o.public_id}>
                      <td>{o.legal_name}</td>
                      <td>{o.trade_name ?? "—"}</td>
                      <td>{o.type}</td>
                      <td><Badge valor={o.status} /></td>
                      <td><Link to={`/organizacoes/${o.public_id}`}>Detalhes</Link></td>
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
