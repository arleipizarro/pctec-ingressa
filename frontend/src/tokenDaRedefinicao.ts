import { criarCapturaDeTokenDoFragmento } from "./tokenDoConvite.js";

/**
 * Token do link de redefinição de senha (`/redefinir-senha#<token>`).
 *
 * Mesma captura do convite — lê o fragmento e o apaga da barra na mesma
 * chamada —, numa memória PRÓPRIA: ver `criarCapturaDeTokenDoFragmento`.
 */
const captura = criarCapturaDeTokenDoFragmento();

export function capturarTokenDaRedefinicao(): string {
  return captura.capturar();
}

/** Chamado quando o token não serve mais (usado, expirado, inválido). Também pelos testes. */
export function descartarTokenDaRedefinicao(): void {
  captura.descartar();
}
