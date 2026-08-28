import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, CONFIRMACAO_DA_RECONCILIACAO } from "../api.js";
import { Badge, Estado, Paginacao } from "../components/ui.js";
import { PORTAL_CATALOGO_INDISPONIVEL } from "../components/integracaoPortal.js";
import type {
  EstadoDaReconciliacao,
  ExecucaoDaReconciliacao,
  ItemDaReconciliacao,
  ReconciliacaoDoPortal
} from "../api.js";

/**
 * O que cada estado significa para quem opera — e o que fazer com ele.
 */
const EXPLICACAO: Readonly<Record<EstadoDaReconciliacao, string>> = {
  EXACT_UNIQUE:
    "O CNPJ bate com exatamente um cliente ATIVO do Portal. É o único estado que a execução escreve.",
  NOT_FOUND: "Nenhum cliente do Portal tem este CNPJ. Cadastre a empresa no Portal, ou selecione outro cliente.",
  AMBIGUOUS:
    "Mais de um cliente ATIVO do Portal tem este CNPJ. Nada é escolhido automaticamente — corrija a " +
    "duplicidade no Portal ou selecione manualmente na tela da empresa.",
  INACTIVE_ONLY:
    "O CNPJ existe no Portal, mas só em cliente inativo. Reative o cadastro lá — cadastrar de novo criaria a " +
    "duplicidade que vira ambiguidade.",
  DOCUMENT_MISSING_OR_INVALID:
    "A empresa não tem CNPJ cadastrado no Ingressa. Sem documento não há correspondência — a seleção é manual.",
  ALREADY_LINKED: "Já vinculada ao Portal. A reconciliação não toca em vínculo existente."
};

const ORDEM: readonly EstadoDaReconciliacao[] = [
  "EXACT_UNIQUE",
  "NOT_FOUND",
  "AMBIGUOUS",
  "INACTIVE_ONLY",
  "DOCUMENT_MISSING_OR_INVALID",
  "ALREADY_LINKED"
];

/**
 * Reconciliação das organizações que já existem.
 *
 * É a resposta para "e as empresas cadastradas antes da correspondência
 * automática?" — e a resposta **não** é um script de banco. A mesma
 * tela, a mesma autorização, a mesma auditoria.
 *
 * **Duas etapas, deliberadamente separadas.** A tela abre no dry-run,
 * que não escreve nada; a execução é um segundo ato, com confirmação
 * literal e com a lista das empresas que a pessoa acabou de ver.
 *
 * **Só `EXACT_UNIQUE` é executável**, e não é esta tela que garante
 * isso: o servidor reclassifica cada organização do zero antes de
 * escrever. Aqui, a caixa de seleção simplesmente não existe nos outros
 * estados — oferecer o clique e recusar depois seria pior que não
 * oferecer.
 */
