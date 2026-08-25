import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado, Paginacao } from "../components/ui.js";

const STATUS = ["", "ACTIVE", "PENDING", "BLOCKED", "INACTIVE"];

export function UsuariosPage(): JSX.Element {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const { dados, carregando, erro } = usarRecurso(() => {
    const params = new URLSearchParams();
    if (busca.trim().length >= 2) params.set("q", busca.trim());
    if (status !== "") params.set("status", status);
    params.set("offset", String(offset));
    return api.identities(params);
  }, [busca, status, offset]);

  return (
    <>
      <h2>Usuários</h2>
      <p className="subtitulo">Identidades da plataforma, incluindo as federadas de sistemas externos.</p>

      <div className="barra">
        <input
          aria-label="Buscar por nome ou e-mail"
          placeholder="Buscar por nome ou e-mail…"
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setOffset(0); }}
        />
        <select aria-label="Filtrar por status" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          {STATUS.map((s) => <option key={s} value={s}>{s === "" ? "Todos os status" : s}</option>)}
        </select>
      </div>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr><th>Nome</th><th>E-mail</th><th>Tipo</th><th>Status</th><th>Login</th><th /></tr>
                </thead>
                <tbody>
                  {dados.items.map((identidade) => (
                    <tr key={identidade.public_id}>
                      <td>{identidade.full_name}</td>
                      <td>{identidade.email}</td>
                      <td>{identidade.type}</td>
                      <td><Badge valor={identidade.status} /></td>
                      <td>{identidade.login_enabled === 1 ? "habilitado" : "desabilitado"}</td>
                      <td><Link to={`/admin/usuarios/${identidade.public_id}`}>Detalhes</Link></td>
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
