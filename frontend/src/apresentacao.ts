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
 * O critério de fronteira: está aqui TODO valor de enum FECHADO que a
 * interface mostra a quem opera — situação, tipo, perfil, escopo, ação,
 * modo, entidade e situação da reconciliação.
 *
 * Fora daqui ficam, de propósito, os IDENTIFICADORES que existem para
 * rastrear e não para ler: `reason_code` do item de lote, `event_type`
 * da auditoria e `source_entity_type` (o nome da tabela de origem no
 * sistema legado). Traduzi-los quebraria a correspondência com o que
 * está gravado na trilha e com o que o suporte procura.
 *
 * NESTA BASE não existe a reconciliação com o Portal, então os estados
 * dela (`EXACT_UNIQUE`, `NOT_FOUND`…) não entram no mapa: traduzir valor
 * que nenhuma tela renderiza seria vocabulário morto.
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
  CREATE: "CRIAR",
  SKIP: "IGNORAR",
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
  COMPANY: "EMPRESA",
  // Tipo de identidade
  HUMAN: "PESSOA",
  SERVICE: "SERVIÇO",
  // Perfil do vínculo com a organização
  CUSTOMER: "CLIENTE",
  EMPLOYEE: "COLABORADOR",
  PARTNER: "PARCEIRO",
  SUPPLIER: "FORNECEDOR",
  // Consta em PERFIS_DE_VINCULO e aparecia cru no seletor.
  SERVICE_ACCOUNT: "CONTA DE SERVIÇO",
  // Perfil de acesso a uma aplicação
  USER: "USUÁRIO",
  ADMIN: "ADMINISTRADOR",
  // Escopo do vínculo
  ORGANIZATION_ONLY: "SOMENTE ORGANIZAÇÃO",
  ORGANIZATION_AND_DESCENDANTS: "ORGANIZAÇÃO E DESCENDENTES",
  // Entidade tocada por um item de lote
  IDENTITY: "IDENTIDADE",
  ORGANIZATION: "ORGANIZAÇÃO",
  MEMBERSHIP: "VÍNCULO",
  APPLICATION_ACCESS: "ACESSO A APLICAÇÃO",
  IDENTITY_EXTERNAL_REFERENCE: "REFERÊNCIA DA IDENTIDADE",
  ORGANIZATION_EXTERNAL_REFERENCE: "REFERÊNCIA DA ORGANIZAÇÃO"
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
