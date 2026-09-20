import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PerfilDaIdentidade } from "../api.js";

/**
 * Perfis que ESTA identidade tem DENTRO de uma aplicação — camada 2 de
 * ADR-007.
 *
 * Aparece abaixo de "Acessos por aplicação" e é deliberadamente uma
 * seção separada: conceder acesso ao produto e conceder um perfil
 * dentro dele são decisões diferentes, e juntá-las num formulário só
 * faria parecer que uma implica a outra. Não implica — sem acesso
 * GRANTED, a concessão de perfil é recusada pelo servidor.
 *
 * Aplicação que não declara perfil nenhum não renderiza nada: a seção
 * vazia só ocuparia espaço para dizer que não há o que fazer.
 */
export function PerfisDaIdentidade({
  identityPublicId,
  applicationCode,
  nomeDaAplicacao,
  temAcessoConcedido
}: {
  identityPublicId: string;
  applicationCode: string;
  nomeDaAplicacao: string;
  temAcessoConcedido: boolean;
}): JSX.Element | null {
  const [perfis, setPerfis] = useState<readonly PerfilDaIdentidade[] | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { roles } = await api.identityApplicationRoles(identityPublicId, applicationCode);
      setPerfis(roles);
    } catch {
      // Falha ao ler o catálogo não pode derrubar a tela inteira da
      // identidade: a seção some e o resto continua utilizável.
      setPerfis([]);
    }
  }, [identityPublicId, applicationCode]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (perfis === null || perfis.length === 0) {
    return null;
  }

  async function alternar(perfil: PerfilDaIdentidade): Promise<void> {
    setEnviando(perfil.code);
    setFalha(null);
    try {
      if (perfil.granted) {
        await api.revokeApplicationRole(identityPublicId, applicationCode, perfil.code);
      } else {
        await api.grantApplicationRole(identityPublicId, applicationCode, perfil.code);
      }
      await carregar();
    } catch (problema) {
      setFalha(problema instanceof ApiError ? problema.message : "Não foi possível alterar o perfil.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="secao">
      <h3>Perfis em {nomeDaAplicacao}</h3>
      <p className="subtitulo" style={{ marginTop: 0 }}>
        O que a pessoa faz DENTRO da aplicação. Exige acesso concedido a ela; a alteração vale no próximo
        login ou renovação de sessão.
      </p>

      {!temAcessoConcedido && (
        <div className="aviso aviso-alerta" role="status">
          Esta identidade não tem acesso concedido a {nomeDaAplicacao}. Conceda o acesso primeiro — perfil sem
          acesso é uma autorização que não leva a lugar nenhum.
        </div>
      )}
      {falha !== null && (
        <div className="aviso aviso-erro" role="alert">
          {falha}
        </div>
      )}

      <div className="tabela-rolavel">
        <table>
          <thead>
            <tr>
              <th>Perfil</th>
              <th>Inclui</th>
              <th>Concedido em</th>
              <th>Por</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {perfis.map((perfil) => (
              <tr key={perfil.code}>
                <td>
                  <strong>{perfil.name}</strong>
                  <br />
                  <small>{perfil.description}</small>
                </td>
                <td>
                  <details>
                    <summary>{perfil.permissions.length} permissões</summary>
                    <ul>
                      {perfil.permissions.map((permissao) => (
                        <li key={permissao}>
                          <code>{permissao}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td>{perfil.grantedAt === null ? "—" : new Date(perfil.grantedAt).toLocaleString()}</td>
                <td>{perfil.grantedBy ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className={perfil.granted ? "perigo" : ""}
                    disabled={enviando !== null || (!perfil.granted && !temAcessoConcedido)}
                    onClick={() => void alternar(perfil)}
                  >
                    {enviando === perfil.code ? "…" : perfil.granted ? "Revogar" : "Conceder"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
