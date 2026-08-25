import { useState } from "react";
import type { Aplicacao, Organizacao } from "../api.js";

/** Perfis aceitos pelo domínio — enum fechado, não texto livre. */
export const PERFIS_DE_ACESSO = ["USER", "ADMIN"] as const;
export const PERFIS_DE_MEMBERSHIP = ["CUSTOMER", "EMPLOYEE", "PARTNER", "SUPPLIER", "SERVICE_ACCOUNT"] as const;

/**
 * `ORGANIZATION_AND_DESCENDANTS` só existe para BUSINESS_GROUP.
 *
 * Uma COMPANY não tem descendentes no modelo, então esse escopo ali não
 * significaria "mais acesso" — significaria um vínculo que ninguém sabe
 * resolver. O formulário bloqueia antes do envio, e o domínio recusaria
 * de qualquer forma: a trava aqui é conveniência, nunca a garantia.
 */
export function escopoPermitido(tipoDaOrganizacao: string | undefined): readonly string[] {
  return tipoDaOrganizacao === "BUSINESS_GROUP"
    ? ["ORGANIZATION_ONLY", "ORGANIZATION_AND_DESCENDANTS"]
    : ["ORGANIZATION_ONLY"];
}

export function FormularioConcederAcesso({
  aplicacoes,
  onConfirmar,
  onCancelar,
  enviando
}: {
  aplicacoes: readonly Aplicacao[];
  onConfirmar: (applicationCode: string, accessProfile: string) => void;
  onCancelar: () => void;
  enviando: boolean;
}): JSX.Element {
  const [aplicacao, setAplicacao] = useState("");
  const [perfil, setPerfil] = useState<string>(PERFIS_DE_ACESSO[0]);
  const [erro, setErro] = useState<string | null>(null);

  function confirmar(): void {
    if (aplicacao === "") {
      setErro("Selecione a aplicação.");
      return;
    }
    setErro(null);
    onConfirmar(aplicacao, perfil);
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Conceder acesso">
      <div className="modal">
        <h3>Conceder acesso</h3>
        <p className="subtitulo">
          A pessoa passa a poder usar a aplicação escolhida com o perfil selecionado. A concessão fica
          registrada com o seu nome.
        </p>
        {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}

        <label htmlFor="aplicacao" className="subtitulo" style={{ margin: 0 }}>Aplicação</label>
        <select id="aplicacao" value={aplicacao} onChange={(e) => setAplicacao(e.target.value)} style={{ width: "100%" }}>
          <option value="">Selecione…</option>
          {aplicacoes.filter((a) => a.status === "ACTIVE").map((a) => (
            <option key={a.public_id} value={a.code}>{a.code}</option>
          ))}
        </select>

        <label htmlFor="perfil" className="subtitulo" style={{ margin: "10px 0 0" }}>Perfil</label>
        <select id="perfil" value={perfil} onChange={(e) => setPerfil(e.target.value)} style={{ width: "100%" }}>
          {PERFIS_DE_ACESSO.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <div className="acoes">
          <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
          <button type="button" className="primario" onClick={confirmar} disabled={enviando}>
            {enviando ? "Concedendo…" : "Conceder"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FormularioCriarMembership({
  organizacoes,
  onConfirmar,
  onCancelar,
  enviando
}: {
  organizacoes: readonly Organizacao[];
  onConfirmar: (organizationPublicId: string, profile: string, scope: string) => void;
  onCancelar: () => void;
  enviando: boolean;
}): JSX.Element {
  const [organizacao, setOrganizacao] = useState("");
  const [perfil, setPerfil] = useState<string>(PERFIS_DE_MEMBERSHIP[0]);
  const [escopo, setEscopo] = useState("ORGANIZATION_ONLY");
  const [erro, setErro] = useState<string | null>(null);

  const selecionada = organizacoes.find((o) => o.public_id === organizacao);
  const escopos = escopoPermitido(selecionada?.type);

  function trocarOrganizacao(publicId: string): void {
    setOrganizacao(publicId);
    // Trocar para uma COMPANY com AND_DESCENDANTS escolhido deixaria um
    // valor inválido no formulário; volta para o único escopo válido.
    const permitidos = escopoPermitido(organizacoes.find((o) => o.public_id === publicId)?.type);
    if (!permitidos.includes(escopo)) {
      setEscopo("ORGANIZATION_ONLY");
    }
  }

  function confirmar(): void {
    if (organizacao === "") {
      setErro("Selecione a organização.");
      return;
    }
    if (!escopos.includes(escopo)) {
      setErro("Escopo incompatível com o tipo da organização.");
      return;
    }
    setErro(null);
    onConfirmar(organizacao, perfil, escopo);
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Criar membership">
      <div className="modal">
        <h3>Criar membership</h3>
        <p className="subtitulo">
          A pessoa passa a pertencer à organização escolhida, no escopo selecionado. O vínculo fica
          registrado com o seu nome.
        </p>
        {erro !== null && <div className="aviso aviso-erro" role="alert">{erro}</div>}

        <label htmlFor="organizacao" className="subtitulo" style={{ margin: 0 }}>Organização</label>
        <select id="organizacao" value={organizacao} onChange={(e) => trocarOrganizacao(e.target.value)} style={{ width: "100%" }}>
          <option value="">Selecione…</option>
          {organizacoes.filter((o) => o.status === "ACTIVE").map((o) => (
            <option key={o.public_id} value={o.public_id}>{o.trade_name ?? o.legal_name} · {o.type}</option>
          ))}
        </select>

        <label htmlFor="perfil-membership" className="subtitulo" style={{ margin: "10px 0 0" }}>Perfil</label>
        <select id="perfil-membership" value={perfil} onChange={(e) => setPerfil(e.target.value)} style={{ width: "100%" }}>
          {PERFIS_DE_MEMBERSHIP.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <label htmlFor="escopo" className="subtitulo" style={{ margin: "10px 0 0" }}>Escopo</label>
        <select id="escopo" value={escopo} onChange={(e) => setEscopo(e.target.value)} style={{ width: "100%" }}>
          {escopos.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        {selecionada !== undefined && escopos.length === 1 && (
          <p className="subtitulo" style={{ margin: "6px 0 0" }}>
            Só <code>ORGANIZATION_ONLY</code> se aplica: {selecionada.type} não tem descendentes.
          </p>
        )}

        <div className="acoes">
          <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
          <button type="button" className="primario" onClick={confirmar} disabled={enviando}>
            {enviando ? "Criando…" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Correção administrativa de nomes da organização.
 *
 * Só dois campos, e a ausência dos outros é a mensagem: `type`,
 * `status`, documento e referências externas mudam o significado da
 * organização para quem já depende dela, e nenhum deles tem campo aqui
 * nem rota que os aceite. Nome é a única correção que não reescreve
 * autorização nenhuma.
 *
 * `version` viaja escondida e volta no salvamento: é ela que faz o
 * servidor recusar quando outra pessoa editou a mesma organização entre
 * a abertura do formulário e o clique.
 */
export function FormularioEditarOrganizacao({
  organizacao,
  onConfirmar,
  onCancelar,
  enviando
}: {
  organizacao: { legal_name: string; trade_name: string | null; type: string; status: string; version: number };
  onConfirmar: (valores: { legalName: string; tradeName: string }) => void;
  onCancelar: () => void;
  enviando: boolean;
}): JSX.Element {
  const [legalName, setLegalName] = useState(organizacao.legal_name);
  const [tradeName, setTradeName] = useState(organizacao.trade_name ?? "");

  const razaoSocialVazia = legalName.trim().length === 0;
  const semMudanca =
    legalName.trim() === organizacao.legal_name.trim() &&
    tradeName.trim() === (organizacao.trade_name ?? "").trim();

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Editar organização">
      <div className="modal">
        <h3>Editar organização</h3>
        <p className="subtitulo">
          Corrige apenas os nomes. Tipo, situação, documento e referências externas não são
          alterados por esta tela.
        </p>

        <label>
          <span className="subtitulo" style={{ display: "block", margin: 0 }}>Razão social</span>
          <input
            aria-label="Razão social"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        {razaoSocialVazia && (
          <p className="aviso aviso-erro" role="alert" style={{ marginTop: 8 }}>
            A razão social não pode ficar vazia.
          </p>
        )}

        <label>
          <span className="subtitulo" style={{ display: "block", margin: "10px 0 0" }}>Nome fantasia</span>
          <input
            aria-label="Nome fantasia"
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            placeholder="(opcional)"
            style={{ width: "100%" }}
          />
        </label>
        <p className="subtitulo" style={{ marginTop: 6 }}>
          Deixar em branco remove o nome fantasia. Editando a versão {organizacao.version} —
          se outra pessoa salvar antes, o servidor recusa e a tela recarrega.
        </p>

        <div className="acoes">
          <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
          <button
            type="button"
            className="primario"
            disabled={enviando || razaoSocialVazia || semMudanca}
            onClick={() => onConfirmar({ legalName: legalName.trim(), tradeName: tradeName.trim() })}
          >
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
