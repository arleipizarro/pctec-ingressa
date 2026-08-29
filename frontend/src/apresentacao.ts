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
 * Rótulos de valores que aparecem em selo (`<Badge>`) ou em célula de
 * tabela. Em CAIXA ALTA porque é assim que o selo se apresenta e o
 * elemento não aplica `text-transform`.
 *
 * Estados de identidade (ACTIVE, PENDING, BLOCKED…) NÃO entram aqui: o
 * selo já os mostra e traduzi-los mudaria telas fora deste escopo.
 */
const ROTULOS: Readonly<Record<string, string>> = {
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
