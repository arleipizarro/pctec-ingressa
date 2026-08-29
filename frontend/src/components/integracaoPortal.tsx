import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "./ui.js";
import type { IntegracaoComOPortal } from "../api.js";

/**
 * Mensagens por código estável do servidor.
 *
 * `api.ts` traduz por STATUS, e para esta operação isso não basta: o 409
 * genérico ("o registro mudou desde que a tela carregou") descreveria
 * errado o único 409 que existe aqui, que é "esta empresa já aponta para
 * outro cliente". Quem sabe o que aconteceu é o `code`.
 */
export const MOTIVOS_DO_VINCULO: Readonly<Record<string, string>> = {
  PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT:
    "Esta empresa já está vinculada a outro id de cliente no Portal. Trocar o vínculo não é possível por esta tela.",
  ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS:
    "Este id de cliente do Portal já está vinculado a outra empresa. Confira o número antes de tentar de novo.",
  PORTAL_REFERENCE_COMPANY_REQUIRED:
    "Somente uma empresa recebe vínculo. Um grupo é coberto pelas empresas dele.",
  PORTAL_REFERENCE_ORGANIZATION_NOT_ACTIVE: "A organização precisa estar ativa para ser vinculada.",
  PORTAL_REFERENCE_LEGACY_ID_INVALID: "Informe o id do cliente no Portal como um número inteiro positivo.",
  PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND: "Organização não encontrada.",
  PORTAL_REFERENCE_AMBIGUOUS:
    "Esta empresa tem mais de um vínculo ativo com o Portal. Enquanto isso não for resolvido, nenhum novo " +
    "vínculo pode ser criado — peça à equipe de plataforma para encerrar o vínculo incorreto."
};

/**
 * Orientação para o cadastro ambíguo.
 *
 * Repetida na seção e no formulário de usuário porque as duas telas
 * levam a pessoa a agir, e a ação certa é a MESMA — e não é "vincular de
 * novo", que é o que a tela ofereceria se tratasse ambiguidade como
 * ausência de vínculo.
 */
const ORIENTACAO_AMBIGUIDADE =
  "Corrigir exige decidir qual vínculo vale e encerrar o outro — operação que hoje só a equipe de " +
  "plataforma executa, com registro. Nenhuma ação desta tela resolve, e criar mais um vínculo agravaria " +
  "o problema.";

/**
 * Seção "Integração com o Portal" na tela de detalhes da organização.
 *
 * **Empresa** mostra o estado do vínculo e, quando não vinculada, o
 * caminho para criá-lo. **Grupo** mostra cobertura e as empresas que
 * faltam — e nunca oferece campo de id, porque grupo não tem
 * `clientes.id` próprio: dar o campo convidaria a um 422 que a tela já
 * sabe evitar.
 *
 * Editar, trocar, revogar e excluir não aparecem porque não existem no
 * servidor nesta fatia. Oferecer o botão e explicar depois que ele não
 * funciona é pior que não oferecer.
 */
export function SecaoIntegracaoPortal({
  portal,
  onVincular
}: {
  portal: IntegracaoComOPortal | null | undefined;
  onVincular: () => void;
}): JSX.Element {
  return (
    <div className="secao">
      <h3>Integração com o Portal</h3>
      {portal === null || portal === undefined ? (
        // Resposta anterior a esta fatia: cobertura desconhecida. Dizer
        // "não vinculada" seria inventar um estado a partir do silêncio.
        <div className="vazio">Estado da integração indisponível nesta resposta.</div>
      ) : portal.group !== null ? (
        <CoberturaDoGrupo portal={portal} />
      ) : (
        <VinculoDaEmpresa portal={portal} onVincular={onVincular} />
      )}
    </div>
  );
}

