import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Estado } from "../components/ui.js";
import { FormularioAssociarGrupo, FormularioEditarOrganizacao } from "../components/formulariosOrganizacao.js";
import { FormularioNovoUsuario, ResultadoDoProvisionamento } from "../components/formulariosProvisionamento.js";
import {
  FormularioVincularPortal,
  MOTIVOS_DO_VINCULO,
  PORTAL_CATALOGO_INDISPONIVEL,
  SecaoIntegracaoPortal
} from "../components/integracaoPortal.js";
import type { CorrespondenciaDoPortal, UsuarioProvisionado } from "../api.js";
import { rotulo } from "../apresentacao.js";

type AcaoPendente =
  | { tipo: "editar" }
  | { tipo: "associar" }
  | { tipo: "novoUsuario" }
  | { tipo: "vincularPortal" }
  | null;

export function OrganizacaoDetalhePage(): JSX.Element {
  const { publicId = "" } = useParams();
  /**
   * Aviso trazido pela criação da organização.
   *
   * A criação acontece na tela anterior e termina aqui; quando a
   * correspondência automática com o Portal não vinculou, o motivo
   * precisa chegar junto — senão a seção do Portal diria "não
   * vinculada" sem explicar se ninguém tentou, se o CNPJ não bateu ou
   * se o Portal estava fora.
   */
  const avisoDaCriacao = (useLocation().state as { aviso?: string } | null)?.aviso ?? null;
  const { dados, carregando, erro, recarregar } = usarRecurso(() => api.organization(publicId), [publicId]);
  // Grupos para o seletor: carregados junto da tela para que o
  // formulário abra pronto, sem um segundo "carregando" dentro do modal.
  const { dados: grupos } = usarRecurso(
    () => api.organizations(new URLSearchParams({ type: "BUSINESS_GROUP", status: "ACTIVE", limit: "200" })),
    []
  );

  // Aplicações para o formulário de provisionamento. Carregadas junto da
  // tela pelo mesmo motivo dos grupos: o modal abre pronto.
  const { dados: aplicacoes } = usarRecurso(() => api.applications(), []);

  const [acao, setAcaoPendente] = useState<AcaoPendente>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  /**
   * Resultado do provisionamento, exibido num painel próprio.
   *
   * Não cabe em `mensagem`: além de "deu certo", ele carrega o link do
   * convite, que aparece UMA vez. Uma faixa de sucesso que some ao
   * recarregar a lista levaria o link junto.
   */
  const [provisionado, setProvisionado] = useState<UsuarioProvisionado | null>(null);

  /**
   * Correspondência automática por CNPJ, carregada quando o formulário
   * de vínculo abre.
   *
   * **Fora do carregamento da organização, de propósito.** O catálogo do
   * Portal é um banco de fora e pode estar indisponível; embutir esta
   * consulta em `api.organization` faria uma queda do Portal derrubar a
   * tela inteira de detalhes, que não depende dele para nada.
   */
  const [correspondencia, setCorrespondencia] = useState<CorrespondenciaDoPortal | null>(null);
  const [correspondenciaCarregando, setCorrespondenciaCarregando] = useState(false);
  const [catalogoIndisponivel, setCatalogoIndisponivel] = useState(false);

  async function abrirVinculoDoPortal(): Promise<void> {
    setAcaoPendente({ tipo: "vincularPortal" });
    setCorrespondencia(null);
    setCatalogoIndisponivel(false);
    setCorrespondenciaCarregando(true);
    try {
      setCorrespondencia(await api.portalMatch(publicId));
    } catch (falha) {
      // 503 é "ninguém perguntou ao Portal", e a tela diz isso em vez de
      // "nada encontrado" — são fatos diferentes.
      setCatalogoIndisponivel(falha instanceof ApiError && falha.code === PORTAL_CATALOGO_INDISPONIVEL);
    } finally {
      setCorrespondenciaCarregando(false);
    }
  }

  /**
   * Executa uma mutação e reconcilia a tela.
   *
   * O `recarregar()` no sucesso não é cosmético: sem ele a tela
   * continuaria mostrando a `version` anterior, e o próximo salvamento
   * enviaria uma versão velha que o backend recusaria com 409.
   */
  async function executar(operacao: () => Promise<unknown>, sucesso: string): Promise<void> {
    setEnviando(true);
    setMensagem(null);
    try {
      await operacao();
      setMensagem({ tipo: "ok", texto: sucesso });
      setAcaoPendente(null);
      recarregar();
    } catch (falha) {
      // 403, 409 e 422 já chegam como frase em português vinda de
      // `api.ts`; o formulário fica aberto para a pessoa corrigir.
      setMensagem({ tipo: "erro", texto: falha instanceof ApiError ? falha.message : "Falha ao executar a ação." });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * O provisionamento tem caminho próprio, e não passa por `executar()`.
   *
   * `executar()` fecha o modal e recarrega a tela no sucesso — e é
   * exatamente o que NÃO pode acontecer aqui: o resultado precisa
   * sobreviver na tela para o ADMIN copiar o link do convite. Aqui o
   * modal fecha, o painel de resultado abre, e o recarregamento só
   * acontece quando ele é fechado.
   */
  async function provisionarUsuario(payload: {
    fullName: string;
    email: string;
    membershipProfile: string;
    membershipScope: string;
    applicationCodes: readonly string[];
    sendInvitation: boolean;
  }): Promise<void> {
    setEnviando(true);
    setMensagem(null);
    try {
      const resultado = await api.createOrganizationUser(publicId, payload);
      setAcaoPendente(null);
      setProvisionado(resultado);
    } catch (falha) {
      setMensagem({ tipo: "erro", texto: falha instanceof ApiError ? falha.message : "Falha ao criar o usuário." });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Vínculo com o Portal, a partir de um cliente escolhido no catálogo.
   *
   * Usa `confirmPortalSelection`, e **não** `linkPortalReference`. A
   * diferença é o ponto desta tela: o `legacyId` daqui veio de uma lista
   * que o próprio servidor montou, e devolvê-lo sem que ele seja
   * reconferido trataria a resposta anterior como autoridade. Entre a
   * busca e o clique o cliente pode ter sido desativado ou removido no
   * Portal — a rota de confirmação relê a fonte e recusa nesses casos.
   *
   * `linkPortalReference` continua existindo para o vínculo operacional
   * por identificador já conhecido, que funciona mesmo com a fonte fora
   * do ar. Ela não é o caminho de uma seleção feita no catálogo.
   *
   * No sucesso, `recarregar()` traz a cobertura nova do servidor — é
   * isso que faz a seção e o formulário de usuário mudarem de estado sem
   * recarregar a página inteira. Recalcular a cobertura localmente daria
   * a mesma tela por um segundo e divergiria do servidor no seguinte.
   *
   * A mensagem de erro vem do `code`, não do status: "este cliente foi
   * inativado" e "o registro mudou desde que a tela carregou" são os
   * dois 409, e só o código os distingue.
   */
  async function vincularAoPortal(legacyId: number): Promise<void> {
    setEnviando(true);
    setMensagem(null);
    try {
      const resultado = await api.confirmPortalSelection(publicId, legacyId);
      setMensagem({
        tipo: "ok",
        texto: resultado.alreadyLinked
          ? "Esta empresa já estava vinculada a este cliente do Portal."
          : "Empresa vinculada ao Portal."
      });
      setAcaoPendente(null);
      recarregar();
    } catch (falha) {
      const texto =
        falha instanceof ApiError
          ? MOTIVOS_DO_VINCULO[falha.code] ?? falha.message
          : "Falha ao vincular ao Portal.";
      setMensagem({ tipo: "erro", texto });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <p className="subtitulo"><Link to="/admin/organizacoes">← Organizações</Link></p>
      <Estado carregando={carregando} erro={erro} vazio={dados === null}>
        {dados !== null && (
          <>
            <h2>{dados.legal_name}</h2>
            <p className="subtitulo">{rotulo(dados.type)} · <Badge valor={dados.status} /></p>

            {mensagem === null && avisoDaCriacao !== null && (
              <div className="aviso aviso-alerta" role="status" data-testid="aviso-da-criacao">{avisoDaCriacao}</div>
            )}

            {mensagem !== null && (
              <div className={`aviso ${mensagem.tipo === "ok" ? "aviso-ok" : "aviso-erro"}`} role="alert">{mensagem.texto}</div>
            )}

            <dl className="chave-valor">
              <dt>publicId</dt><dd><code>{dados.public_id}</code></dd>
              <dt>Nome fantasia</dt><dd>{dados.trade_name ?? "—"}</dd>
            </dl>

            <div className="secao barra">
              <button type="button" onClick={() => setAcaoPendente({ tipo: "editar" })}>Editar organização</button>
              {/* Provisionar em organização INACTIVE terminaria em
                  MEMBERSHIP_ORGANIZATION_NOT_ACTIVE no servidor — não
                  ofereço o caminho que já se sabe que falha. */}
              {dados.status === "ACTIVE" && (
                <button type="button" onClick={() => setAcaoPendente({ tipo: "novoUsuario" })}>
                  Novo usuário
                </button>
              )}
              {/* Associação inicial: só COMPANY, e só enquanto não tem
                  grupo. Trocar ou encerrar não é possível nesta fatia. */}
              {dados.type === "COMPANY" && dados.parents.length === 0 && (
                <button type="button" onClick={() => setAcaoPendente({ tipo: "associar" })}>
                  Associar a um grupo
                </button>
              )}
            </div>

            <div className="secao">
              <h3>Hierarquia</h3>
              {dados.type === "COMPANY" && dados.parents.length > 0 && (
                <p className="subtitulo">
                  Grupo atual: <strong>{dados.parents[0]?.trade_name ?? dados.parents[0]?.legal_name}</strong>. Trocar ou
                  encerrar o vínculo ainda não é possível por esta tela — o relacionamento não tem ciclo de vida no
                  modelo atual, e alterá-lo exigiria apagar o histórico.
                </p>
              )}
              {dados.parents.length === 0 && dados.children.length === 0 ? (
                <div className="vazio">Sem relacionamentos cadastrados.</div>
              ) : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Relação</th><th>Organização</th><th>Tipo</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.parents.map((o) => (
                        <tr key={`p-${o.public_id}`}>
                          <td>Grupo</td>
                          <td><Link to={`/admin/organizacoes/${o.public_id}`}>{o.legal_name}</Link></td>
                          <td>{rotulo(o.type)}</td><td><Badge valor={o.status} /></td>
                        </tr>
                      ))}
                      {dados.children.map((o) => (
                        <tr key={`f-${o.public_id}`}>
                          <td>Empresa</td>
                          <td><Link to={`/admin/organizacoes/${o.public_id}`}>{o.legal_name}</Link></td>
                          <td>{rotulo(o.type)}</td><td><Badge valor={o.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <SecaoIntegracaoPortal
              portal={dados.portal}
              onVincular={() => { void abrirVinculoDoPortal(); }}
            />

            <div className="secao">
              <h3>Referências externas</h3>
              {dados.externalReferences.length === 0 ? <div className="vazio">Sem referências externas.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Sistema</th><th>Entidade</th><th>Id legado</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.externalReferences.map((r) => (
                        <tr key={r.public_id}>
                          <td>{r.system_code}</td><td>{r.entity_type}</td><td>{r.legacy_id}</td>
                          <td><Badge valor={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Membros</h3>
              {dados.members.length === 0 ? <div className="vazio">Sem membros.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Pessoa</th><th>Perfil</th><th>Escopo</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.members.map((m) => (
                        <tr key={m.public_id}>
                          <td>{m.full_name}</td><td>{m.profile}</td><td>{m.scope}</td><td><Badge valor={m.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Aplicações dos membros ativos</h3>
              {dados.applications.length === 0 ? <div className="vazio">Nenhum acesso concedido.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Aplicação</th><th>Perfil</th><th>Pessoas</th></tr></thead>
                    <tbody>
                      {dados.applications.map((a) => (
                        <tr key={`${a.application_code}-${a.access_profile}`}>
                          <td>{a.application_code}</td><td>{a.access_profile}</td><td>{a.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {acao?.tipo === "editar" && (
              <FormularioEditarOrganizacao
                organizacao={dados}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(legalName, tradeName) =>
                  void executar(
                    () => api.renameOrganization(publicId, { legalName, tradeName, expectedVersion: dados.version }),
                    "Organização atualizada."
                  )
                }
              />
            )}

            {acao?.tipo === "associar" && (
              <FormularioAssociarGrupo
                grupos={grupos?.items ?? []}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(parentPublicId) =>
                  void executar(
                    () => api.associateParent(publicId, parentPublicId),
                    "Empresa associada ao grupo."
                  )
                }
              />
            )}

            {acao?.tipo === "novoUsuario" && (
              <FormularioNovoUsuario
                organizacao={dados}
                portal={dados.portal}
                aplicacoes={aplicacoes?.items ?? []}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(payload) => { void provisionarUsuario(payload); }}
              />
            )}

            {acao?.tipo === "vincularPortal" && (
              <FormularioVincularPortal
                organizacao={dados}
                correspondencia={correspondencia}
                correspondenciaCarregando={correspondenciaCarregando}
                correspondenciaIndisponivel={catalogoIndisponivel}
                onBuscar={(termo) => api.portalCatalog(new URLSearchParams({ q: termo }))}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(legacyId) => { void vincularAoPortal(legacyId); }}
              />
            )}

            {provisionado !== null && (
              <ResultadoDoProvisionamento
                resultado={provisionado}
                onFechar={() => {
                  // Recarrega SÓ agora: o painel some junto com o link do
                  // convite, e essa é a hora em que o ADMIN terminou de
                  // usá-lo. A lista de membros passa a incluir a pessoa.
                  setProvisionado(null);
                  recarregar();
                }}
              />
            )}
          </>
        )}
      </Estado>
    </>
  );
}
