import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  ApiError,
  type EmpresaDeOrigem,
  type ItemProposto,
  type Organizacao,
  type PreviaDaImportacao,
  type ResultadoDaImportacao,
  type SelecaoDeImportacao,
  type SnapshotRedigido,
  type UsuarioDeOrigem,
  type UsuariosDeOrigem
} from "../api.js";
import { Badge, Confirmacao, Estado, Paginacao } from "../components/ui.js";
import { rotulo } from "../apresentacao.js";

/**
 * Assistente de importação Helpdesk → Ingressa.
 *
 * A regra que organiza esta tela inteira: **ela não decide nada.**
 *
 * O que sai daqui é SELEÇÃO — a empresa de origem, os usuários
 * marcados, e (opcionalmente) a organização de destino e o grupo
 * empresarial que o ADMIN afirma. Ação, escopo de membership, perfil de
 * acesso e destino de cada escrita são calculados no backend, do zero,
 * a cada chamada. O que esta tela exibe é o resultado desse cálculo,
 * nunca a entrada dele.
 *
 * A consequência prática aparece no APPLY: a palavra `APLICAR` digitada
 * aqui é enviada e comparada NO SERVIDOR. Remover o `disabled` do botão
 * pelo inspetor do navegador não aproxima ninguém de aplicar coisa
 * alguma.
 */
type Etapa = "ORIGEM" | "SELECAO" | "MAPEAMENTO" | "REVISAO" | "RESULTADO";

const ETAPAS: readonly { readonly id: Etapa; readonly rotulo: string }[] = [
  { id: "ORIGEM", rotulo: "1. Origem" },
  { id: "SELECAO", rotulo: "2. Usuários" },
  { id: "MAPEAMENTO", rotulo: "3. Mapeamento" },
  { id: "REVISAO", rotulo: "4. Revisão do dry-run" },
  { id: "RESULTADO", rotulo: "5. Resultado" }
];

/** Textos dos motivos — código estável vira frase legível numa só tabela. */
const MOTIVOS: Readonly<Record<string, string>> = {
  CREATED_FROM_SOURCE: "Será criado a partir da origem.",
  ORGANIZATION_ALREADY_LINKED: "Empresa já vinculada a uma organização do Ingressa.",
  ORGANIZATION_ASSERTION_CONFLICT: "A organização informada contradiz o vínculo já existente.",
  ORGANIZATION_NOT_ELIGIBLE: "A organização de destino não é uma empresa ativa.",
  ORGANIZATION_NOT_RESOLVED: "A organização de destino não pôde ser resolvida — o lote inteiro fica em espera.",
  ORGANIZATION_RELATIONSHIP_ALREADY_ACTIVE: "A empresa já pertence a este grupo.",
  ORGANIZATION_RELATIONSHIP_PARENT_DIVERGED: "A empresa já pertence a outro grupo empresarial.",
  BUSINESS_GROUP_NOT_ELIGIBLE: "O grupo informado não é um grupo empresarial ativo.",
  BUSINESS_GROUP_NOT_ASSERTED: "Vínculo de grupo sem grupo de destino informado.",
  EXTERNAL_REFERENCE_ALREADY_ACTIVE: "Usuário já importado — nada será duplicado.",
  MEMBERSHIP_ALREADY_ACTIVE: "Vínculo com a empresa já existe.",
  MEMBERSHIP_SCOPE_DIVERGED: "O vínculo existente tem escopo diferente do que esta origem concede.",
  APPLICATION_ACCESS_ALREADY_GRANTED: "Acesso ao Helpdesk já concedido.",
  IDENTITY_UPDATE_UNSUPPORTED: "O cadastro mudou na origem e a atualização exige decisão humana.",
  EMAIL_MATCHES_EXISTING_IDENTITY: "O e-mail já pertence a outra identidade — associar exige confirmação humana.",
  SOURCE_USER_INACTIVE: "Usuário inativo na origem.",
  SOURCE_USER_NOT_EXTERNAL_ROLE: "Usuário interno — não recebe vínculo com cliente.",
  SOURCE_USER_WITHOUT_CLIENT_LINK: "Usuário sem vínculo cadastral com empresa.",
  SOURCE_USER_CLIENT_OUT_OF_SELECTION: "O vínculo do usuário aponta para outra empresa.",
  SOURCE_EMAIL_INVALID: "E-mail ausente ou inválido na origem.",
  SOURCE_EMAIL_DUPLICATED_IN_SELECTION: "E-mail repetido dentro da seleção.",
  SOURCE_CLIENT_INACTIVE: "Empresa inativa na origem."
};

