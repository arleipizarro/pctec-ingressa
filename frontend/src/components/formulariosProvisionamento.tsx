import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Aplicacao, IntegracaoComOPortal, Organizacao, UsuarioProvisionado } from "../api.js";

const PERFIS_DE_VINCULO = ["EMPLOYEE", "CUSTOMER", "PARTNER", "SUPPLIER", "SERVICE_ACCOUNT"] as const;

/**
 * Código da Application do Portal.
 *
 * É a única aplicação cuja concessão depende de a organização ter
 * referência legada — por isso o nome aparece aqui, e não uma lista
 * genérica de "aplicações com pré-requisito" que hoje teria um item só.
 */
const CODIGO_DO_PORTAL = "PCTEC_PORTAL";

/**
 * Criação de organização.
 *
 * Só três campos porque só três existem: `Organization.create` exige
 * tipo e razão social, e aceita nome fantasia. `documentNumber` é
 * opcional no domínio e tem regra de unicidade própria — pedir aqui
 * inventaria uma obrigação que o modelo não tem.
 *
 * A associação a grupo aparece apenas para COMPANY, e some ao trocar
 * para BUSINESS_GROUP: grupo não pertence a grupo, e deixar o campo
 * visível convidaria a um 422 que a tela já sabe evitar.
 */
