import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado, Paginacao } from "../components/ui.js";
import { FormularioNovaOrganizacao } from "../components/formulariosProvisionamento.js";
import type { IntegracaoAposCriacao } from "../api.js";

export function OrganizacoesPage(): JSX.Element {
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [offset, setOffset] = useState(0);
  const [criando, setCriando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);
  const navegar = useNavigate();

  // Grupos para o seletor de associação inicial, carregados junto da
  // tela para o formulário abrir pronto.
  const { dados: grupos } = usarRecurso(
    () => api.organizations(new URLSearchParams({ type: "BUSINESS_GROUP", status: "ACTIVE", limit: "200" })),
    []
  );

  /**
   * Sucesso leva direto ao detalhe da organização criada: é lá que estão
   * as ações seguintes (novo usuário, associação), e voltar para a lista
   * obrigaria a procurar o registro recém-criado no meio das outras.
   */
  async function criar(payload: {
    type: string;
    legalName: string;
    tradeName?: string | undefined;
    documentNumber?: string | undefined;
    parentBusinessGroupPublicId?: string | undefined;
  }): Promise<void> {
    setEnviando(true);
    setErroCriacao(null);
    try {
      const criada = await api.createOrganization(payload);
      setCriando(false);
      // O aviso viaja junto porque a organização JÁ existe e a tela de
      // destino é a certa para agir. Sem ele, um vínculo que não
      // aconteceu ficaria sem explicação: a seção do Portal mostraria
      // "não vinculada" e ninguém saberia se ninguém tentou, se o CNPJ
      // não bateu ou se o Portal estava fora.
      const aviso = avisoDaIntegracao(criada.portalIntegration);
      navegar(`/admin/organizacoes/${criada.publicId}`, aviso === null ? undefined : { state: { aviso } });
    } catch (falha) {
      setErroCriacao(falha instanceof ApiError ? falha.message : "Falha ao criar a organização.");
    } finally {
      setEnviando(false);
    }
  }

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

      {erroCriacao !== null && (
        <div className="aviso aviso-erro" role="alert">{erroCriacao}</div>
      )}

      <div className="barra">
        <button type="button" className="primario" onClick={() => { setErroCriacao(null); setCriando(true); }}>
          Nova organização
        </button>
        {/* A reconciliação mora ao lado das organizações porque é sobre
            elas: classificar as que já existem contra o catálogo do
            Portal e vincular as que têm correspondência exata. */}
        <Link to="/admin/organizacoes/reconciliacao-portal">Reconciliar com o Portal</Link>
      </div>

      {criando && (
        <FormularioNovaOrganizacao
          grupos={grupos?.items ?? []}
          enviando={enviando}
          onCancelar={() => setCriando(false)}
          onConfirmar={(payload) => { void criar(payload); }}
        />
      )}

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
                      <td><Link to={`/admin/organizacoes/${o.public_id}`}>Detalhes</Link></td>
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

/**
 * Traduz o desfecho da correspondência automática numa frase que diz o
 * que fazer a seguir — ou `null` quando não há nada a dizer.
 *
 * `LINKED` e `ALREADY_LINKED` não geram aviso: a própria seção
 * "Integração com o Portal" da tela de destino já mostra o vínculo, e
 * repetir a informação em dois lugares faria as duas divergirem no dia
 * em que uma delas mudasse.
 */
function avisoDaIntegracao(integracao: IntegracaoAposCriacao | undefined): string | null {
  if (integracao === undefined) {
    return null;
  }
  switch (integracao.status) {
    case "LINKED":
    case "ALREADY_LINKED":
    case "NOT_A_COMPANY":
      return null;
    case "NOT_FOUND":
      return "Empresa criada. Nenhum cliente do Portal tem este CNPJ — vincule selecionando o cliente abaixo.";
    case "AMBIGUOUS":
      return (
        "Empresa criada. Mais de um cliente do Portal tem este CNPJ, então nada foi vinculado automaticamente " +
        "— selecione o cliente correto abaixo."
      );
    case "DOCUMENT_MISSING_OR_INVALID":
      return "Empresa criada sem CNPJ. O vínculo com o Portal depende de você selecionar o cliente abaixo.";
    case "SOURCE_NOT_CONFIGURED":
      return (
        "Empresa criada. O catálogo do Portal está indisponível neste servidor, então a correspondência " +
        "automática não chegou a ser tentada."
      );
    default:
      return "Empresa criada. A correspondência automática com o Portal não pôde ser concluída — vincule manualmente.";
  }
}
