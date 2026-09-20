import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type PerfilComMembros } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Estado } from "../components/ui.js";

/**
 * Data e hora no fuso de quem lê. Valor inválido devolve o original em
 * vez de "Invalid Date" — o dado cru é mais honesto que um erro
 * disfarçado de data. Mesmo critério de `AuditoriaPage`.
 */
function dataHora(iso: string): string {
  const instante = new Date(iso);
  return Number.isNaN(instante.getTime()) ? iso : instante.toLocaleString();
}

/**
 * Perfis declarados por uma aplicação, e quem os tem.
 *
 * DUAS CAMADAS, DOIS LUGARES. "Acessos por aplicação", na tela da
 * identidade, responde à camada 1 de ADR-007: a pessoa pode ENTRAR no
 * produto? Esta tela responde à camada 2: o que ela faz DENTRO dele.
 * São decisões diferentes, tomadas em momentos diferentes, e por isso
 * não dividem a mesma tabela.
 *
 * As permissões listadas são a declaração da APLICAÇÃO — servem para
 * que quem concede saiba o que está concedendo. Quem as APLICA é o
 * produto consumidor, em código revisado em pull request; este catálogo
 * descreve, nunca decide.
 *
 * Conceder aqui e conceder pela tela do próprio produto são a mesma
 * operação, no mesmo registro: não existe uma segunda lista.
 */

const APLICACOES: Readonly<Record<string, string>> = {
  PCTEC_MEU_RH: "PCTEC Meu RH",
  PCTEC_PORTAL: "Portal do Cliente",
  PCTEC_HELPDESK: "PCTEC Helpdesk",
  PCTEC_INGRESSA: "PCTEC Ingressa"
};

export function PerfisDeAplicacaoPage(): JSX.Element {
  const { applicationCode = "PCTEC_MEU_RH" } = useParams();
  const { dados, carregando, erro, recarregar } = usarRecurso(
    () => api.applicationRoles(applicationCode),
    [applicationCode]
  );
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  async function revogar(perfil: PerfilComMembros, identityPublicId: string, nome: string): Promise<void> {
    setMensagem(null);
    setFalha(null);
    try {
      await api.revokeApplicationRole(identityPublicId, applicationCode, perfil.code);
      setMensagem(`${nome} não tem mais o perfil ${perfil.name}.`);
      recarregar();
    } catch (problema) {
      setFalha(problema instanceof ApiError ? problema.message : "Não foi possível revogar o perfil.");
    }
  }

  const perfis = dados?.roles ?? [];

  return (
    <>
      <h2>Perfis — {APLICACOES[applicationCode] ?? applicationCode}</h2>
      <p className="subtitulo">
        O que cada perfil inclui e quem o tem. Estes perfis valem DENTRO da aplicação; o acesso a ela
        continua sendo concedido em “Acessos por aplicação”, na tela de cada identidade.
      </p>

      {mensagem !== null && (
        <div className="aviso aviso-ok" role="status">
          {mensagem}
        </div>
      )}
      {falha !== null && (
        <div className="aviso aviso-erro" role="alert">
          {falha}
        </div>
      )}

      <Estado
        carregando={carregando}
        erro={erro}
        vazio={perfis.length === 0}
      >
        <>
          {perfis.map((perfil) => (
            <div key={perfil.code} className="secao">
              <h3>{perfil.name}</h3>
              <p className="subtitulo" style={{ marginTop: 0 }}>
                <code>{perfil.code}</code>
              </p>
              <p>{perfil.description}</p>

              <details>
                <summary>{perfil.permissions.length} permissões incluídas</summary>
                <ul>
                  {perfil.permissions.map((permissao) => (
                    <li key={permissao}>
                      <code>{permissao}</code>
                    </li>
                  ))}
                </ul>
              </details>

              <h4>Usuários vinculados ({perfil.members.length})</h4>
              {perfil.members.length === 0 ? (
                <div className="vazio">Nenhum usuário com este perfil.</div>
              ) : (
                <div className="tabela-rolavel">
                  <table>
                    <thead>
                      <tr>
                        <th>Pessoa</th>
                        <th>Concedido em</th>
                        <th>Quem concedeu</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {perfil.members.map((membro) => (
                        <tr key={membro.assignmentPublicId}>
                          <td>
                            <Link to={`/admin/usuarios/${membro.identityPublicId}`}>{membro.fullName}</Link>
                            <br />
                            <small>{membro.email}</small>
                          </td>
                          <td>{dataHora(membro.grantedAt)}</td>
                          <td>{membro.grantedBy ?? "—"}</td>
                          <td>
                            <button
                              type="button"
                              className="perigo"
                              onClick={() => void revogar(perfil, membro.identityPublicId, membro.fullName)}
                            >
                              Revogar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          <p className="subtitulo">
            Para conceder um perfil, abra a identidade em Usuários: a concessão vale no próximo login ou
            renovação de sessão da pessoa.
          </p>
        </>
      </Estado>
    </>
  );
}
