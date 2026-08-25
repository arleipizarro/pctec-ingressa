import { useState } from "react";
import { api, ApiError, type ConviteEmitido } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado, Paginacao } from "../components/ui.js";

/**
 * Motivos de inelegibilidade, em português.
 *
 * Diferente das negativas de autenticação (que colapsam de propósito),
 * aqui o motivo é EXPOSTO: quem lê é o administrador autenticado, que já
 * enxerga a lista inteira — não há enumeração a proteger — e que precisa
 * do motivo para resolver o caso.
 */
const MOTIVOS: Readonly<Record<string, string>> = {
  IDENTITY_NOT_FOUND: "Identidade não encontrada.",
  IDENTITY_NOT_ACTIVE: "A identidade não está ACTIVE.",
  IDENTITY_NOT_FEDERATED: "Não é uma identidade federada (sem referência externa ativa).",
  CREDENTIAL_ALREADY_EXISTS: "Já possui senha definida — convite é só para primeiro acesso.",
  NO_APPLICATION_ACCESS: "Não tem acesso concedido a nenhum aplicativo."
};

/**
 * Emissão administrativa de convites de primeiro acesso.
 *
 * A tela lista identidades e deixa selecionar várias; a ELEGIBILIDADE é
 * decidida no servidor, a cada emissão. Filtrar aqui seria adivinhar:
 * "tem credencial?" e "é federada?" não estão na projeção da listagem, e
 * inventá-las no cliente criaria uma segunda regra para divergir da
 * primeira. Quem não é elegível volta como pulado, com o motivo.
 *
 * No modo `MANUAL_DEV`, o link volta UMA ÚNICA VEZ e é mostrado aqui.
 * Não é reexibível e não fica guardado em lugar nenhum — quem fechar a
 * tela sem copiar precisa emitir outro convite. O aviso na tela diz
 * isso, em vez de dizer "e-mail enviado", que seria falso.
 */
export function ConvitesPage(): JSX.Element {
  const [busca, setBusca] = useState("");
  const [offset, setOffset] = useState(0);
  const [selecionados, setSelecionados] = useState<readonly string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<readonly ConviteEmitido[] | null>(null);
  const [modoDeEntrega, setModoDeEntrega] = useState<string | null>(null);

  const { dados, carregando, erro: erroLista } = usarRecurso(() => {
    const params = new URLSearchParams();
    if (busca.trim().length >= 2) params.set("q", busca.trim());
    // Só identidades ACTIVE podem receber convite — filtrar aqui poupa
    // o administrador de selecionar quem o servidor recusaria, sem
    // substituir a checagem dele.
    params.set("status", "ACTIVE");
    params.set("offset", String(offset));
    return api.identities(params);
  }, [busca, offset]);

  function alternar(publicId: string): void {
    setSelecionados((atual) =>
      atual.includes(publicId) ? atual.filter((id) => id !== publicId) : [...atual, publicId]
    );
  }

  async function convidar(): Promise<void> {
    setErro(null);
    setEnviando(true);
    try {
      const resposta = await api.convidar(selecionados);
      setResultados(resposta.results);
      setModoDeEntrega(resposta.deliveryMode);
      setSelecionados([]);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível emitir os convites.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <h2>Convites de primeiro acesso</h2>
      <p className="subtitulo">
        Para identidades federadas que ainda não têm senha no Ingressa. O convite não envia senha alguma: ele abre, uma
        única vez, a tela onde a própria pessoa define a dela.
      </p>

      <div className="barra">
        <input
          aria-label="Buscar por nome ou e-mail"
          placeholder="Buscar por nome ou e-mail…"
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setOffset(0); }}
        />
        <button
          type="button"
          className="primario"
          disabled={selecionados.length === 0 || enviando}
          onClick={() => void convidar()}
        >
          {enviando ? "Emitindo…" : `Emitir convite (${selecionados.length})`}
        </button>
      </div>

      {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}

      {resultados !== null && (
        <ResultadoDosConvites resultados={resultados} modoDeEntrega={modoDeEntrega} />
      )}

      <Estado carregando={carregando} erro={erroLista} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr><th /><th>Nome</th><th>E-mail</th><th>Status</th><th>Login</th></tr>
                </thead>
                <tbody>
                  {dados.items.map((identidade) => (
                    <tr key={identidade.public_id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${identidade.full_name}`}
                          checked={selecionados.includes(identidade.public_id)}
                          onChange={() => alternar(identidade.public_id)}
                        />
                      </td>
                      <td>{identidade.full_name}</td>
                      <td>{identidade.email}</td>
                      <td><Badge valor={identidade.status} /></td>
                      <td>{identidade.login_enabled === 1 ? "habilitado" : "desabilitado"}</td>
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

function ResultadoDosConvites({
  resultados,
  modoDeEntrega
}: {
  resultados: readonly ConviteEmitido[];
  modoDeEntrega: string | null;
}): JSX.Element {
  const manual = modoDeEntrega === "MANUAL_DEV";
  return (
    <div className="painel-resultado">
      <h3>Resultado</h3>
      {manual && (
        <div className="aviso aviso-alerta" role="alert">
          Entrega manual: <strong>nenhum e-mail foi enviado</strong>. Copie cada link agora e entregue pelo canal que
          você já usa com a pessoa — os links abaixo não são reexibíveis.
        </div>
      )}
      <div className="tabela-rolavel">
        <table>
          <thead>
            <tr><th>Pessoa</th><th>Resultado</th><th>Validade</th><th>Link / motivo</th></tr>
          </thead>
          <tbody>
            {resultados.map((resultado) => (
              <tr key={resultado.identityPublicId}>
                <td>{resultado.fullName === "" ? resultado.identityPublicId : resultado.fullName}</td>
                <td><Badge valor={resultado.outcome === "CREATED" ? "ACTIVE" : "PENDING"} /></td>
                <td>{resultado.expiresAt === null ? "—" : new Date(resultado.expiresAt).toLocaleString("pt-BR")}</td>
                <td>
                  {resultado.manualLink !== null ? (
                    <code className="link-convite">{resultado.manualLink}</code>
                  ) : resultado.reasonCode !== null ? (
                    (MOTIVOS[resultado.reasonCode] ?? resultado.reasonCode)
                  ) : resultado.delivered ? (
                    "Enviado por e-mail."
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
