import type { ReactNode } from "react";
import { rotulo } from "../apresentacao.js";

/**
 * Badge de status — a cor comunica antes da leitura.
 *
 * `valor` é sempre o valor do SERVIDOR: é ele que escolhe a classe, e é
 * ele que os testes e o resto do código continuam enxergando. Só o
 * texto passa por `rotulo()`, que devolve o próprio valor quando não há
 * tradução — um enum novo aparece cru em vez de sumir.
 */
export function Badge({ valor }: { valor: string }): JSX.Element {
  const classe =
    valor === "ACTIVE" || valor === "GRANTED" || valor === "COMPLETED" || valor === "CREATE"
      ? "badge-ok"
      : valor === "PENDING" || valor === "RUNNING" || valor === "QUARANTINE" || valor === "DRY_RUN"
        ? "badge-alerta"
        : valor === "BLOCKED" || valor === "REVOKED" || valor === "FAILED" || valor === "CONFLICT"
          ? "badge-erro"
          : "badge-neutro";
  return <span className={`badge ${classe}`}>{rotulo(valor)}</span>;
}

/**
 * Três estados que toda tela precisa ter e que costumam faltar:
 * carregando, vazio e erro. Sem eles, a tela em branco vira "quebrou?"
 * na cabeça de quem opera.
 */
export function Estado({
  carregando,
  erro,
  vazio,
  children
}: {
  carregando: boolean;
  erro: string | null;
  vazio: boolean;
  children: ReactNode;
}): JSX.Element {
  if (carregando) {
    return <div className="vazio" role="status">Carregando…</div>;
  }
  if (erro !== null) {
    return <div className="aviso aviso-erro" role="alert">{erro}</div>;
  }
  if (vazio) {
    return <div className="vazio">Nenhum registro encontrado.</div>;
  }
  return <>{children}</>;
}

/**
 * Confirmação obrigatória antes de qualquer mutação.
 *
 * O texto descreve a consequência ("o acesso será revogado"), não a
 * operação técnica — quem confirma precisa saber o que muda para as
 * pessoas, não qual endpoint será chamado.
 */
export function Confirmacao({
  titulo,
  descricao,
  confirmando,
  onConfirmar,
  onCancelar,
  children
}: {
  titulo: string;
  descricao: string;
  confirmando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="modal">
        <h3>{titulo}</h3>
        <p className="subtitulo">{descricao}</p>
        {children}
        <div className="acoes">
          <button type="button" onClick={onCancelar} disabled={confirmando}>Cancelar</button>
          <button type="button" className="primario" onClick={onConfirmar} disabled={confirmando}>
            {confirmando ? "Confirmando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Paginacao({
  total,
  limit,
  offset,
  onMudar
}: {
  total: number;
  limit: number;
  offset: number;
  onMudar: (novoOffset: number) => void;
}): JSX.Element {
  const inicio = total === 0 ? 0 : offset + 1;
  const fim = Math.min(offset + limit, total);
  return (
    <div className="barra" style={{ marginTop: 12, alignItems: "center" }}>
      <span className="subtitulo" style={{ margin: 0 }}>{inicio}–{fim} de {total}</span>
      <button type="button" onClick={() => onMudar(Math.max(offset - limit, 0))} disabled={offset === 0}>Anterior</button>
      <button type="button" onClick={() => onMudar(offset + limit)} disabled={fim >= total}>Próxima</button>
    </div>
  );
}
