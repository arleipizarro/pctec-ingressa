/**
 * Política de redação de campos sensíveis — UMA no sistema inteiro.
 *
 * Nasceu no importador (`ImportItemSnapshot`, v0.10.x) para impedir que
 * `users.password`, `users.reset_token` e companhia entrassem em
 * `import_batch_items`. Mora aqui desde a tela de auditoria (v0.11.x),
 * porque a mesma pergunta — "este nome de campo pode ser exibido?" —
 * passou a ser feita por dois bounded contexts. Duas cópias divergiriam
 * no primeiro nome novo acrescentado de um lado só, e a cópia
 * desatualizada seria justamente a que deixa passar um segredo.
 *
 * `ImportItemSnapshot` continua reexportando `isForbiddenSnapshotField`
 * e `REDACTED_MARKER`: quem já importava de lá não precisa mudar.
 */

/**
 * Campos que NUNCA podem ser gravados num snapshot nem exibidos num
 * payload de auditoria, qualquer que seja a whitelist do chamador. É a
 * última linha de defesa, não a primeira: o caminho normal é o chamador
 * montar o objeto campo a campo.
 *
 * A lista cobre os nomes reais das colunas sensíveis observadas na
 * auditoria do Helpdesk (`users.password`, `users.reset_token`,
 * `users.reset_expires`, `usuarios.password`,
 * `usuarios.senha_temporaria`) e os nomes genéricos equivalentes.
 */
const DENYLIST_EXATA: ReadonlySet<string> = new Set([
  "password",
  "senha",
  "senha_temporaria",
  "password_hash",
  "passwordhash",
  "hash",
  "salt",
  "token",
  "reset_token",
  "resettoken",
  "reset_expires",
  "refresh_token",
  "access_token",
  "secret",
  "credential",
  "credentials",
  "api_key",
  "apikey",
  "private_key",
  "authorization"
]);

/**
 * Fragmentos que reprovam por conterem — pega variações não previstas
 * (`user_password`, `helpdeskToken`, `senhaProvisoria`).
 *
 * `hash`, `salt` e `authorization` estavam SÓ na lista exata, o que
 * deixava passar exatamente as variações que esta lista existe para
 * pegar: `bcrypt_hash`, `md5_hash`, `user_hash`, `auth_salt`,
 * `authorization_header`. Note que `password_hash` era barrado por
 * acidente, pelo fragmento `password` — tirar `password` da lista teria
 * liberado toda a família `_hash` de uma vez.
 *
 * O custo é assumido: `salt` também barra um campo hipotético `salto` e
 * `hash` barraria `hashtag`. Nenhum dos dois existe no domínio de
 * cadastro que o importador lê nem nos payloads de evento de domínio, e
 * a regra da casa é clara — falso positivo se resolve renomeando o
 * campo; falso negativo grava segredo em tabela de auditoria, de onde
 * não sai mais.
 *
 * `cookie` e `internal_id` entraram com a tela de auditoria: o payload
 * de um evento de domínio pode nomear qualquer coisa, e os dois estão
 * na lista do que essa tela nunca pode devolver. Nenhum campo das
 * whitelists do importador contém esses fragmentos, então a política
 * ficou mais estrita sem mudar o comportamento de lá.
 */
const DENYLIST_FRAGMENTO: readonly string[] = [
  "password",
  "passwd",
  "senha",
  "secret",
  "token",
  "credential",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "hash",
  "salt",
  "authorization",
  "cookie",
  "internal_id"
];

/**
 * Valor devolvido no lugar de um campo que a política atual reprova.
 * Constante — a saída redigida precisa ser determinística.
 */
export const REDACTED_MARKER = "[REDIGIDO]";

function normalizar(field: string): string {
  return field.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * `true` quando o nome do campo é proibido em snapshot ou em payload de
 * auditoria.
 *
 * Deliberadamente conservador: prefere reprovar um campo inocente a
 * deixar passar um sensível. Um falso positivo é resolvido renomeando o
 * campo; um falso negativo grava segredo em tabela de auditoria, de onde
 * não sai mais.
 */
export function isForbiddenSnapshotField(field: string): boolean {
  const normalizado = normalizar(field);
  if (DENYLIST_EXATA.has(normalizado)) {
    return true;
  }
  const semUnderscore = normalizado.replace(/_/g, "");
  return DENYLIST_FRAGMENTO.some(
    (fragmento) => normalizado.includes(fragmento) || semUnderscore.includes(fragmento.replace(/_/g, ""))
  );
}
