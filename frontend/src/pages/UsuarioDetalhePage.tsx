import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type ConviteDaIdentidade } from "../api.js";
import { usarRecurso } from "../usarRecurso.js";
import { Badge, Confirmacao, Estado } from "../components/ui.js";
import { FormularioConcederAcesso, FormularioCriarMembership } from "../components/formularios.js";
import { rotulo, rotuloDeAplicacao } from "../apresentacao.js";

type AcaoPendente =
  | { tipo: "ativar" }
  | { tipo: "conceder" }
  | { tipo: "criarMembership" }
  | { tipo: "revogar"; publicId: string; aplicacao: string; version: number }
  | { tipo: "encerrar"; publicId: string; organizacao: string }
  | { tipo: "convidar" }
  | { tipo: "revogarConvite"; publicId: string }
  | { tipo: "encerrarSessoes"; quantidade: number }
  | { tipo: "bloquear"; version: number }
  | { tipo: "desbloquear"; version: number }
  | null;

/** Situação do convite para a tela — `EXPIRED` é derivado, não persistido. */
function situacaoDoConvite(convite: ConviteDaIdentidade): string {
  if (convite.status === "PENDING" && convite.expired) {
    return "EXPIRED";
  }
  return convite.status;
}

const dataHora = (valor: string | null): string =>
  valor === null ? "—" : new Date(valor).toLocaleString("pt-BR");

/** Título do diálogo por ação — o texto descreve a consequência, não o endpoint. */
const TITULOS: Readonly<Record<string, string>> = {
  ativar: "Ativar identidade federada",
  revogar: "Revogar acesso",
  encerrar: "Encerrar vínculo",
  convidar: "Criar convite de acesso",
  revogarConvite: "Revogar convite",
  encerrarSessoes: "Encerrar todas as sessões",
  bloquear: "Bloquear usuário",
  desbloquear: "Desbloquear usuário"
};