function VinculoDaEmpresa({
  portal,
  onVincular
}: {
  portal: IntegracaoComOPortal;
  onVincular: () => void;
}): JSX.Element {
  // Ambiguidade vem ANTES de "vinculada" e de "não vinculada": não é
  // nenhuma das duas, e tratá-la como ausência ofereceria o botão que
  // agravaria o estado.
  if (portal.ambiguous) {
    return (
      <>
        <div className="aviso aviso-erro" role="alert" data-testid="portal-estado-empresa">
          Esta empresa tem <strong>{portal.activeReferenceCount} vínculos ativos</strong> com o Portal. Enquanto
          houver mais de um, nenhum deles pode ser tratado como o vínculo da empresa.
        </div>
        <p className="subtitulo">{ORIENTACAO_AMBIGUIDADE}</p>
        {/* Todos listados, nenhum eleito: escolher aqui seria repetir na
            tela o erro que o servidor recusa cometer. */}
        <div className="tabela-rolavel">
          <table>
            <thead><tr><th>Id do cliente no Portal</th><th>Referência</th><th>Status</th></tr></thead>
            <tbody>
              {portal.ambiguousReferences.map((referencia) => (
                <tr key={referencia.publicId}>
                  <td><code>{referencia.legacyId}</code></td>
                  <td><code>{referencia.publicId}</code></td>
                  <td><Badge valor={referencia.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (portal.reference !== null) {
    return (
      <>
        <p className="subtitulo" data-testid="portal-estado-empresa">
          <Badge valor="Vinculada" /> ao Portal em <code>{portal.systemCode}</code>/<code>{portal.entityType}</code>.
        </p>
        <dl className="chave-valor">
          <dt>Id do cliente no Portal</dt>
          <dd><code>{portal.reference.legacyId}</code></dd>
          <dt>Referência</dt>
          <dd><code>{portal.reference.publicId}</code> · <Badge valor={portal.reference.status} /></dd>
        </dl>
        <p className="subtitulo">
          Este vínculo é usado por <strong>todos os usuários do Portal desta empresa</strong>. Trocar ou revogar
          não é possível por esta tela.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="aviso aviso-alerta" role="status" data-testid="portal-estado-empresa">
        Esta empresa <strong>ainda não está vinculada</strong> ao Portal. Enquanto não estiver, não é possível
        criar usuários com acesso ao <code>PCTEC_PORTAL</code>.
      </div>
      <div className="barra">
        <button type="button" onClick={onVincular} disabled={portal.organizationStatus !== "ACTIVE"}>
          Vincular ao Portal
        </button>
      </div>
      {portal.organizationStatus !== "ACTIVE" && (
        <p className="subtitulo">Somente uma organização ativa pode ser vinculada.</p>
      )}
    </>
  );
}

function CoberturaDoGrupo({ portal }: { portal: IntegracaoComOPortal }): JSX.Element {
  const grupo = portal.group!;
  return (
    <>
      <p className="subtitulo" data-testid="portal-cobertura-grupo">
        <strong>{grupo.linkedCompanies}</strong> de <strong>{grupo.totalActiveCompanies}</strong> empresas ativas
        vinculadas ao Portal.
      </p>
      {grupo.ambiguousCompaniesCount > 0 && (
        <>
          <div className="aviso aviso-erro" role="alert" data-testid="portal-grupo-ambiguo">
            <strong>{grupo.ambiguousCompaniesCount}</strong> empresa(s) deste grupo têm mais de um vínculo ativo
            com o Portal. Enquanto isso durar, o grupo não fica coberto — e vincular de novo agravaria o
            problema.
          </div>
          <ul>
            {grupo.ambiguousCompanies.map((empresa) => (
              <li key={empresa.publicId}>
                <Link to={`/admin/organizacoes/${empresa.publicId}`}>{empresa.legalName}</Link>
              </li>
            ))}
          </ul>
          <p className="subtitulo">{ORIENTACAO_AMBIGUIDADE}</p>
        </>
      )}
      {grupo.totalActiveCompanies === 0 ? (
        <div className="aviso aviso-alerta" role="status">
          Este grupo não tem nenhuma empresa ativa. Não há cobertura de Portal a consolidar.
        </div>
      ) : grupo.missingCompaniesCount === 0 && grupo.ambiguousCompaniesCount === 0 ? (
        <div className="aviso aviso-ok" role="status">Cobertura completa.</div>
      ) : grupo.missingCompaniesCount === 0 ? (
        <></>
      ) : (
        <>
          <div className="aviso aviso-alerta" role="status">
            Faltam <strong>{grupo.missingCompaniesCount}</strong> empresa(s). Enquanto a cobertura estiver
            incompleta, não é possível criar usuários com acesso ao <code>PCTEC_PORTAL</code> neste grupo.
          </div>
          <div className="tabela-rolavel">
            <table>
              <thead><tr><th>Empresa</th><th>Nome fantasia</th></tr></thead>
              <tbody>
                {grupo.missingCompanies.map((empresa) => (
                  <tr key={empresa.publicId}>
                    <td>
                      <Link to={`/admin/organizacoes/${empresa.publicId}`}>{empresa.legalName}</Link>
                    </td>
                    <td>{empresa.tradeName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {grupo.missingCompaniesTruncated && (
            <p className="subtitulo">
              A lista mostra as primeiras {grupo.missingCompanies.length} de {grupo.missingCompaniesCount}.
            </p>
          )}
        </>
      )}
      <p className="subtitulo">
        Um grupo <strong>não recebe vínculo próprio</strong>: a visão consolidada vem das referências das
        empresas. Abra cada empresa e vincule individualmente.
      </p>
    </>
  );
}

/**
 * Confirmação explícita antes de escrever.
 *
 * O vínculo não tem desfazer nesta fatia — nem por esta tela, nem por
 * outra. Uma escrita irreversível que acontece no primeiro clique é a
 * receita para descobrir o engano quando já não dá para corrigir; por
 * isso o botão de confirmar só habilita depois de um número válido, e o
 * texto diz o alcance da decisão.
 */
export function FormularioVincularPortal({
  organizacao,
  enviando,
  onCancelar,
  onConfirmar
}: {
  organizacao: { legal_name: string };
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (legacyId: number) => void;
}): JSX.Element {
  const [valor, setValor] = useState("");
  const legacyId = /^[1-9][0-9]*$/.test(valor.trim()) ? Number(valor.trim()) : null;

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    if (legacyId !== null) {
      onConfirmar(legacyId);
    }
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Vincular ao Portal">
      <div className="modal">
        <h3>Vincular ao Portal</h3>
        <p className="subtitulo">
          <strong>{organizacao.legal_name}</strong> passará a resolver para este cliente do Portal.
        </p>

        <form onSubmit={enviar}>
          <label htmlFor="portal-legacy-id">ID do cliente no Portal</label>
          <input
            id="portal-legacy-id"
            inputMode="numeric"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
            style={{ width: "100%" }}
          />
          <p className="subtitulo">Número inteiro positivo — o <code>id</code> do cliente no Portal.</p>

          <div className="aviso aviso-alerta" role="alert">
            O vínculo é usado por <strong>todos os usuários do Portal desta empresa</strong>, e{" "}
            <strong>não pode ser trocado nem revogado</strong> por esta tela. Confira o número antes de
            confirmar.
          </div>

          <div className="acoes">
            <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="primario" disabled={enviando || legacyId === null}>
              {enviando ? "Vinculando…" : "Confirmar vínculo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