export function FormularioNovaOrganizacao({
  grupos,
  enviando,
  onCancelar,
  onConfirmar
}: {
  grupos: readonly Organizacao[];
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (payload: {
    type: string;
    legalName: string;
    tradeName?: string | undefined;
    documentNumber?: string | undefined;
    parentBusinessGroupPublicId?: string | undefined;
  }) => void;
}): JSX.Element {
  const [type, setType] = useState("COMPANY");
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [grupo, setGrupo] = useState("");

  const ehEmpresa = type === "COMPANY";
  const digitosDoCnpj = documentNumber.replace(/\D/g, "");
  const cnpjIncompleto = digitosDoCnpj.length > 0 && digitosDoCnpj.length !== 14;

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    onConfirmar({
      type,
      legalName: legalName.trim(),
      ...(tradeName.trim().length > 0 ? { tradeName: tradeName.trim() } : {}),
      // Só COMPANY leva CNPJ para a correspondência: grupo não recebe
      // vínculo próprio, e mandar o documento dele daria a impressão de
      // que receberia.
      ...(ehEmpresa && digitosDoCnpj.length === 14 ? { documentNumber } : {}),
      ...(ehEmpresa && grupo !== "" ? { parentBusinessGroupPublicId: grupo } : {})
    });
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Nova organização">
      <div className="modal">
        <h3>Nova organização</h3>
        <p className="subtitulo">
          A organização nasce no Ingressa. Nenhum cadastro é criado no Helpdesk ou no Portal. Com CNPJ
          informado, o servidor <strong>consulta</strong> o catálogo do Portal e vincula esta empresa quando o
          documento corresponde a <strong>exatamente um</strong> cliente de lá — nunca por semelhança de nome.
        </p>
        <form onSubmit={enviar}>
          <label htmlFor="nova-org-type">Tipo</label>
          <select
            id="nova-org-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              // Trocar para grupo limpa a seleção: mandar um grupo pai
              // junto de BUSINESS_GROUP seria recusado pelo servidor.
              if (e.target.value !== "COMPANY") {
                setGrupo("");
              }
            }}
            style={{ width: "100%" }}
          >
            <option value="COMPANY">COMPANY — empresa</option>
            <option value="BUSINESS_GROUP">BUSINESS_GROUP — grupo empresarial</option>
          </select>

          <label htmlFor="nova-org-legal-name">Razão social</label>
          <input
            id="nova-org-legal-name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            required
            style={{ width: "100%" }}
          />

          <label htmlFor="nova-org-trade-name">Nome fantasia</label>
          <input
            id="nova-org-trade-name"
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            style={{ width: "100%" }}
          />
          <p className="subtitulo">Opcional.</p>

          {ehEmpresa && (
            <>
              <label htmlFor="nova-org-cnpj">CNPJ</label>
              <input
                id="nova-org-cnpj"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                style={{ width: "100%" }}
              />
              <p className="subtitulo">
                Opcional — e é o que permite <strong>vincular esta empresa ao Portal automaticamente</strong>.
                Com CNPJ, o servidor procura o cliente correspondente e vincula quando encontra{" "}
                <strong>exatamente um</strong>. Sem CNPJ, a empresa é criada igual e o vínculo fica pendente de
                seleção na tela dela.
              </p>
              {cnpjIncompleto && (
                <div className="aviso aviso-alerta" role="status">
                  CNPJ tem 14 dígitos. Enquanto estiver incompleto, ele não será enviado e a empresa nascerá sem
                  documento.
                </div>
              )}
            </>
          )}

          {ehEmpresa && (
            <>
              <label htmlFor="nova-org-grupo">Grupo empresarial</label>
              <select
                id="nova-org-grupo"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">Sem grupo</option>
                {grupos.map((g) => (
                  <option key={g.public_id} value={g.public_id}>
                    {g.trade_name ?? g.legal_name}
                  </option>
                ))}
              </select>
              <p className="subtitulo">
                Opcional. A empresa e o vínculo são gravados juntos: se o vínculo falhar, a empresa não é criada.
              </p>
            </>
          )}

          <div className="acoes">
            <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="primario" disabled={enviando || legalName.trim().length === 0}>
              {enviando ? "Criando…" : "Criar organização"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Provisionamento de usuário dentro de uma organização.
 *
 * **Escopo segue o tipo da organização.** Em COMPANY só existe
 * `ORGANIZATION_ONLY` — `ORGANIZATION_AND_DESCENDANTS` não amplia nada
 * hoje e viraria alcance silencioso no dia em que COMPANY tivesse
 * filhos. O servidor recusa a combinação; a tela nem a oferece.
 *
 * **Só aplicações ACTIVE aparecem.** Uma INACTIVE é recusada pelo
 * servidor antes de escrever — listá-la seria oferecer um caminho que
 * termina em erro.
 *
 * **O perfil é sempre USER, e por isso não há seletor.** ADMIN é
 * administração da plataforma e continua sendo concessão explícita, na
 * tela da pessoa. Um seletor aqui transformaria "criar usuário" num
 * caminho silencioso para criar administrador.
 *
 * **`PCTEC_PORTAL` exige cobertura, e a tela mostra isso ANTES do
 * clique.** Sem referência, o servidor recusa antes de escrever
 * (`PORTAL_ORGANIZATION_REFERENCE_REQUIRED` /
 * `PORTAL_GROUP_REFERENCE_INCOMPLETE`) — a checagem daqui não substitui
 * aquela, e nem poderia: um POST direto na rota nunca passa por este
 * componente. O que ela evita é a pessoa preencher o formulário inteiro
 * para descobrir no fim que faltava um passo anterior.
 */
export function FormularioNovoUsuario({
  organizacao,
  portal,
  aplicacoes,
  enviando,
  onCancelar,
  onConfirmar
}: {
  organizacao: { public_id: string; type: string; legal_name: string };
  /**
   * Cobertura do Portal, como o servidor a calculou. `undefined`/`null`
   * (resposta anterior a esta fatia) NÃO bloqueia: quem decide continua
   * sendo o servidor, e travar a tela por ausência de informação
   * impediria o que talvez seja legítimo.
   */
  portal?: IntegracaoComOPortal | null;
  aplicacoes: readonly Aplicacao[];
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (payload: {
    fullName: string;
    email: string;
    membershipProfile: string;
    membershipScope: string;
    applicationCodes: readonly string[];
    sendInvitation: boolean;
  }) => void;
}): JSX.Element {
  const ehGrupo = organizacao.type === "BUSINESS_GROUP";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [membershipProfile, setMembershipProfile] = useState("CUSTOMER");
  const [membershipScope, setMembershipScope] = useState("ORGANIZATION_ONLY");
  const [selecionadas, setSelecionadas] = useState<readonly string[]>([]);
  const [sendInvitation, setSendInvitation] = useState(true);

  const ativas = useMemo(() => aplicacoes.filter((a) => a.status === "ACTIVE"), [aplicacoes]);

  function alternar(code: string): void {
    setSelecionadas((atual) =>
      atual.includes(code) ? atual.filter((c) => c !== code) : [...atual, code]
    );
  }

  // Só bloqueia quando o servidor DISSE que não está coberto. Cobertura
  // desconhecida (`portal` ausente) segue o caminho normal e deixa a
  // recusa acontecer onde ela é autoritativa.
  const portalSelecionado = selecionadas.includes(CODIGO_DO_PORTAL);
  const semCobertura = portalSelecionado && portal != null && !portal.covered;

  const podeEnviar =
    fullName.trim().length > 0 && email.trim().length > 0 && selecionadas.length > 0 && !semCobertura;

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    onConfirmar({
      fullName: fullName.trim(),
      email: email.trim(),
      membershipProfile,
      membershipScope,
      applicationCodes: selecionadas,
      sendInvitation
    });
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Novo usuário">
      <div className="modal">
        <h3>Novo usuário</h3>
        <p className="subtitulo">
          Em <strong>{organizacao.legal_name}</strong>. A pessoa é criada ativa, <strong>sem senha</strong> — a
          senha nasce só quando ela aceita o convite.
        </p>
        <form onSubmit={enviar}>
          <label htmlFor="novo-usuario-nome">Nome completo</label>
          <input
            id="novo-usuario-nome"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            style={{ width: "100%" }}
          />

          <label htmlFor="novo-usuario-email">E-mail</label>
          <input
            id="novo-usuario-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: "100%" }}
          />

          <label htmlFor="novo-usuario-perfil">Perfil do vínculo</label>
          <select
            id="novo-usuario-perfil"
            value={membershipProfile}
            onChange={(e) => setMembershipProfile(e.target.value)}
            style={{ width: "100%" }}
          >
            {PERFIS_DE_VINCULO.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <p className="subtitulo">Descreve a relação com a organização — não é permissão.</p>

          <label htmlFor="novo-usuario-escopo">Escopo do vínculo</label>
          <select
            id="novo-usuario-escopo"
            value={membershipScope}
            onChange={(e) => setMembershipScope(e.target.value)}
            disabled={!ehGrupo}
            style={{ width: "100%" }}
          >
            <option value="ORGANIZATION_ONLY">ORGANIZATION_ONLY</option>
            {ehGrupo && <option value="ORGANIZATION_AND_DESCENDANTS">ORGANIZATION_AND_DESCENDANTS</option>}
          </select>
          <p className="subtitulo">
            {ehGrupo
              ? "ORGANIZATION_AND_DESCENDANTS alcança também as empresas do grupo."
              : "Em COMPANY existe apenas ORGANIZATION_ONLY."}
          </p>

          <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
            <legend className="subtitulo" style={{ padding: 0 }}>Aplicações concedidas</legend>
            {ativas.length === 0 ? (
              <div className="vazio">Nenhuma aplicação ACTIVE disponível.</div>
            ) : (
              ativas.map((a) => (
                <label key={a.code} style={{ display: "block", fontWeight: "normal" }}>
                  <input
                    type="checkbox"
                    checked={selecionadas.includes(a.code)}
                    onChange={() => alternar(a.code)}
                  />{" "}
                  {a.name} <code>{a.code}</code> — perfil USER
                </label>
              ))
            )}
            <p className="subtitulo">
              Ao menos uma. O perfil concedido é sempre <strong>USER</strong>; conceder ADMIN é uma ação
              separada, na tela da pessoa.
            </p>
            {semCobertura && <AvisoDeCoberturaDoPortal portal={portal!} />}
          </fieldset>

          <label style={{ display: "block", fontWeight: "normal", marginTop: 12 }}>
            <input
              type="checkbox"
              checked={sendInvitation}
              onChange={(e) => setSendInvitation(e.target.checked)}
            />{" "}
            Gerar o convite de primeiro acesso agora
          </label>
          <p className="subtitulo">
            Se desmarcar, o usuário é criado do mesmo jeito e o convite pode ser emitido depois pela tela de
            convites.
          </p>

          <div className="acoes">
            <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="primario" disabled={enviando || !podeEnviar}>
              {enviando ? "Criando…" : "Criar usuário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Por que `PCTEC_PORTAL` está bloqueado, e o que fazer a respeito.
 *
 * Empresa: um link para a própria tela, que é onde o vínculo se resolve
 * — só que a pessoa já ESTÁ nessa tela, então o texto aponta a seção. O
 * grupo é o caso que precisa de link de verdade: cada empresa pendente
 * tem a sua própria página, e é lá que o vínculo acontece.
 */
function AvisoDeCoberturaDoPortal({ portal }: { portal: IntegracaoComOPortal }): JSX.Element {
  // Ambiguidade primeiro: a instrução aqui NÃO é "conclua o vínculo".
  // Mandar vincular quem já tem dois vínculos ativos criaria um terceiro.
  if (portal.ambiguous) {
    const empresas = portal.group?.ambiguousCompanies ?? [];
    return (
      <div className="aviso aviso-erro" role="alert" data-testid="portal-bloqueio">
        {portal.group === null ? (
          <>
            Esta empresa tem <strong>{portal.activeReferenceCount} vínculos ativos</strong> com o Portal.
          </>
        ) : (
          <>
            <strong>{portal.group.ambiguousCompaniesCount}</strong> empresa(s) deste grupo têm mais de um vínculo
            ativo com o Portal.
          </>
        )}{" "}
        Enquanto houver mais de um, não é possível conceder <code>{CODIGO_DO_PORTAL}</code> — e criar outro
        vínculo agravaria o problema. Peça à equipe de plataforma para encerrar o vínculo incorreto.
        {empresas.length > 0 && (
          <ul>
            {empresas.map((empresa) => (
              <li key={empresa.publicId}>
                <Link to={`/admin/organizacoes/${empresa.publicId}`}>{empresa.legalName}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (portal.group === null) {
    return (
      <div className="aviso aviso-erro" role="alert" data-testid="portal-bloqueio">
        Esta empresa ainda não está vinculada ao Portal. Feche este formulário e conclua o vínculo em{" "}
        <strong>“Integração com o Portal”</strong> antes de conceder <code>{CODIGO_DO_PORTAL}</code>.
      </div>
    );
  }

  if (portal.group.totalActiveCompanies === 0) {
    return (
      <div className="aviso aviso-erro" role="alert" data-testid="portal-bloqueio">
        Este grupo não tem nenhuma empresa ativa. Não há cobertura de Portal a consolidar.
      </div>
    );
  }

  return (
    <div className="aviso aviso-erro" role="alert" data-testid="portal-bloqueio">
      Cobertura do Portal incompleta: <strong>{portal.group.linkedCompanies}</strong> de{" "}
      <strong>{portal.group.totalActiveCompanies}</strong> empresas vinculadas. Vincule as que faltam antes de
      conceder <code>{CODIGO_DO_PORTAL}</code>:
      <ul>
        {portal.group.missingCompanies.map((empresa) => (
          <li key={empresa.publicId}>
            <Link to={`/admin/organizacoes/${empresa.publicId}`}>{empresa.legalName}</Link>
          </li>
        ))}
      </ul>
      {portal.group.missingCompaniesTruncated && (
        <span>
          Mostrando {portal.group.missingCompanies.length} de {portal.group.missingCompaniesCount}.
        </span>
      )}
    </div>
  );
}

const MOTIVOS_DE_CONVITE: Readonly<Record<string, string>> = {
  IDENTITY_NOT_FOUND: "Identidade não encontrada.",
  IDENTITY_NOT_ACTIVE: "A identidade não está ACTIVE.",
  IDENTITY_FEDERATION_INACTIVE: "O vínculo federado desta identidade foi revogado.",
  CREDENTIAL_ALREADY_EXISTS: "Já possui senha definida.",
  NO_APPLICATION_ACCESS: "Não tem acesso concedido a nenhum aplicativo.",
  INVITATION_DELIVERY_FAILED: "A emissão do convite falhou. O usuário foi criado; tente emitir de novo."
};

/**
 * Resultado do provisionamento — mostra DOIS fatos separados.
 *
 * "Usuário criado" e "convite gerado" não são a mesma coisa e podem
 * divergir: o usuário sempre existe quando esta tela aparece, e o
 * convite pode não ter sido pedido, ter sido pulado ou ter falhado.
 * Juntar os dois numa única mensagem faria o ADMIN achar que precisa
 * refazer tudo quando só o convite faltou.
 *
 * O link do modo manual aparece UMA vez. Não é persistido, não é
 * reexibido, e não vai para log nem auditoria — quem fechar sem copiar
 * precisa emitir outro.
 */
export function ResultadoDoProvisionamento({
  resultado,
  onFechar
}: {
  resultado: UsuarioProvisionado;
  onFechar: () => void;
}): JSX.Element {
  const [copiado, setCopiado] = useState(false);
  const convite = resultado.invitation;

  async function copiar(): Promise<void> {
    if (convite?.manualLink == null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(convite.manualLink);
      setCopiado(true);
    } catch {
      // Sem permissão de área de transferência: o link continua visível
      // e selecionável na tela, então não há nada a recuperar aqui.
      setCopiado(false);
    }
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Usuário criado">
      <div className="modal">
        <h3>Usuário criado</h3>
        <div className="aviso aviso-ok" role="status">
          <strong>{resultado.fullName}</strong> criado em {resultado.status}, sem senha definida.
        </div>

        <dl className="chave-valor">
          <dt>E-mail</dt><dd>{resultado.email}</dd>
          <dt>publicId</dt><dd><code>{resultado.identityPublicId}</code></dd>
          <dt>Vínculo</dt>
          <dd>{resultado.membership.profile} · {resultado.membership.scope} · {resultado.membership.status}</dd>
          <dt>Acessos</dt>
          <dd>
            {resultado.applicationAccesses.map((a) => `${a.applicationCode} (${a.accessProfile})`).join(", ")}
          </dd>
          <dt>Login habilitado</dt>
          <dd>{resultado.loginEnabled ? "sim" : "não — só após aceitar o convite"}</dd>
        </dl>

        <h4>Convite</h4>
        {!resultado.invitationRequested && (
          <p className="subtitulo">
            Não foi pedido agora. Emita quando quiser pela tela de convites — o usuário já está pronto para
            recebê-lo.
          </p>
        )}
        {convite?.outcome === "CREATED" && (
          <>
            <p className="subtitulo">
              Gerado em modo <strong>{convite.deliveryMode}</strong>
              {convite.expiresAt !== null && <> · expira em {new Date(convite.expiresAt).toLocaleString()}</>}.
            </p>
            {convite.manualLink !== null ? (
              <>
                <div className="aviso aviso-alerta" role="alert">
                  Este link aparece <strong>uma única vez</strong> e não é recuperável. Copie agora; se fechar
                  sem copiar, será preciso emitir outro convite.
                </div>
                <input
                  readOnly
                  aria-label="Link do convite"
                  value={convite.manualLink}
                  style={{ width: "100%" }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" onClick={copiar}>{copiado ? "Copiado" : "Copiar link"}</button>
                <p className="subtitulo">
                  Não há envio de e-mail neste ambiente: o transporte SMTP não está ligado neste build, e o
                  modo de entrega é MANUAL_DEV. Entregue o link por um canal que você confie.
                </p>
              </>
            ) : (
              <p className="subtitulo">O convite foi entregue pelo canal configurado.</p>
            )}
          </>
        )}
        {convite !== null && convite.outcome !== "CREATED" && (
          <div className="aviso aviso-erro" role="alert">
            Convite não emitido
            {convite.reasonCode !== null && (
              <> — {MOTIVOS_DE_CONVITE[convite.reasonCode] ?? convite.reasonCode}</>
            )}
            . O usuário continua criado e correto; tente emitir pela tela de convites.
          </div>
        )}

        <div className="acoes">
          <button type="button" className="primario" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