export function ReconciliacaoPortalPage(): JSX.Element {
  const [offset, setOffset] = useState(0);
  const [selecionadas, setSelecionadas] = useState<ReadonlySet<string>>(new Set());
  const [confirmacao, setConfirmacao] = useState("");
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState<ExecucaoDaReconciliacao | null>(null);
  const [erroDaExecucao, setErroDaExecucao] = useState<string | null>(null);

  /**
   * O dry-run tem carregamento próprio em vez de `usarRecurso` por um
   * motivo de contrato: aquele hook reduz a falha a uma frase, e aqui a
   * diferença entre "erro ao carregar" e "a fonte do Portal não está
   * configurada" (503 com código próprio) muda a tela inteira. Um
   * `string` não carrega essa distinção.
   */
  const [dados, setDados] = useState<ReconciliacaoDoPortal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setIndisponivel(false);
    try {
      setDados(await api.portalReconciliationDryRun(new URLSearchParams({ offset: String(offset) })));
    } catch (falha) {
      setDados(null);
      if (falha instanceof ApiError && falha.code === PORTAL_CATALOGO_INDISPONIVEL) {
        setIndisponivel(true);
      } else {
        setErro(falha instanceof ApiError ? falha.message : "Falha ao carregar a reconciliação.");
      }
    } finally {
      setCarregando(false);
    }
  }, [offset]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const recarregar = (): void => {
    void carregar();
  };
  const elegiveis = (dados?.items ?? []).filter((item) => item.status === "EXACT_UNIQUE");
  const podeExecutar =
    selecionadas.size > 0 && confirmacao.trim().toUpperCase() === CONFIRMACAO_DA_RECONCILIACAO && !executando;

  function alternar(publicId: string): void {
    const proxima = new Set(selecionadas);
    if (proxima.has(publicId)) {
      proxima.delete(publicId);
    } else {
      proxima.add(publicId);
    }
    setSelecionadas(proxima);
  }

  async function executar(): Promise<void> {
    setExecutando(true);
    setErroDaExecucao(null);
    setResultado(null);
    try {
      const execucao = await api.portalReconciliationExecute([...selecionadas], CONFIRMACAO_DA_RECONCILIACAO);
      setResultado(execucao);
      setSelecionadas(new Set());
      setConfirmacao("");
      // O dry-run é recarregado depois da execução: as empresas
      // vinculadas agora passam a aparecer como ALREADY_LINKED, e a
      // lista deixa de convidar a repetir a operação.
      recarregar();
    } catch (falha) {
      setErroDaExecucao(
        falha instanceof ApiError ? falha.message : "Falha ao executar a reconciliação."
      );
    } finally {
      setExecutando(false);
    }
  }

  if (indisponivel) {
    return (
      <>
        <p className="subtitulo"><Link to="/admin/organizacoes">← Organizações</Link></p>
        <h2>Reconciliação com o Portal</h2>
        <div className="aviso aviso-erro" role="alert" data-testid="reconciliacao-indisponivel">
          O catálogo do Portal está <strong>indisponível</strong> neste servidor: a configuração da fonte não
          está presente. Nenhuma organização pode ser classificada agora.
        </div>
      </>
    );
  }

  return (
    <>
      <p className="subtitulo"><Link to="/admin/organizacoes">← Organizações</Link></p>
      <h2>Reconciliação com o Portal</h2>
      <p className="subtitulo">
        Empresas ativas do Ingressa, classificadas pela correspondência de <strong>CNPJ</strong> com os clientes
        do Portal. Esta listagem é um <strong>dry-run</strong>: ela não escreve nada.
      </p>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="secao">
              <h3>Situação</h3>
              <dl className="chave-valor">
                {ORDEM.map((estado) => (
                  <div key={estado}>
                    <dt>{estado}</dt>
                    <dd data-testid={`contagem-${estado}`}>{dados.counts[estado]}</dd>
                  </div>
                ))}
              </dl>
              <p className="subtitulo">
                <strong>{dados.eligibleCount}</strong> empresa(s) nesta página podem ser vinculadas
                automaticamente. Nenhum outro estado é executável.
              </p>
            </div>

            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Empresa</th>
                    <th>Estado</th>
                    <th>Cliente do Portal sugerido</th>
                    <th>CNPJ do cliente</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.items.map((item) => (
                    <LinhaDaReconciliacao
                      key={item.organizationPublicId}
                      item={item}
                      selecionada={selecionadas.has(item.organizationPublicId)}
                      onAlternar={() => alternar(item.organizationPublicId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao total={dados.total} limit={dados.limit} offset={dados.offset} onMudar={setOffset} />

            <div className="secao">
              <h3>Executar</h3>
              {elegiveis.length === 0 ? (
                <div className="vazio">Nada a executar nesta página.</div>
              ) : (
                <>
                  <div className="aviso aviso-alerta" role="alert">
                    A execução cria o vínculo das empresas selecionadas. O vínculo vale para{" "}
                    <strong>todos os usuários do Portal</strong> de cada empresa e{" "}
                    <strong>não pode ser trocado nem revogado</strong> por esta tela.
                  </div>
                  <label htmlFor="reconciliacao-confirmacao">
                    Digite <code>{CONFIRMACAO_DA_RECONCILIACAO}</code> para confirmar
                  </label>
                  <input
                    id="reconciliacao-confirmacao"
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                    style={{ width: "100%" }}
                  />
                  <div className="barra">
                    <button
                      type="button"
                      className="primario"
                      disabled={!podeExecutar}
                      onClick={() => { void executar(); }}
                    >
                      {executando
                        ? "Executando…"
                        : `Vincular ${selecionadas.size} empresa(s) selecionada(s)`}
                    </button>
                  </div>
                </>
              )}

              {erroDaExecucao !== null && (
                <div className="aviso aviso-erro" role="alert">{erroDaExecucao}</div>
              )}

              {resultado !== null && (
                <div data-testid="resultado-da-execucao">
                  <div className="aviso aviso-ok" role="status">
                    <strong>{resultado.linked}</strong> vinculada(s), <strong>{resultado.alreadyLinked}</strong>{" "}
                    já vinculada(s), <strong>{resultado.skipped}</strong> ignorada(s),{" "}
                    <strong>{resultado.failed}</strong> com falha.
                  </div>
                  <div className="tabela-rolavel">
                    <table>
                      <thead><tr><th>Empresa</th><th>Desfecho</th><th>Id no Portal</th><th>Motivo</th></tr></thead>
                      <tbody>
                        {resultado.items.map((item) => (
                          <tr key={item.organizationPublicId}>
                            <td>
                              <Link to={`/admin/organizacoes/${item.organizationPublicId}`}>
                                {item.legalName.length > 0 ? item.legalName : item.organizationPublicId}
                              </Link>
                            </td>
                            <td><Badge valor={item.status} /></td>
                            <td>{item.legacyId === null ? "—" : <code>{item.legacyId}</code>}</td>
                            <td>{item.reasonCode ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </Estado>
    </>
  );
}

function LinhaDaReconciliacao({
  item,
  selecionada,
  onAlternar
}: {
  item: ItemDaReconciliacao;
  selecionada: boolean;
  onAlternar: () => void;
}): JSX.Element {
  const executavel = item.status === "EXACT_UNIQUE";
  return (
    <tr>
      <td>
        {/* A caixa só existe onde a execução é possível. Oferecer o
            clique e recusar depois seria pior que não oferecer. */}
        {executavel && (
          <input
            type="checkbox"
            aria-label={`Selecionar ${item.legalName}`}
            checked={selecionada}
            onChange={onAlternar}
          />
        )}
      </td>
      <td>
        <Link to={`/admin/organizacoes/${item.organizationPublicId}`}>{item.legalName}</Link>
        {item.tradeName !== null && <> · {item.tradeName}</>}
        {!item.hasDocument && <> · <em>sem CNPJ</em></>}
      </td>
      <td>
        <Badge valor={item.status} />
        <p className="subtitulo">{EXPLICACAO[item.status]}</p>
      </td>
      <td>{item.suggestedClientName ?? "—"}</td>
      {/* Mascarado, sempre — e é o documento do CLIENTE, não o da
          empresa: o da empresa nunca sai desta resposta. */}
      <td>{item.suggestedClientDocumentMasked ?? "—"}</td>
    </tr>
  );
}
