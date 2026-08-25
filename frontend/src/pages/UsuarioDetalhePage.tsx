import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Confirmacao, Estado } from "../components/ui.js";

type AcaoPendente =
  | { tipo: "ativar" }
  | { tipo: "revogar"; publicId: string; aplicacao: string; version: number }
  | { tipo: "encerrar"; publicId: string; organizacao: string }
  | null;

export function UsuarioDetalhePage(): JSX.Element {
  const { publicId = "" } = useParams();
  const { dados, carregando, erro, recarregar } = usarRecurso(() => api.identity(publicId), [publicId]);

  const [acao, setAcao] = useState<AcaoPendente>(null);
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function confirmar(): Promise<void> {
    if (acao === null) return;
    setConfirmando(true);
    setMensagem(null);
    try {
      if (acao.tipo === "ativar") {
        await api.activateFederated(publicId);
        setMensagem({ tipo: "ok", texto: "Identidade ativada." });
      } else if (acao.tipo === "revogar") {
        // `expectedVersion` sai da linha exibida: se alguém revogou ou
        // reconcedeu enquanto esta tela estava aberta, o backend
        // responde 409 em vez de sobrescrever a decisão do outro.
        await api.revokeAccess(acao.publicId, acao.version);
        setMensagem({ tipo: "ok", texto: "Acesso revogado." });
      } else {
        await api.endMembership(acao.publicId, motivo.trim());
        setMensagem({ tipo: "ok", texto: "Membership encerrado." });
      }
      setAcao(null);
      setMotivo("");
      recarregar();
    } catch (falha) {
      setMensagem({ tipo: "erro", texto: falha instanceof ApiError ? falha.message : "Falha ao executar a ação." });
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <>
      <p className="subtitulo"><Link to="/usuarios">← Usuários</Link></p>
      <Estado carregando={carregando} erro={erro} vazio={dados === null}>
        {dados !== null && (
          <>
            <h2>{dados.full_name}</h2>
            <p className="subtitulo">
              {dados.email} · <Badge valor={dados.status} />{" "}
              {dados.federated && <Badge valor="FEDERADA" />}
            </p>

            {mensagem !== null && (
              <div className={`aviso ${mensagem.tipo === "ok" ? "aviso-ok" : "aviso-erro"}`} role="alert">{mensagem.texto}</div>
            )}

            <dl className="chave-valor">
              <dt>publicId</dt><dd><code>{dados.public_id}</code></dd>
              <dt>Tipo</dt><dd>{dados.type}</dd>
              <dt>Login no Ingressa</dt><dd>{dados.login_enabled === 1 ? "habilitado" : "desabilitado"}</dd>
            </dl>

            {dados.status === "PENDING" && dados.federated && (
              <div className="secao">
                <button type="button" className="primario" onClick={() => setAcao({ tipo: "ativar" })}>
                  Ativar identidade federada
                </button>
              </div>
            )}

            <div className="secao">
              <h3>Referências externas</h3>
              {dados.externalReferences.length === 0 ? <div className="vazio">Sem referências externas.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Sistema</th><th>Entidade</th><th>Id legado</th><th>Vínculo</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.externalReferences.map((r) => (
                        <tr key={r.public_id}>
                          <td>{r.system_code}</td><td>{r.entity_type}</td><td>{r.legacy_id}</td>
                          <td>{r.match_method ?? "—"}</td><td><Badge valor={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Memberships</h3>
              {dados.memberships.length === 0 ? <div className="vazio">Sem memberships.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Organização</th><th>Perfil</th><th>Escopo</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {dados.memberships.map((m) => (
                        <tr key={m.public_id}>
                          <td><Link to={`/organizacoes/${m.organization_public_id}`}>{m.trade_name ?? m.legal_name}</Link></td>
                          <td>{m.profile}</td><td>{m.scope}</td><td><Badge valor={m.status} /></td>
                          <td>
                            {m.status === "ACTIVE" && (
                              <button type="button" className="perigo"
                                onClick={() => setAcao({ tipo: "encerrar", publicId: m.public_id, organizacao: m.trade_name ?? m.legal_name })}>
                                Encerrar
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Acessos por aplicação</h3>
              {dados.applicationAccesses.length === 0 ? <div className="vazio">Sem acessos.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Aplicação</th><th>Perfil</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {dados.applicationAccesses.map((a) => (
                        <tr key={a.public_id}>
                          <td>{a.application_code}</td><td>{a.access_profile}</td><td><Badge valor={a.status} /></td>
                          <td>
                            {a.status === "GRANTED" && (
                              <button type="button" className="perigo"
                                onClick={() => setAcao({ tipo: "revogar", publicId: a.public_id, aplicacao: a.application_code, version: a.version })}>
                                Revogar
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {acao !== null && (
              <Confirmacao
                titulo={
                  acao.tipo === "ativar" ? "Ativar identidade federada"
                    : acao.tipo === "revogar" ? "Revogar acesso"
                      : "Encerrar membership"
                }
                descricao={
                  acao.tipo === "ativar"
                    ? "A identidade passa a ACTIVE e recebe contexto no sistema externo. Nenhuma senha é criada."
                    : acao.tipo === "revogar"
                      ? `O acesso a ${acao.aplicacao} cessa imediatamente. O histórico é preservado.`
                      : `A pessoa deixa de pertencer a ${acao.organizacao}. O histórico é preservado.`
                }
                confirmando={confirmando}
                onConfirmar={confirmar}
                onCancelar={() => { setAcao(null); setMotivo(""); }}
              >
                {acao.tipo === "encerrar" && (
                  <>
                    <label htmlFor="motivo" className="subtitulo">Motivo do encerramento</label>
                    <input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ width: "100%" }} />
                  </>
                )}
              </Confirmacao>
            )}
          </>
        )}
      </Estado>
    </>
  );
}