const RESOLUCOES: Readonly<Record<string, string>> = {
  EXTERNAL_REFERENCE: "Reutiliza a organização já vinculada a esta empresa.",
  OPERATOR_ASSERTED: "Reutiliza a organização informada e cria o vínculo que faltava.",
  ABSENT: "Cria uma organização nova para esta empresa."
};

function motivo(codigo: string): string {
  return MOTIVOS[codigo] ?? codigo;
}

export function NovaImportacaoPage(): JSX.Element {
  const navegar = useNavigate();
  const [etapa, setEtapa] = useState<Etapa>("ORIGEM");
  const [empresa, setEmpresa] = useState<EmpresaDeOrigem | null>(null);
  const [selecionados, setSelecionados] = useState<readonly number[]>([]);
  const [organizacaoAfirmada, setOrganizacaoAfirmada] = useState("");
  const [grupoAfirmado, setGrupoAfirmado] = useState("");
  const [previa, setPrevia] = useState<PreviaDaImportacao | null>(null);
  const [dryRun, setDryRun] = useState<ResultadoDaImportacao | null>(null);
  const [resultado, setResultado] = useState<ResultadoDaImportacao | null>(null);
  const [aprovado, setAprovado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const selecao: SelecaoDeImportacao | null = useMemo(
    () =>
      empresa === null
        ? null
        : {
            sourceClientId: empresa.sourceClientId,
            selectedSourceUserIds: selecionados,
            targetOrganizationPublicId: organizacaoAfirmada === "" ? undefined : organizacaoAfirmada,
            parentBusinessGroupPublicId: grupoAfirmado === "" ? undefined : grupoAfirmado
          },
    [empresa, selecionados, organizacaoAfirmada, grupoAfirmado]
  );

  /**
   * Qualquer mudança na seleção invalida o que já foi calculado.
   *
   * Sem isto, o operador poderia desmarcar um usuário depois do dry-run
   * e continuar vendo o resumo antigo na tela — e o backend recusaria o
   * apply por fingerprint divergente, sem que a tela explicasse por
   * quê. Melhor apagar o que deixou de valer.
   */
  useEffect(() => {
    setPrevia(null);
    setDryRun(null);
    setAprovado(false);
  }, [selecionados, organizacaoAfirmada, grupoAfirmado, empresa]);

  async function executar<T>(acao: () => Promise<T>, aoConcluir: (valor: T) => void): Promise<void> {
    setOcupado(true);
    setErro(null);
    try {
      aoConcluir(await acao());
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Falha inesperada. Nada foi alterado.");
    } finally {
      setOcupado(false);
    }
  }

  function cancelar(): void {
    navegar("/admin/importacoes");
  }

  return (
    <>
      <p className="subtitulo"><Link to="/admin/importacoes">← Importações</Link></p>
      <h2>Nova importação do Helpdesk</h2>
      <p className="subtitulo">
        A tela envia apenas a <strong>seleção</strong>. O plano é recalculado no servidor a cada passo —
        nada aqui autoriza acesso a nada.
      </p>

      <PassoAPasso atual={etapa} />

      {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}

      {etapa === "ORIGEM" && (
        <EtapaOrigem
          selecionada={empresa}
          onSelecionar={(escolhida) => {
            setEmpresa(escolhida);
            setSelecionados([]);
            setOrganizacaoAfirmada(escolhida.linkedOrganization?.organizationPublicId ?? "");
            setEtapa("SELECAO");
          }}
          onCancelar={cancelar}
        />
      )}

      {etapa === "SELECAO" && empresa !== null && (
        <EtapaSelecao
          empresa={empresa}
          selecionados={selecionados}
          onMudarSelecao={setSelecionados}
          onVoltar={() => setEtapa("ORIGEM")}
          onAvancar={() => setEtapa("MAPEAMENTO")}
          onCancelar={cancelar}
        />
      )}

      {etapa === "MAPEAMENTO" && empresa !== null && selecao !== null && (
        <EtapaMapeamento
          empresa={empresa}
          selecao={selecao}
          previa={previa}
          ocupado={ocupado}
          organizacaoAfirmada={organizacaoAfirmada}
          grupoAfirmado={grupoAfirmado}
          onMudarOrganizacao={setOrganizacaoAfirmada}
          onMudarGrupo={setGrupoAfirmado}
          onPrevisualizar={() => executar(() => api.helpdeskPreview(selecao), setPrevia)}
          onDryRun={() =>
            executar(
              () => api.helpdeskDryRun(selecao),
              (lote) => {
                setDryRun(lote);
                setEtapa("REVISAO");
              }
            )
          }
          onVoltar={() => setEtapa("SELECAO")}
          onCancelar={cancelar}
        />
      )}

      {etapa === "REVISAO" && dryRun !== null && previa !== null && (
        <EtapaRevisao
          lote={dryRun}
          previa={previa}
          aprovado={aprovado}
          ocupado={ocupado}
          onAprovar={setAprovado}
          onAplicar={() => setConfirmando(true)}
          onVoltar={() => setEtapa("MAPEAMENTO")}
          onCancelar={cancelar}
        />
      )}

      {etapa === "RESULTADO" && resultado !== null && (
        <EtapaResultado resultado={resultado} onConcluir={cancelar} />
      )}

      {confirmando && selecao !== null && dryRun !== null && previa !== null && (
        <ConfirmacaoDeApply
          palavra={previa.applyConfirmationWord}
          ocupado={ocupado}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={(digitado) =>
            executar(
              () => api.helpdeskApply(selecao, dryRun.batchPublicId, digitado),
              (aplicado) => {
                setResultado(aplicado);
                setConfirmando(false);
                setEtapa("RESULTADO");
              }
            )
          }
        />
      )}
    </>
  );
}

function PassoAPasso({ atual }: { atual: Etapa }): JSX.Element {
  const indiceAtual = ETAPAS.findIndex((e) => e.id === atual);
  return (
    <ol className="barra" aria-label="Etapas do assistente" style={{ listStyle: "none", padding: 0 }}>
      {ETAPAS.map((passo, indice) => (
        <li key={passo.id}>
          <span
            className={`badge ${indice === indiceAtual ? "badge-ok" : indice < indiceAtual ? "badge-neutro" : "badge-alerta"}`}
            aria-current={indice === indiceAtual ? "step" : undefined}
          >
            {passo.rotulo}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------
// Etapa 1 — origem
// ---------------------------------------------------------------------

function EtapaOrigem({
  selecionada,
  onSelecionar,
  onCancelar
}: {
  selecionada: EmpresaDeOrigem | null;
  onSelecionar: (empresa: EmpresaDeOrigem) => void;
  onCancelar: () => void;
}): JSX.Element {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [offset, setOffset] = useState(0);
  const [dados, setDados] = useState<{ items: readonly EmpresaDeOrigem[]; total: number; limit: number; offset: number } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ offset: String(offset) });
      if (termo !== "") {
        params.set("q", termo);
      }
      setDados(await api.helpdeskCompanies(params));
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Falha ao ler o catálogo do Helpdesk.");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [termo, offset]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <section>
      <h3>Selecione a empresa de origem</h3>
      <p className="subtitulo">
        O catálogo do Helpdesk expõe apenas vínculo cadastral: empresa e usuário externo. Grupo
        empresarial não é cadastro do Helpdesk — ele é informado na etapa de mapeamento, entre as
        organizações que já existem no Ingressa.
      </p>

      <form
        className="barra"
        onSubmit={(evento) => {
          evento.preventDefault();
          setOffset(0);
          setTermo(busca.trim());
        }}
      >
        <input
          aria-label="Buscar empresa"
          placeholder="Buscar empresa pelo nome"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <button type="submit">Buscar</button>
        <button type="button" onClick={onCancelar}>Cancelar</button>
      </form>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr><th>Empresa (origem)</th><th>id</th><th>Situação</th><th>No Ingressa</th><th /></tr>
                </thead>
                <tbody>
                  {dados.items.map((item) => (
                    <tr key={item.sourceClientId}>
                      <td>{item.name}</td>
                      <td><code>{item.sourceClientId}</code></td>
                      <td><Badge valor={item.active ? "ACTIVE" : "INACTIVE"} /></td>
                      <td>
                        {item.linkedOrganization === null
                          ? <span className="subtitulo" style={{ margin: 0 }}>Ainda não importada</span>
                          : <>{item.linkedOrganization.legalName} <Badge valor={item.linkedOrganization.status} /></>}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="primario"
                          disabled={!item.active}
                          onClick={() => onSelecionar(item)}
                        >
                          {selecionada?.sourceClientId === item.sourceClientId ? "Selecionada" : "Selecionar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao total={dados.total} limit={dados.limit} offset={dados.offset} onMudar={setOffset} />
          </>
        )}
      </Estado>
    </section>
  );
}

// ---------------------------------------------------------------------
// Etapa 2 — usuários encontrados e seleção
// ---------------------------------------------------------------------

function EtapaSelecao({
  empresa,
  selecionados,
  onMudarSelecao,
  onVoltar,
  onAvancar,
  onCancelar
}: {
  empresa: EmpresaDeOrigem;
  selecionados: readonly number[];
  onMudarSelecao: (ids: readonly number[]) => void;
  onVoltar: () => void;
  onAvancar: () => void;
  onCancelar: () => void;
}): JSX.Element {
  const [dados, setDados] = useState<UsuariosDeOrigem | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * A sugestão inicial roda UMA vez por empresa.
   *
   * Sem esta trava, um recarregamento da lista (por foco, por retorno
   * da etapa seguinte) remarcaria todo mundo e desfaria em silêncio o
   * que o operador tinha desmarcado — a pior classe de bug numa tela
   * que concede acesso: a que reverte uma decisão sem avisar.
   */
  const [, setJaSugeriu] = useState(false);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    api
      .helpdeskCompanyUsers(empresa.sourceClientId)
      .then((resposta) => {
        if (!ativo) {
          return;
        }
        setDados(resposta);
        setJaSugeriu((sugeriuAntes) => {
          if (!sugeriuAntes) {
            onMudarSelecao(resposta.items.filter((u) => u.suggestedSelected).map((u) => u.sourceUserId));
          }
          return true;
        });
      })
      .catch((falha: unknown) => {
        if (ativo) {
          setErro(falha instanceof ApiError ? falha.message : "Falha ao ler os usuários da empresa.");
          setDados(null);
        }
      })
      .finally(() => {
        if (ativo) {
          setCarregando(false);
        }
      });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.sourceClientId]);

  function alternar(usuario: UsuarioDeOrigem): void {
    onMudarSelecao(
      selecionados.includes(usuario.sourceUserId)
        ? selecionados.filter((id) => id !== usuario.sourceUserId)
        : [...selecionados, usuario.sourceUserId]
    );
  }

  return (
    <section>
      <h3>Organização e usuários encontrados</h3>
      <dl className="chave-valor" style={{ marginBottom: 16 }}>
        <dt>Empresa de origem</dt>
        <dd>{empresa.name} (<code>clients:{empresa.sourceClientId}</code>)</dd>
        <dt>Organização no Ingressa</dt>
        <dd>{empresa.linkedOrganization?.legalName ?? "Nenhuma — será criada"}</dd>
      </dl>

      <Estado carregando={carregando} erro={erro} vazio={dados !== null && dados.items.length === 0}>
        {dados !== null && (
          <>
            <p className="subtitulo">
              {dados.total} usuário(s) na empresa · {dados.eligibleTotal} elegível(is) ·{" "}
              {dados.alreadyImportedTotal} já importado(s). Usuários internos e inativos aparecem
              marcados: escondê-los faria a tela mentir por omissão.
            </p>
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr><th>Importar</th><th>Usuário</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>No Ingressa</th></tr>
                </thead>
                <tbody>
                  {dados.items.map((usuario) => (
                    <tr key={usuario.sourceUserId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Importar ${usuario.name}`}
                          checked={selecionados.includes(usuario.sourceUserId)}
                          disabled={!usuario.eligible}
                          onChange={() => alternar(usuario)}
                        />
                      </td>
                      <td>{usuario.name} <code>#{usuario.sourceUserId}</code></td>
                      <td>{usuario.email === "" ? <span className="redigido">(sem e-mail)</span> : usuario.email}</td>
                      <td>{usuario.role}</td>
                      <td>
                        {usuario.eligible
                          ? <Badge valor="ACTIVE" />
                          : usuario.ineligibilityReasons.map((codigo) => (
                              <div key={codigo} className="subtitulo" style={{ margin: 0 }}>{motivo(codigo)}</div>
                            ))}
                      </td>
                      <td>
                        {usuario.linkedIdentity === null
                          ? "—"
                          : <>já importado <Badge valor={usuario.linkedIdentity.status} /></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Estado>

      <div className="barra" style={{ marginTop: 16 }}>
        <button type="button" onClick={onVoltar}>Voltar</button>
        <button type="button" className="primario" disabled={selecionados.length === 0} onClick={onAvancar}>
          Continuar com {selecionados.length} usuário(s)
        </button>
        <button type="button" onClick={onCancelar}>Cancelar</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Etapa 3 — mapeamento empresarial proposto
// ---------------------------------------------------------------------

function EtapaMapeamento({
  empresa,
  selecao,
  previa,
  ocupado,
  organizacaoAfirmada,
  grupoAfirmado,
  onMudarOrganizacao,
  onMudarGrupo,
  onPrevisualizar,
  onDryRun,
  onVoltar,
  onCancelar
}: {
  empresa: EmpresaDeOrigem;
  selecao: SelecaoDeImportacao;
  previa: PreviaDaImportacao | null;
  ocupado: boolean;
  organizacaoAfirmada: string;
  grupoAfirmado: string;
  onMudarOrganizacao: (valor: string) => void;
  onMudarGrupo: (valor: string) => void;
  onPrevisualizar: () => void;
  onDryRun: () => void;
  onVoltar: () => void;
  onCancelar: () => void;
}): JSX.Element {
  const [grupos, setGrupos] = useState<readonly Organizacao[]>([]);
  const [empresasIngressa, setEmpresasIngressa] = useState<readonly Organizacao[]>([]);

  useEffect(() => {
    // Grupos e empresas do INGRESSA — o destino que o ADMIN pode
    // afirmar. Nunca vem da origem: o vínculo grupo→empresa do Helpdesk
    // não é legível pelo principal read-only atual.
    void api
      .organizations(new URLSearchParams({ type: "BUSINESS_GROUP", status: "ACTIVE", limit: "100" }))
      .then((pagina) => setGrupos(pagina.items))
      .catch(() => setGrupos([]));
    void api
      .organizations(new URLSearchParams({ type: "COMPANY", status: "ACTIVE", limit: "100" }))
      .then((pagina) => setEmpresasIngressa(pagina.items))
      .catch(() => setEmpresasIngressa([]));
  }, []);

  const bloqueado = previa?.organization.blockingReasonCode ?? null;

  return (
    <section>
      <h3>Mapeamento empresarial proposto</h3>
      <p className="subtitulo">
        {empresa.name} → organização do Ingressa. O destino é resolvido pelo vínculo já registrado;
        na ausência dele, você pode afirmar a organização. <strong>Nunca há correspondência por nome.</strong>
      </p>

      <div className="barra">
        <label>
          <span className="subtitulo" style={{ display: "block", margin: 0 }}>Organização de destino (opcional)</span>
          <select
            aria-label="Organização de destino"
            value={organizacaoAfirmada}
            onChange={(e) => onMudarOrganizacao(e.target.value)}
            disabled={empresa.linkedOrganization !== null}
          >
            <option value="">Criar organização nova a partir da origem</option>
            {empresasIngressa.map((org) => (
              <option key={org.public_id} value={org.public_id}>{org.legal_name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="subtitulo" style={{ display: "block", margin: 0 }}>Grupo empresarial (opcional)</span>
          <select aria-label="Grupo empresarial" value={grupoAfirmado} onChange={(e) => onMudarGrupo(e.target.value)}>
            <option value="">Sem grupo</option>
            {grupos.map((grupo) => (
              <option key={grupo.public_id} value={grupo.public_id}>{grupo.legal_name}</option>
            ))}
          </select>
        </label>
      </div>

      {empresa.linkedOrganization !== null && (
        <p className="subtitulo">
          Esta empresa já tem vínculo ativo com <strong>{empresa.linkedOrganization.legalName}</strong>.
          Trocar a organização de destino de um cliente já importado é decisão de quem concedeu —
          não do importador.
        </p>
      )}

      <div className="barra">
        <button type="button" onClick={onPrevisualizar} disabled={ocupado}>
          {ocupado ? "Calculando…" : "Ver mapeamento proposto"}
        </button>
      </div>

      {previa !== null && (
        <>
          <div className="secao">
            <h3>Organização</h3>
            <p className="subtitulo">{RESOLUCOES[previa.organization.resolution] ?? previa.organization.resolution}</p>
            {bloqueado !== null && (
              <div className="aviso aviso-erro" role="alert">{motivo(bloqueado)}</div>
            )}
            <TabelaDeItens itens={previa.organization.actions} />
            {previa.businessGroup !== null && (
              <p className="subtitulo">
                Grupo: {previa.businessGroup.legalName ?? previa.businessGroup.publicId}
                {previa.businessGroup.eligible ? "" : ` — ${previa.businessGroup.ineligibleReason ?? "inelegível"}`}
              </p>
            )}
          </div>

          <div className="secao">
            <h3>Usuários ({previa.users.length})</h3>
            <ResumoPorAcao contagens={previa.countsByAction} />
            {previa.users.map((usuario) => (
              <details key={usuario.sourceLegacyId} style={{ marginBottom: 10 }}>
                <summary>
                  {usuario.name} <code>#{usuario.sourceLegacyId}</code>{" "}
                  {usuario.items.map((item) => (
                    <Badge key={item.entityKind} valor={item.action} />
                  ))}
                </summary>
                <TabelaDeItens itens={usuario.items} />
              </details>
            ))}
          </div>
        </>
      )}

      <div className="barra" style={{ marginTop: 16 }}>
        <button type="button" onClick={onVoltar}>Voltar</button>
        <button
          type="button"
          className="primario"
          disabled={ocupado || previa === null || selecao.selectedSourceUserIds.length === 0}
          onClick={onDryRun}
        >
          {ocupado ? "Executando…" : "Executar DRY_RUN"}
        </button>
        <button type="button" onClick={onCancelar}>Cancelar</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Etapa 4 — revisão do dry-run e aprovação
// ---------------------------------------------------------------------

function EtapaRevisao({
  lote,
  previa,
  aprovado,
  ocupado,
  onAprovar,
  onAplicar,
  onVoltar,
  onCancelar
}: {
  lote: ResultadoDaImportacao;
  previa: PreviaDaImportacao;
  aprovado: boolean;
  ocupado: boolean;
  onAprovar: (valor: boolean) => void;
  onAplicar: () => void;
  onVoltar: () => void;
  onCancelar: () => void;
}): JSX.Element {
  const bloqueado = lote.blockingReasonCode !== null;
  const nadaAEscrever = (lote.countsByAction["CREATE"] ?? 0) === 0;

  return (
    <section>
      <h3>Resumo do dry-run</h3>
      <p className="subtitulo">
        Lote <code>{lote.batchPublicId}</code> · regras <code>{lote.mappingRulesVersion}</code> ·{" "}
        <Badge valor={lote.status} />. Nenhuma entidade foi criada: o dry-run só registra o que
        faria.
      </p>

      <ResumoPorAcao contagens={lote.countsByAction} />

      {bloqueado && (
        <div className="aviso aviso-erro" role="alert">{motivo(lote.blockingReasonCode ?? "")}</div>
      )}

      <div className="secao">
        <h3>Organização</h3>
        <dl className="chave-valor">
          <dt>Empresa de origem</dt>
          <dd>{lote.sourceClientName} (<code>clients:{lote.sourceClientId}</code>)</dd>
          <dt>Destino</dt>
          <dd>{lote.organizationLegalName ?? "—"}</dd>
          <dt>Resolução</dt>
          <dd>{RESOLUCOES[lote.organizationResolution] ?? lote.organizationResolution}</dd>
        </dl>
        <TabelaDeItens itens={previa.organization.actions} />
      </div>

      <div className="secao">
        <h3>Decisões por usuário</h3>
        <p className="subtitulo">
          Abra um usuário para ver o snapshot que iria para a trilha — campos sensíveis aparecem
          como <span className="redigido">[REDIGIDO]</span>, com o nome preservado para auditoria.
        </p>
        {lote.users.map((usuario) => {
          const detalhe = previa.users.find((u) => u.sourceLegacyId === usuario.sourceLegacyId);
          return (
            <details key={usuario.sourceLegacyId} style={{ marginBottom: 10 }}>
              <summary>
                {usuario.sourceName} <code>#{usuario.sourceLegacyId}</code>{" "}
                {Object.entries(usuario.actionsByEntityKind).map(([entidade, acao]) => (
                  <Badge key={entidade} valor={acao} />
                ))}
              </summary>
              <ul className="subtitulo">
                {usuario.reasonCodes.map((codigo) => (
                  <li key={codigo}>{motivo(codigo)}</li>
                ))}
              </ul>
              {detalhe !== undefined && <TabelaDeItens itens={detalhe.items} />}
            </details>
          );
        })}
      </div>

      <div className="secao">
        <h3>Aprovação</h3>
        <label>
          <input
            type="checkbox"
            checked={aprovado}
            disabled={bloqueado || nadaAEscrever}
            onChange={(e) => onAprovar(e.target.checked)}
          />{" "}
          Revisei as decisões acima e aprovo este lote.
        </label>
        {nadaAEscrever && !bloqueado && (
          <p className="subtitulo">
            Nada a escrever: todos os itens já existem no destino. Aplicar não mudaria nada.
          </p>
        )}
      </div>

      <div className="barra" style={{ marginTop: 16 }}>
        <button type="button" onClick={onVoltar}>Voltar</button>
        <button
          type="button"
          className="primario"
          disabled={!aprovado || bloqueado || nadaAEscrever || ocupado}
          onClick={onAplicar}
        >
          Executar APPLY
        </button>
        <button type="button" onClick={onCancelar}>Cancelar</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Confirmação forte
// ---------------------------------------------------------------------

function ConfirmacaoDeApply({
  palavra,
  ocupado,
  onConfirmar,
  onCancelar
}: {
  palavra: string;
  ocupado: boolean;
  onConfirmar: (digitado: string) => void;
  onCancelar: () => void;
}): JSX.Element {
  const [digitado, setDigitado] = useState("");

  return (
    <Confirmacao
      titulo="Aplicar a importação"
      descricao={
        `Serão criadas identidades, vínculos e acessos ao Helpdesk para os usuários aprovados. ` +
        `Digite ${palavra} para confirmar.`
      }
      confirmando={ocupado}
      onConfirmar={() => onConfirmar(digitado)}
      onCancelar={onCancelar}
    >
      <label>
        <span className="subtitulo" style={{ display: "block", margin: 0 }}>Confirmação</span>
        <input
          aria-label="Confirmação"
          value={digitado}
          onChange={(e) => setDigitado(e.target.value)}
          placeholder={palavra}
        />
      </label>
      <p className="subtitulo" style={{ marginTop: 8 }}>
        A palavra é verificada no servidor. Alterar esta tela não aproxima ninguém de aplicar nada.
      </p>
    </Confirmacao>
  );
}

// ---------------------------------------------------------------------
// Etapa 5 — resultado
// ---------------------------------------------------------------------

function EtapaResultado({
  resultado,
  onConcluir
}: {
  resultado: ResultadoDaImportacao;
  onConcluir: () => void;
}): JSX.Element {
  return (
    <section>
      <div className="aviso aviso-ok" role="status">
        Importação aplicada. Lote <code>{resultado.batchPublicId}</code> — <Badge valor={resultado.status} />.
      </div>

      <dl className="chave-valor">
        <dt>Empresa de origem</dt>
        <dd>{resultado.sourceClientName} (<code>clients:{resultado.sourceClientId}</code>)</dd>
        <dt>Organização</dt>
        <dd>
          {resultado.organizationLegalName ?? "—"}{" "}
          {resultado.organizationPublicId !== null && <code>{resultado.organizationPublicId}</code>}
        </dd>
        <dt>Itens registrados</dt>
        <dd>{resultado.recordedItems}</dd>
        {resultado.resumedUsers.length > 0 && (
          <>
            <dt>Retomados</dt>
            <dd>{resultado.resumedUsers.join(", ")}</dd>
          </>
        )}
      </dl>

      <div className="secao">
        <h3>Identificadores públicos criados</h3>
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr><th>Usuário</th><th>Identity</th><th>Status</th><th>Membership</th><th>Acesso</th></tr>
            </thead>
            <tbody>
              {resultado.users.map((usuario) => (
                <tr key={usuario.sourceLegacyId}>
                  <td>{usuario.sourceName} <code>#{usuario.sourceLegacyId}</code></td>
                  <td>{usuario.writtenTargets["IDENTITY"] === undefined ? "—" : <code>{usuario.writtenTargets["IDENTITY"]}</code>}</td>
                  <td>
                    {usuario.identityStatus === null || usuario.identityStatus === undefined
                      ? "—"
                      : <Badge valor={usuario.identityStatus} />}
                    {usuario.activatedNow && <span className="subtitulo"> ativada agora</span>}
                  </td>
                  <td>{usuario.writtenTargets["MEMBERSHIP"] === undefined ? "—" : <code>{usuario.writtenTargets["MEMBERSHIP"]}</code>}</td>
                  <td>{usuario.writtenTargets["APPLICATION_ACCESS"] === undefined ? "—" : <code>{usuario.writtenTargets["APPLICATION_ACCESS"]}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="barra" style={{ marginTop: 16 }}>
        <Link to={`/admin/importacoes/${resultado.batchPublicId}`}>Ver a trilha completa do lote</Link>
      </div>

      <div className="barra">
        <button type="button" className="primario" onClick={onConcluir}>Concluir</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Peças compartilhadas
// ---------------------------------------------------------------------

function ResumoPorAcao({ contagens }: { contagens: Record<string, number> }): JSX.Element {
  const ORDEM = ["CREATE", "SKIP", "CONFLICT", "QUARANTINE"];
  return (
    <div className="cards">
      {ORDEM.map((acao) => (
        <div className="card" key={acao}>
          <div className="rotulo">{rotulo(acao)}</div>
          <div className="valor">{contagens[acao] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

function TabelaDeItens({ itens }: { itens: readonly ItemProposto[] }): JSX.Element {
  return (
    <div className="tabela-rolavel">
      <table>
        <thead>
          <tr><th>Entidade</th><th>Ação</th><th>Motivo</th><th>Depois</th></tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <tr key={`${item.entityKind}-${item.action}`}>
              <td>{item.entityKind}</td>
              <td><Badge valor={item.action} /></td>
              <td>{motivo(item.reasonCode)}</td>
              <td><CamposDoSnapshot snapshot={item.after} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O snapshot chega REDIGIDO do backend. Esta função não decide o que
 * esconder — ela apenas destaca o que já veio marcado, para que quem
 * audita veja que havia ali um campo sensível sem receber o valor.
 */
function CamposDoSnapshot({ snapshot }: { snapshot: SnapshotRedigido | null }): JSX.Element {
  if (snapshot === null) {
    return <>—</>;
  }
  return (
    <>
      {Object.entries(snapshot.fields).map(([chave, valor]) => (
        <div key={chave}>
          <strong>{chave}:</strong>{" "}
          <span className={snapshot.redactedFields.includes(chave) ? "redigido" : undefined}>
            {valor === null ? "—" : String(valor)}
          </span>
        </div>
      ))}
    </>
  );
}
