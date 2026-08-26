import { useMemo, useState, type FormEvent } from "react";
import type { Organizacao } from "../api.js";

/**
 * Correção de nomes.
 *
 * `publicId` e `type` aparecem como leitura: o tipo define a posição na
 * hierarquia e o identificador é imutável por contrato — mostrá-los
 * desabilitados é mais honesto do que escondê-los, porque quem abre o
 * formulário quer conferir que está na organização certa.
 *
 * O aviso sobre a origem não é decorativo: corrigir aqui não altera o
 * Helpdesk nem o Portal, e quem não souber disso vai achar que
 * sincronizou os dois.
 */
export function FormularioEditarOrganizacao({
  organizacao,
  enviando,
  onCancelar,
  onConfirmar
}: {
  organizacao: { public_id: string; type: string; legal_name: string; trade_name: string | null };
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (legalName: string, tradeName: string) => void;
}): JSX.Element {
  const [legalName, setLegalName] = useState(organizacao.legal_name);
  const [tradeName, setTradeName] = useState(organizacao.trade_name ?? "");

  const semMudanca =
    legalName.trim() === organizacao.legal_name && tradeName.trim() === (organizacao.trade_name ?? "");

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    onConfirmar(legalName.trim(), tradeName.trim());
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Editar organização">
      <div className="modal">
        <h3>Editar organização</h3>
        <p className="subtitulo">
          A correção vale apenas no Ingressa. O cadastro de origem no Helpdesk ou no Portal não é alterado.
        </p>
        <form onSubmit={enviar}>
          <label htmlFor="org-legal-name">Razão social</label>
          <input
            id="org-legal-name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            required
            style={{ width: "100%" }}
          />

          <label htmlFor="org-trade-name">Nome fantasia</label>
          <input
            id="org-trade-name"
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            style={{ width: "100%" }}
          />
          <p className="subtitulo">Deixe em branco para remover o nome fantasia.</p>

          <dl className="chave-valor">
            <dt>publicId</dt><dd><code>{organizacao.public_id}</code> (não editável)</dd>
            <dt>Tipo</dt><dd>{organizacao.type} (não editável)</dd>
          </dl>

          <div className="acoes">
            <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="primario" disabled={enviando || semMudanca}>
              {enviando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Associação inicial de uma COMPANY a um BUSINESS_GROUP.
 *
 * A busca é local sobre a lista já carregada — são poucas dezenas de
 * grupos, e uma consulta por tecla traria latência sem ganho.
 *
 * O aviso sobre `AND_DESCENDANTS` existe porque a consequência não é
 * óbvia: quem tem membership no grupo com esse escopo passa a enxergar
 * esta empresa. Nenhum membership é criado, encerrado ou ampliado por
 * esta ação — o que muda é o alcance de vínculos que já existiam.
 */
export function FormularioAssociarGrupo({
  grupos,
  enviando,
  onCancelar,
  onConfirmar
}: {
  grupos: readonly Organizacao[];
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (parentPublicId: string) => void;
}): JSX.Element {
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo.length === 0) {
      return grupos;
    }
    return grupos.filter((g) =>
      `${g.legal_name} ${g.trade_name ?? ""}`.toLowerCase().includes(termo)
    );
  }, [grupos, busca]);

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    if (selecionado !== "") {
      onConfirmar(selecionado);
    }
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Associar a um grupo">
      <div className="modal">
        <h3>Associar a um grupo empresarial</h3>
        <p className="subtitulo">
          Esta empresa passa a pertencer ao grupo escolhido. Quem já tem vínculo no grupo com escopo
          <strong> ORGANIZATION_AND_DESCENDANTS</strong> passará a enxergá-la. Nenhum vínculo é criado,
          encerrado ou ampliado por esta ação.
        </p>
        <form onSubmit={enviar}>
          <label htmlFor="busca-grupo">Buscar grupo</label>
          <input
            id="busca-grupo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Digite parte do nome…"
            style={{ width: "100%" }}
          />

          <label htmlFor="grupo">Grupo empresarial</label>
          <select
            id="grupo"
            value={selecionado}
            onChange={(e) => setSelecionado(e.target.value)}
            required
            size={Math.min(Math.max(filtrados.length, 2), 8)}
            style={{ width: "100%" }}
          >
            {filtrados.length === 0 && <option value="" disabled>Nenhum grupo encontrado</option>}
            {filtrados.map((g) => (
              <option key={g.public_id} value={g.public_id}>{g.trade_name ?? g.legal_name}</option>
            ))}
          </select>

          <div className="acoes">
            <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="primario" disabled={enviando || selecionado === ""}>
              {enviando ? "Associando…" : "Associar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
