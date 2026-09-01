import type { Request } from "express";

/**
 * Endereço de origem da requisição, para uso do limitador de login.
 *
 * ## Por que NÃO `app.set("trust proxy", ...)`
 *
 * O ajuste global do Express muda muito mais do que `req.ip`: passa a
 * derivar `req.protocol` e `req.secure` de `X-Forwarded-Proto`, o que
 * afeta decisões de cookie e de redirecionamento em toda a aplicação.
 * Ligar isso para resolver um problema de rate limiting seria mudar o
 * comportamento de partes que não pediram nada. Aqui a leitura é local,
 * explícita, e serve a um consumidor só.
 *
 * ## Por que o default NÃO confia em nenhum header
 *
 * `X-Forwarded-For` é escrito pelo cliente antes de qualquer proxy
 * tocar nele. Confiar nele sem saber quantos proxies existem na frente
 * é entregar ao atacante o poder de escolher o próprio identificador —
 * e um limitador cujo escopo o atacante escolhe não limita nada: basta
 * um header novo a cada tentativa. Por isso `TRUSTED_PROXY_HOP_COUNT`
 * é `0` por padrão, e nesse modo só o endereço real do socket é usado.
 *
 * ## Como contar os saltos
 *
 * Cada proxy ACRESCENTA um endereço à direita da lista. Com `N` proxies
 * confiáveis na frente, os `N` últimos itens foram escritos por eles, e
 * o cliente real é o item na posição `comprimento - N`. Tudo o que
 * estiver à ESQUERDA disso foi escrito por alguém que não controlamos e
 * é descartado.
 *
 * No DEV/PRD atuais o Ingressa fica atrás de um Nginx — ou seja,
 * `TRUSTED_PROXY_HOP_COUNT=1`. Sem esse ajuste, **todas** as
 * requisições chegam como `127.0.0.1` e o contador por origem vira um
 * contador global, que barraria a empresa inteira junto. É o único
 * parâmetro desta entrega que precisa ser conferido por ambiente.
 */
export type ClientIpResolver = (req: Request) => string;

const IPV4_MAPEADO = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * `::ffff:192.0.2.10` e `192.0.2.10` são o mesmo endereço; sem
 * normalizar, o mesmo cliente ganharia dois contadores conforme a pilha
 * de rede do momento.
 */
export function normalizeIp(valor: string): string {
  const limpo = valor.trim();
  const mapeado = IPV4_MAPEADO.exec(limpo);
  return mapeado?.[1] ?? limpo;
}

/**
 * Valor usado quando a origem não pôde ser determinada (socket já
 * fechado, transporte fora do comum).
 *
 * Um marcador FIXO, e não "sem limite": todas essas requisições
 * compartilham um contador. É um agrupamento grosseiro e deliberado —
 * a alternativa seria uma porta de entrada sem limitação nenhuma para
 * quem conseguisse produzir a condição.
 */
export const ORIGEM_DESCONHECIDA = "origem-desconhecida";

export function createClientIpResolver(trustedProxyHopCount: number): ClientIpResolver {
  const saltos = Number.isFinite(trustedProxyHopCount) ? Math.max(0, Math.trunc(trustedProxyHopCount)) : 0;

  return function resolveClientIp(req: Request): string {
    const doSocket = req.socket.remoteAddress;

    if (saltos === 0) {
      return doSocket === undefined ? ORIGEM_DESCONHECIDA : normalizeIp(doSocket);
    }

    const header = req.headers["x-forwarded-for"];
    const bruto = Array.isArray(header) ? header.join(",") : header;
    if (typeof bruto === "string" && bruto.length > 0) {
      const enderecos = bruto
        .split(",")
        .map((parte) => normalizeIp(parte))
        .filter((parte) => parte.length > 0);
      const indice = enderecos.length - saltos;
      const candidato = indice >= 0 ? enderecos[indice] : undefined;
      if (candidato !== undefined) {
        return candidato;
      }
      // Lista mais curta que o número de saltos confiáveis: a cadeia não
      // é a esperada. Cair no endereço do socket é o comportamento
      // conservador — nunca aceitar o item mais à esquerda, que é
      // exatamente o que o cliente controla.
    }

    return doSocket === undefined ? ORIGEM_DESCONHECIDA : normalizeIp(doSocket);
  };
}
