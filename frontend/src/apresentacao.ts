/**
 * Camada de apresentação — tradução de valores técnicos para a língua
 * de quem opera a tela.
 *
 * **Só aparência.** Nada aqui muda enum, contrato de API, valor enviado
 * em formulário ou parâmetro de filtro: a chave continua sendo o valor
 * do servidor, e é ele que segue viajando nas requisições. O que muda é
 * exclusivamente o texto renderizado.
 *
 * **Por que centralizado.** Espalhar `valor === "DRY_RUN" ? "Simulação"`
 * pelo JSX significa que o mesmo enum ganha grafias diferentes em telas
 * diferentes conforme quem editou cada uma. Um mapa só, consultado por
 * todo mundo, mantém "SIMULAÇÃO" igual no painel e na lista de lotes.
 *
 * **Desconhecido não some.** Toda função devolve o valor original
 * quando não há tradução. Um enum novo que o servidor passe a emitir
 * aparece cru — feio, mas visível e verdadeiro. Esconder ou quebrar a
 * tela seria pior do que mostrar `NOVO_ESTADO`.
 */

/**
 * Rótulos de valores que aparecem em selo (`<Badge>`), em célula de
 * tabela ou no texto de uma `<option>`. Em CAIXA ALTA porque é assim
 * que o selo se apresenta e o elemento não aplica `text-transform`.
 *
 * O critério de fronteira: está aqui TODO valor que o `<Badge>`
 * classifica, mais `EXPIRED` e `INACTIVE`, que dividem coluna com eles.
 * Traduzir só parte de uma coluna deixaria o widget meio em português.
 *
 * O que NÃO está aqui continua saindo cru de propósito, e cada um forma
 * uma coluna internamente coerente: os estados da reconciliação
 * (`EXACT_UNIQUE`, `NOT_FOUND`…), o tipo de identidade (`HUMAN`,
 * `SERVICE`), o escopo (`ORGANIZATION_ONLY`) e o perfil de vínculo
 * (`CUSTOMER`). São vocabulários próprios — não um esquecimento.
 */
const ROTULOS: Readonly<Record<string, string>> = {
  // Situação de identidade, organização e vínculo.
  //
  // Os quatro andam juntos no MESMO seletor e na MESMA coluna (ver o
  // filtro de status em UsuariosPage), e `ACTIVE`/`INACTIVE` saem do
  // mesmo ternário em NovaImportacaoPage. Traduzir só um deles produz
  // um widget meio em português e meio em inglês — por isso a família
  // entra inteira, não só `ACTIVE`.
  ACTIVE: "ATIVO",
  INACTIVE: "INATIVO",
  PENDING: "PENDENTE",
  BLOCKED: "BLOQUEADO",
  // `EXPIRED` divide coluna com `PENDING` na lista de convites.
  EXPIRED: "EXPIRADO",
  // Situação de acesso a aplicação — mesma coluna, mesma tabela.
  GRANTED: "CONCEDIDO",
  REVOKED: "REVOGADO",
  // Execução de lote, ao lado de COMPLETED/FAILED.
  RUNNING: "EM EXECUÇÃO",
  // Ação do item de lote: divide seletor e cartões com CONFLICT e
  // QUARANTINE, que já estavam traduzidos desde a rodada anterior.
  CREATE: "CRIAÇÃO",
  SKIP: "IGNORADO",
  // Modo do lote de importação
  DRY_RUN: "SIMULAÇÃO",
  APPLY: "APLICAÇÃO",
  // Desfecho do lote
  COMPLETED: "CONCLUÍDO",
  FAILED: "FALHOU",
  // Pendências de importação
  CONFLICT: "CONFLITO",
  QUARANTINE: "QUARENTENA",
  // Tipo de organização
  BUSINESS_GROUP: "GRUPO EMPRESARIAL",
  COMPANY: "EMPRESA"
};

/** Tradução de um valor avulso. Sem entrada no mapa, devolve o original. */
export function rotulo(valor: string): string {
  return ROTULOS[valor] ?? valor;
}

/**
 * Nome de aplicação para leitura humana: `PCTEC_PORTAL` vira
 * `PCTEC Portal`. Fora do catálogo conhecido, troca `_` por espaço em
 * vez de devolver o código cru — `SISTEMA_NOVO` lido como
 * `SISTEMA NOVO` continua correto sem precisar de cadastro aqui.
 */
const APLICACOES: Readonly<Record<string, string>> = {
  PCTEC_INGRESSA: "PCTEC Ingressa",
  PCTEC_PORTAL: "PCTEC Portal",
  PCTEC_HELPDESK: "PCTEC Helpdesk"
};

export function rotuloDeAplicacao(codigo: string): string {
  return APLICACOES[codigo] ?? codigo.replace(/_/g, " ");
}

/** Perfil de acesso. Desconhecido passa direto. */
const PERFIS: Readonly<Record<string, string>> = {
  ADMIN: "Administrador",
  USER: "Usuário"
};

export function rotuloDePerfil(perfil: string): string {
  return PERFIS[perfil] ?? perfil;
}

/**
 * Rótulo do card de acesso concedido: `PCTEC_PORTAL` + `USER` vira
 * `PCTEC Portal · Usuário`. O CSS do card aplica `text-transform:
 * uppercase`, então a tela mostra `PCTEC PORTAL · USUÁRIO`.
 */
export function rotuloDeAcesso(codigo: string, perfil: string): string {
  return `${rotuloDeAplicacao(codigo)} · ${rotuloDePerfil(perfil)}`;
}

/**
 * Rótulo do card de contagem de identidades, no feminino plural que a
 * frase pede: `ACTIVE` vira `Identidades ativas`.
 *
 * Um status sem tradução vira `Identidades NOVO_STATUS` — a contagem
 * continua legível e o valor cru fica à vista.
 */
const IDENTIDADES: Readonly<Record<string, string>> = {
  ACTIVE: "ativas",
  PENDING: "pendentes",
  BLOCKED: "bloqueadas"
};

export function rotuloDeIdentidades(status: string): string {
  return `Identidades ${IDENTIDADES[status] ?? status}`;
}
