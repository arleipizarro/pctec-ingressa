import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "./ui.js";
import { ApiError } from "../api.js";
import type {
  ClienteDoPortal,
  CorrespondenciaDoPortal,
  IntegracaoComOPortal,
  PaginaDoCatalogoDoPortal
} from "../api.js";

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
    "vínculo pode ser criado — peça à equipe de plataforma para encerrar o vínculo incorreto.",
  // Recusas da releitura da fonte, feita imediatamente antes de
  // escrever. Elas aparecem quando o cliente muda entre a busca e o
  // clique — e é exatamente para isso que a releitura existe.
  PORTAL_CATALOG_CLIENT_NOT_FOUND:
    "Este cliente não existe mais no Portal. Busque de novo e selecione um cliente atual.",
  PORTAL_CATALOG_CLIENT_INACTIVE:
    "Este cliente foi inativado no Portal e não pode receber vínculo. Reative o cadastro lá antes de vincular.",
  PORTAL_CATALOG_LEGACY_ID_INVALID: "Selecione um cliente do Portal antes de confirmar."
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
 * Mensagens da correspondência automática, por estado do servidor.
 *
 * Cada uma diz o que a pessoa faz A SEGUIR. "Não encontrado" e
 * "ambíguo" levam ao mesmo lugar (a busca manual) por caminhos
 * diferentes, e "sem CNPJ" leva a outro — cadastrar o documento, ou
 * escolher na mão.
 */
export const MOTIVOS_DA_CORRESPONDENCIA: Readonly<Record<string, string>> = {
  NOT_FOUND:
    "Nenhum cliente do Portal tem o CNPJ desta empresa. Busque pelo nome e selecione o cliente correto.",
  AMBIGUOUS:
    "Mais de um cliente ATIVO do Portal tem o CNPJ desta empresa. Nada é sugerido automaticamente enquanto " +
    "houver duplicidade no cadastro do Portal — selecione manualmente o cliente correto, ou corrija a " +
    "duplicidade lá.",
  INACTIVE_ONLY:
    "O CNPJ desta empresa existe no Portal, mas apenas em cliente INATIVO. Um cliente inativo não pode " +
    "receber vínculo — reative o cadastro no Portal. Cadastrar a empresa de novo criaria a duplicidade que " +
    "depois impede qualquer vínculo automático.",
  DOCUMENT_MISSING_OR_INVALID:
    "Esta empresa não tem CNPJ cadastrado no Ingressa, então não há correspondência automática. Busque pelo " +
    "nome e selecione o cliente do Portal.",
  NOT_A_COMPANY: "Um grupo não recebe vínculo próprio."
};

/** Código do 503 quando a fonte do Portal não está configurada no servidor. */
export const PORTAL_CATALOGO_INDISPONIVEL = "PORTAL_CATALOG_SOURCE_NOT_CONFIGURED";

interface EstadoDaBusca {
  readonly carregando: boolean;
  readonly resultados: readonly ClienteDoPortal[];
  readonly total: number;
  readonly buscou: boolean;
  readonly erro: string | null;
}

const BUSCA_VAZIA: EstadoDaBusca = { carregando: false, resultados: [], total: 0, buscou: false, erro: null };

/**
 * Vínculo ao Portal — busca, seleção explícita e confirmação.
 *
 * **O campo cru de `clientes.id` deixou de existir.** Ele exigia que
 * quem administra soubesse um id de outro sistema, descoberto no SQL —
 * e um número digitado errado criava um vínculo irreversível para a
 * empresa errada, sem nada na tela que permitisse notar. Agora a tela
 * mostra nome e CNPJ mascarado, e o `legacyId` só existe como
 * consequência de um resultado selecionado.
 *
 * Três caminhos, nesta ordem:
 *
 *  1. **sugestão automática** — quando o CNPJ da empresa bate com
 *     exatamente UM cliente do Portal. Ainda assim exige o clique: o
 *     vínculo não tem desfazer nesta tela, e uma correspondência exata
 *     depende de os dois cadastros estarem certos;
 *  2. **busca administrativa** — por nome ou por CNPJ. Ela nunca
 *     vincula sozinha, nem quando devolve um resultado só: um resultado
 *     único de busca textual continua sendo coincidência de nome, e
 *     nome não é evidência nesta integração;
 *  3. **fonte indisponível** — a tela diz isso, e não "nada
 *     encontrado". São fatos diferentes, e confundi-los faria alguém
 *     procurar um cadastro que existe.
 */
