/**
 * Captura do token de convite vindo do FRAGMENTO da URL
 * (`/convite#<token>`).
 *
 * O fragmento é o transporte escolhido porque o navegador nunca o envia
 * ao servidor: ele não entra em access log de Nginx, não vai no
 * cabeçalho `Referer` de nenhum recurso da página e não aparece em log
 * de proxy. Um token em query string apareceria nos três.
 *
 * Mas o fragmento ainda fica na BARRA DE ENDEREÇO e no HISTÓRICO do
 * navegador, onde qualquer pessoa que olhe a tela — ou que use aquele
 * computador depois — o encontra. Por isso a captura e a remoção são um
 * ato só: `capturarTokenDoConvite()` lê o valor para a memória e, na
 * mesma chamada, apaga o fragmento com `history.replaceState`.
 *
 * `replaceState` (e não `pushState`) porque a intenção é fazer a URL com
 * token **deixar de existir**, e não empilhar uma segunda entrada com a
 * primeira ainda alcançável pelo botão "voltar".
 *
 * A captura acontece ANTES de qualquer render de formulário, validação
 * de senha ou chamada de API: quem chama é o inicializador de estado da
 * tela, que roda na primeira renderização, antes de qualquer efeito.
 */

/**
 * Memória do valor já capturado.
 *
 * Necessária porque a remoção é destrutiva: a segunda leitura do
 * fragmento encontraria a URL já limpa e devolveria vazio. Isso
 * aconteceria de verdade em dois casos comuns — o `StrictMode` do React,
 * que invoca inicializadores de estado duas vezes em desenvolvimento, e
 * qualquer remontagem da tela. Guardar o valor mantém a função
 * idempotente: chamadas seguintes devolvem o mesmo token sem depender
 * da URL.
 */
let tokenCapturado: string | null = null;

export function capturarTokenDoConvite(): string {
  if (tokenCapturado !== null) {
    return tokenCapturado;
  }

  const fragmento = window.location.hash;
  tokenCapturado = fragmento.startsWith("#") ? decodeURIComponent(fragmento.slice(1)) : "";

  if (fragmento.length > 0) {
    // Remoção IMEDIATA, na mesma chamada da leitura. Nunca depois do
    // sucesso do resgate: o token não pode sobreviver na barra durante o
    // tempo em que a pessoa está escolhendo a senha, nem se ela desistir
    // no meio.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  return tokenCapturado;
}

/**
 * Descarta o token da memória.
 *
 * Chamado quando ele **não serve mais para nada**: o convite foi
 * consumido com sucesso, ou o servidor respondeu que ele não é mais
 * utilizável (inexistente, expirado, já usado). Nos dois casos, manter o
 * valor vivo no processo seria guardar uma credencial sem propósito —
 * ela sobreviveria a tudo que acontecesse na aba depois disso.
 *
 * **Não é chamado quando a senha é recusada pela política.** Ali o
 * convite continua válido e a pessoa vai tentar de novo: apagar o token
 * transformaria um erro de digitação em "peça um convite novo ao
 * administrador".
 *
 * Os testes usam a mesma função — o cache é global ao módulo, e um teste
 * herdaria o token do anterior sem isto.
 */
export function descartarTokenDoConvite(): void {
  tokenCapturado = null;
}