export function UsuarioDetalhePage(): JSX.Element {
  const { publicId = "" } = useParams();
  const { dados, carregando, erro, recarregar } = usarRecurso(() => api.identity(publicId), [publicId]);
  // Listas dos seletores: carregadas junto da tela para que o formulário
  // abra pronto, sem um segundo estado de "carregando" dentro do modal.
  const { dados: aplicacoes } = usarRecurso(() => api.applications(), []);
  const { dados: organizacoes } = usarRecurso(
    () => api.organizations(new URLSearchParams({ status: "ACTIVE", limit: "100" })),
    []
  );

  // Sessões e convites moram fora do detalhe da identidade: são listas
  // que mudam por conta própria, e recarregá-las sozinhas evita repintar
  // a tela inteira depois de cada ação.
  const { dados: sessoes, recarregar: recarregarSessoes } = usarRecurso(() => api.sessions(publicId), [publicId]);
  const { dados: convites, recarregar: recarregarConvites } = usarRecurso(() => api.invitations(publicId), [publicId]);

  const [acao, setAcaoPendente] = useState<AcaoPendente>(null);
  const [motivo, setMotivo] = useState("");
  /**
   * Link do convite recém-criado. Fica SÓ em memória e SÓ nesta
   * renderização: o servidor devolve o token uma única vez e nunca mais,
   * então recarregar a tela o perde de propósito.
   */
  const [linkDoConvite, setLinkDoConvite] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  /**
   * Executa uma mutação e reconcilia a tela.
   *
   * O `recarregar()` no sucesso não é cosmético: sem ele, a tela
   * continuaria mostrando o estado anterior — e a próxima revogação
   * enviaria uma `version` velha, que o backend recusaria com 409.
   */
  async function executar(acao: () => Promise<unknown>, sucesso: string): Promise<void> {
    setEnviando(true);
    setMensagem(null);
    try {
      await acao();
      setMensagem({ tipo: "ok", texto: sucesso });
      setAcaoPendente(null);
      recarregar();
    } catch (falha) {
      // 403, 409 e 422 já chegam como mensagem em português vinda de
      // `api.ts`; o formulário fica aberto para a pessoa corrigir.
      setMensagem({ tipo: "erro", texto: falha instanceof ApiError ? falha.message : "Falha ao executar a ação." });
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Elegibilidade do convite, do jeito que a tela consegue enxergar:
   * ACTIVE e ainda sem login. As demais condições (federada, sem
   * Credential, com algum acesso) são decididas pelo SERVIDOR — repetir
   * a regra aqui criaria uma segunda versão dela para divergir.
   */
  const podeConvidar = dados !== null && dados.status === "ACTIVE" && dados.login_enabled === 0;

  async function copiarLink(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
    } catch {
      // Sem permissão de área de transferência: o link segue visível na
      // tela para seleção manual, então não há o que fazer além de não
      // afirmar que copiou.
      setCopiado(false);
    }
  }

  async function confirmar(): Promise<void> {
    if (acao === null) return;
    setEnviando(true);
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
      } else if (acao.tipo === "encerrar") {
        await api.endMembership(acao.publicId, motivo.trim());
        setMensagem({ tipo: "ok", texto: "Vínculo encerrado." });
      } else if (acao.tipo === "convidar") {
        const resposta = await api.convidar([publicId]);
        const resultado = resposta.results[0];
        if (resultado === undefined || resultado.outcome === "SKIPPED") {
          // O servidor decide a elegibilidade; a tela repete o motivo em
          // vez de inventar um diagnóstico próprio.
          setMensagem({ tipo: "erro", texto: `Convite não emitido: ${resultado?.reasonCode ?? "motivo não informado"}.` });
        } else {
          // O link vem uma única vez, no modo manual. Guardar em estado
          // é deliberado: nada de localStorage, nada de log, e some ao
          // recarregar.
          setLinkDoConvite(resultado.manualLink);
          setCopiado(false);
          setMensagem({
            tipo: "ok",
            texto: resultado.delivered
              ? "Convite enviado por e-mail."
              : "Convite criado. Copie o link agora — ele não é exibido de novo."
          });
        }
        recarregarConvites();
      } else if (acao.tipo === "revogarConvite") {
        await api.revokeInvitation(acao.publicId);
        setLinkDoConvite(null);
        setMensagem({ tipo: "ok", texto: "Convite revogado." });
        recarregarConvites();
      } else if (acao.tipo === "encerrarSessoes") {
        const { revoked } = await api.revokeAllSessions(publicId);
        setMensagem({ tipo: "ok", texto: `${revoked} sessão(ões) encerrada(s).` });
        recarregarSessoes();
      } else if (acao.tipo === "desbloquear") {
        const resultado = await api.unblockIdentity(publicId, acao.version);
        setMensagem({
          tipo: "ok",
          texto: `Usuário desbloqueado (${resultado.status}). Login segue ${resultado.loginEnabled ? "habilitado" : "desabilitado"}.`
        });
      } else if (acao.tipo === "bloquear") {
        const resultado = await api.blockIdentity(publicId, acao.version);
        setMensagem({
          tipo: "ok",
          texto: `Usuário bloqueado. ${resultado.sessionsRevoked} sessão(ões) encerrada(s).`
        });
        recarregarSessoes();
      } else {
        // "conceder" e "criarMembership" têm formulário próprio e não
        // passam por este confirmador genérico.
        return;
      }
      setAcaoPendente(null);
      setMotivo("");
      recarregar();
    } catch (falha) {
      setMensagem({ tipo: "erro", texto: falha instanceof ApiError ? falha.message : "Falha ao executar a ação." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <p className="subtitulo"><Link to="/admin/usuarios">← Usuários</Link></p>
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
              <dt>Tipo</dt><dd>{rotulo(dados.type)}</dd>
              <dt>Login no Ingressa</dt><dd>{dados.login_enabled === 1 ? "habilitado" : "desabilitado"}</dd>
            </dl>

            <div className="secao barra">
              {dados.status === "PENDING" && dados.federated && (
                <button type="button" className="primario" onClick={() => setAcaoPendente({ tipo: "ativar" })}>
                  Ativar identidade federada
                </button>
              )}
              <button type="button" onClick={() => setAcaoPendente({ tipo: "conceder" })}>Conceder acesso</button>
              <button type="button" onClick={() => setAcaoPendente({ tipo: "criarMembership" })}>Criar vínculo</button>
              {/* Só ACTIVE transita para BLOCKED. Oferecer o botão nos
                  outros estados levaria a pessoa a um 422 do domínio. */}
              {dados.status === "ACTIVE" && (
                <button type="button" className="perigo"
                  onClick={() => setAcaoPendente({ tipo: "bloquear", version: dados.version })}>
                  Bloquear usuário
                </button>
              )}
              {/* Só BLOCKED transita de volta para ACTIVE por este
                  caminho — oferecer o botão nos demais estados levaria a
                  um conflito do domínio. */}
              {dados.status === "BLOCKED" && (
                <button type="button" className="primario"
                  onClick={() => setAcaoPendente({ tipo: "desbloquear", version: dados.version })}>
                  Desbloquear usuário
                </button>
              )}
            </div>

            <div className="secao">
              <h3>Login e convite</h3>
              {podeConvidar ? (
                <div className="barra">
                  <button type="button" className="primario" onClick={() => setAcaoPendente({ tipo: "convidar" })}>
                    Criar convite
                  </button>
                </div>
              ) : (
                <p className="subtitulo">
                  {dados.login_enabled === 1
                    ? "Esta pessoa já define login por senha própria — convite é só para primeiro acesso."
                    : "O convite só fica disponível para uma identidade ativa que ainda não tenha login habilitado."}
                </p>
              )}

              {linkDoConvite !== null && (
                <div className="aviso aviso-alerta" role="alert">
                  <p style={{ marginTop: 0 }}>
                    <strong>Copie agora.</strong> Este link não é exibido de novo — nem aqui, nem em log.
                  </p>
                  <code className="link-convite">{linkDoConvite}</code>
                  <div className="barra" style={{ marginTop: 10 }}>
                    <button type="button" onClick={() => void copiarLink(linkDoConvite)}>
                      {copiado ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                </div>
              )}

              {convites === null || convites.items.length === 0 ? (
                <div className="vazio">Nenhum convite emitido.</div>
              ) : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Situação</th><th>Entrega</th><th>Criado</th><th>Validade</th><th /></tr></thead>
                    <tbody>
                      {convites.items.map((convite) => {
                        const situacao = situacaoDoConvite(convite);
                        return (
                          <tr key={convite.public_id}>
                            <td><Badge valor={situacao} /></td>
                            <td>{convite.delivery_mode}</td>
                            <td>{dataHora(convite.created_at)}</td>
                            <td>{dataHora(convite.expires_at)}</td>
                            <td>
                              {/* Só o pendente e ainda válido pode ser
                                  revogado — revogar um vencido não muda
                                  nada e o servidor responderia conflito. */}
                              {situacao === "PENDING" && (
                                <button type="button" className="perigo"
                                  onClick={() => setAcaoPendente({ tipo: "revogarConvite", publicId: convite.public_id })}>
                                  Revogar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Sessões ativas</h3>
              {sessoes === null || sessoes.items.length === 0 ? (
                <div className="vazio">Nenhuma sessão ativa.</div>
              ) : (
                <>
                  <div className="barra">
                    <button type="button" className="perigo"
                      onClick={() => setAcaoPendente({ tipo: "encerrarSessoes", quantidade: sessoes.items.length })}>
                      Encerrar todas as sessões
                    </button>
                  </div>
                  <div className="tabela-rolavel">
                    <table>
                      <thead><tr><th>Criada</th><th>Última atividade</th><th>Expira</th></tr></thead>
                      <tbody>
                        {sessoes.items.map((sessao) => (
                          <tr key={sessao.public_id}>
                            <td>{dataHora(sessao.created_at)}</td>
                            <td>{dataHora(sessao.last_seen_at)}</td>
                            <td>{dataHora(sessao.expires_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="secao">
              <h3>Referências externas</h3>
              {dados.externalReferences.length === 0 ? <div className="vazio">Sem referências externas.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Sistema</th><th>Entidade</th><th>Id legado</th><th>Vínculo</th><th>Status</th></tr></thead>
                    <tbody>
                      {dados.externalReferences.map((r) => (
                        <tr key={r.public_id}>
                          <td>{rotuloDeAplicacao(r.system_code)}</td><td>{r.entity_type}</td><td>{r.legacy_id}</td>
                          <td>{r.match_method ?? "—"}</td><td><Badge valor={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="secao">
              <h3>Vínculos</h3>
              {dados.memberships.length === 0 ? <div className="vazio">Sem vínculos.</div> : (
                <div className="tabela-rolavel">
                  <table>
                    <thead><tr><th>Organização</th><th>Perfil</th><th>Escopo</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {dados.memberships.map((m) => (
                        <tr key={m.public_id}>
                          <td><Link to={`/admin/organizacoes/${m.organization_public_id}`}>{m.trade_name ?? m.legal_name}</Link></td>
                          <td>{rotulo(m.profile)}</td><td>{rotulo(m.scope)}</td><td><Badge valor={m.status} /></td>
                          <td>
                            {m.status === "ACTIVE" && (
                              <button type="button" className="perigo"
                                onClick={() => setAcaoPendente({ tipo: "encerrar", publicId: m.public_id, organizacao: m.trade_name ?? m.legal_name })}>
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
                          <td>{rotuloDeAplicacao(a.application_code)}</td><td>{rotulo(a.access_profile)}</td><td><Badge valor={a.status} /></td>
                          <td>
                            {a.status === "GRANTED" && (
                              <button type="button" className="perigo"
                                onClick={() => setAcaoPendente({ tipo: "revogar", publicId: a.public_id, aplicacao: a.application_code, version: a.version })}>
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

            {acao?.tipo === "conceder" && (
              <FormularioConcederAcesso
                aplicacoes={aplicacoes?.items ?? []}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(applicationCode, accessProfile) =>
                  void executar(() => api.grantAccess(publicId, applicationCode, accessProfile), "Acesso concedido.")
                }
              />
            )}

            {acao?.tipo === "criarMembership" && (
              <FormularioCriarMembership
                organizacoes={organizacoes?.items ?? []}
                enviando={enviando}
                onCancelar={() => setAcaoPendente(null)}
                onConfirmar={(organizationPublicId, profile, scope) =>
                  void executar(
                    () => api.createMembership({ identityPublicId: publicId, organizationPublicId, profile, scope }),
                    "Vínculo criado."
                  )
                }
              />
            )}

            {acao !== null && acao.tipo !== "conceder" && acao.tipo !== "criarMembership" && (
              <Confirmacao
                titulo={TITULOS[acao.tipo] ?? "Confirmar ação"}
                descricao={
                  acao.tipo === "ativar"
                    ? "A identidade passa a ficar ativa e recebe contexto no sistema externo. Nenhuma senha é criada."
                    : acao.tipo === "revogar"
                      ? `O acesso a ${acao.aplicacao} cessa imediatamente. O histórico é preservado.`
                      : acao.tipo === "encerrar"
                        ? `A pessoa deixa de pertencer a ${acao.organizacao}. O histórico é preservado.`
                        : acao.tipo === "convidar"
                          ? "Um link de uso único é gerado para a pessoa definir a própria senha. Nenhuma senha é criada ou enviada, e convites anteriores ainda pendentes são revogados."
                          : acao.tipo === "revogarConvite"
                            ? "O link deixa de valer imediatamente. Você pode emitir um novo convite depois."
                            : acao.tipo === "encerrarSessoes"
                              ? `${acao.quantidade} sessão(ões) será(ão) encerrada(s). A pessoa precisará entrar de novo; o acesso dela não muda.`
                              : acao.tipo === "bloquear"
                                ? "A pessoa deixa de autenticar e todas as sessões ativas são encerradas na mesma operação. Vínculos, acessos e referências são preservados."
                                : "A identidade volta a ficar ativa. As sessões já encerradas NÃO voltam, e nenhum convite, vínculo ou acesso é recriado. O login permanece como está."
                }
                confirmando={enviando}
                onConfirmar={confirmar}
                onCancelar={() => { setAcaoPendente(null); setMotivo(""); }}
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
