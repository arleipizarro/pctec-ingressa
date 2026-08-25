import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado, Paginacao } from "../components/ui.js";

export function ImportacoesPage(): JSX.Element {
  const [offset, setOffset] = useState(0);
  const { dados, carregando, erro } = usarRecurso(() => {
    const params = new URLSearchParams({ offset: String(offset) });
    return api.importBatches(params);
  }, [offset]);

  return (
    <>
      <h2>Importações</h2>
      <p className="subtitulo">
        Lotes do importador. Esta tela é <strong>somente leitura</strong> — aplicar um lote continua
        sendo operação de CLI, com aprovação explícita.
      </p>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr><th>Lote</th><th>Origem</th><th>Modo</th><th>Status</th><th>Regras</th><th>Itens</th><th /></tr>
                </thead>
                <tbody>
                  {dados.items.map((lote) => (
                    <tr key={lote.public_id}>
                      <td><code>{lote.public_id.slice(0, 8)}…</code></td>
                      <td>{lote.source_system}</td>
                      <td><Badge valor={lote.mode} /></td>
                      <td><Badge valor={lote.status} /></td>
                      <td>{lote.mapping_rules_version}</td>
                      <td>{lote.total_items}</td>
                      <td><Link to={`/importacoes/${lote.public_id}`}>Itens</Link></td>
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