export function FormularioVincularPortal({
  organizacao,
  correspondencia,
  correspondenciaCarregando,
  correspondenciaIndisponivel,
  enviando,
  onBuscar,
  onCancelar,
  onConfirmar
}: {
  organizacao: { legal_name: string };
  /** Resultado da correspondência automática. `null` enquanto não se sabe. */
  correspondencia: CorrespondenciaDoPortal | null;
  correspondenciaCarregando: boolean;
  /** `true` quando o servidor respondeu 503: a fonte não está configurada. */
  correspondenciaIndisponivel: boolean;
  enviando: boolean;
  onBuscar: (termo: string) => Promise<PaginaDoCatalogoDoPortal>;
  onCancelar: () => void;
  onConfirmar: (legacyId: number) => void;
}): JSX.Element {
  const [termo, setTermo] = useState("");
  const [busca, setBusca] = useState<EstadoDaBusca>(BUSCA_VAZIA);
  const [selecionado, setSelecionado] = useState<number | null>(null);

  // `EXACT_UNIQUE` já implica cliente ATIVO — a regra é do servidor. A
  // segunda checagem existe porque o custo de errar aqui é um vínculo
  // irreversível para um cadastro morto, e uma resposta antiga (ou um
  // servidor de outra versão) não deve conseguir produzir esse botão.
  const sugestao =
    correspondencia?.status === "EXACT_UNIQUE" && correspondencia.suggestion?.active === true
      ? correspondencia.suggestion
      : null;

  async function buscar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    if (termo.trim().length === 0) {
      return;
    }
    setBusca({ ...BUSCA_VAZIA, carregando: true });
    // Trocar a busca limpa a seleção: confirmar um resultado que saiu da
    // lista vincularia algo que a pessoa não está mais vendo.
    setSelecionado(null);
    try {
      const pagina = await onBuscar(termo.trim());
      setBusca({ carregando: false, resultados: pagina.items, total: pagina.total, buscou: true, erro: null });
    } catch (falha) {
      const indisponivel = falha instanceof ApiError && falha.code === PORTAL_CATALOGO_INDISPONIVEL;
      setBusca({
        ...BUSCA_VAZIA,
        buscou: true,
        erro: indisponivel
          ? "O catálogo do Portal está indisponível neste servidor. Nenhuma busca é possível agora."
          : falha instanceof ApiError
            ? falha.message
            : "Falha ao buscar no catálogo do Portal."
      });
    }
  }

  function confirmar(): void {
    if (selecionado !== null) {
      onConfirmar(selecionado);
    }
  }

  return (
    <div className="modal-fundo" role="dialog" aria-modal="true" aria-label="Vincular ao Portal">
      <div className="modal">
        <h3>Vincular ao Portal</h3>
        <p className="subtitulo">
          <strong>{organizacao.legal_name}</strong> passará a resolver para o cliente do Portal que você
          selecionar abaixo.
        </p>

        {correspondenciaIndisponivel ? (
          <div className="aviso aviso-erro" role="alert" data-testid="portal-catalogo-indisponivel">
            O catálogo do Portal está <strong>indisponível</strong> neste servidor: a configuração da fonte não
            está presente. Não é possível buscar nem sugerir clientes agora — peça à equipe de plataforma para
            configurá-la.
          </div>
        ) : (
          <>
            {correspondenciaCarregando && (
              <p className="subtitulo" data-testid="portal-correspondencia-carregando">
                Procurando o cliente do Portal pelo CNPJ desta empresa…
              </p>
            )}

            {sugestao !== null && (
              <div className="aviso aviso-ok" role="status" data-testid="portal-sugestao">
                <p>
                  O CNPJ desta empresa bate com <strong>exatamente um</strong> cliente do Portal:
                </p>
                <p>
                  <strong>{sugestao.name}</strong>
                  {sugestao.tradeName !== null && <> · {sugestao.tradeName}</>}
                  {sugestao.documentMasked !== null && <> · CNPJ {sugestao.documentMasked}</>}
                </p>
                <button
                  type="button"
                  className="primario"
                  disabled={enviando}
                  onClick={() => onConfirmar(sugestao.legacyId)}
                >
                  {enviando ? "Vinculando…" : "Confirmar este cliente"}
                </button>
              </div>
            )}

            {correspondencia !== null && sugestao === null && (
              <div className="aviso aviso-alerta" role="status" data-testid="portal-sem-sugestao">
                {MOTIVOS_DA_CORRESPONDENCIA[correspondencia.status] ??
                  "Não há correspondência automática. Busque e selecione o cliente do Portal."}
              </div>
            )}

            <form onSubmit={(e) => { void buscar(e); }}>
              <label htmlFor="portal-busca">Buscar cliente no Portal</label>
              <input
                id="portal-busca"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Nome, nome fantasia ou CNPJ"
                style={{ width: "100%" }}
              />
              <p className="subtitulo">
                Buscar por CNPJ compara o documento inteiro; buscar por nome apenas <strong>mostra</strong>{" "}
                candidatos — a escolha é sempre sua.
              </p>
              <div className="barra">
                <button type="submit" disabled={busca.carregando || termo.trim().length === 0}>
                  {busca.carregando ? "Buscando…" : "Buscar"}
                </button>
              </div>
            </form>

            {busca.erro !== null && (
              <div className="aviso aviso-erro" role="alert" data-testid="portal-busca-erro">{busca.erro}</div>
            )}

            {busca.buscou && busca.erro === null && busca.resultados.length === 0 && (
              <div className="vazio" data-testid="portal-busca-vazia">
                Nenhum cliente do Portal encontrado para esse termo.
              </div>
            )}

            {busca.resultados.length > 0 && (
              <div className="tabela-rolavel">
                <table>
                  <thead>
                    <tr><th /><th>Cliente</th><th>Nome fantasia</th><th>CNPJ</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {busca.resultados.map((cliente) => (
                      <tr key={cliente.legacyId}>
                        <td>
                          {/* Inativo APARECE — some da lista, alguém
                              procuraria em vão um cadastro que existe —
                              mas não tem seletor. Oferecer o clique e
                              recusar depois seria pior que não oferecer,
                              e a proibição de verdade está no servidor,
                              que relê o cliente antes de escrever. */}
                          {cliente.active ? (
                            <input
                              type="radio"
                              name="portal-cliente"
                              aria-label={`Selecionar ${cliente.name}`}
                              checked={selecionado === cliente.legacyId}
                              onChange={() => setSelecionado(cliente.legacyId)}
                            />
                          ) : (
                            <span className="subtitulo" aria-hidden="true">—</span>
                          )}
                        </td>
                        <td>{cliente.name}</td>
                        <td>{cliente.tradeName ?? "—"}</td>
                        {/* Mascarado, sempre. A tela nunca recebe o
                            documento inteiro do servidor. */}
                        <td>{cliente.hasDocument ? cliente.documentMasked : "sem CNPJ"}</td>
                        <td>
                          <Badge valor={cliente.active ? "ATIVO" : "INATIVO"} />
                          {!cliente.active && (
                            <p className="subtitulo" data-testid={`portal-cliente-inativo-${cliente.legacyId}`}>
                              Inativo no Portal — não pode ser vinculado. Reative o cadastro lá.
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {busca.total > busca.resultados.length && (
              <p className="subtitulo">
                Mostrando os primeiros {busca.resultados.length} de {busca.total}. Refine o termo — de
                preferência pelo CNPJ.
              </p>
            )}
          </>
        )}

        <div className="aviso aviso-alerta" role="alert">
          O vínculo é usado por <strong>todos os usuários do Portal desta empresa</strong>, e{" "}
          <strong>não pode ser trocado nem revogado</strong> por esta tela. Confira o cliente antes de
          confirmar.
        </div>

        <div className="acoes">
          <button type="button" onClick={onCancelar} disabled={enviando}>Cancelar</button>
          <button
            type="button"
            className="primario"
            disabled={enviando || selecionado === null}
            onClick={confirmar}
          >
            {enviando ? "Vinculando…" : "Confirmar vínculo"}
          </button>
        </div>
      </div>
    </div>
  );
}
