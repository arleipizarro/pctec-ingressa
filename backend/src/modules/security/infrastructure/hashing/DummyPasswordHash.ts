import { PasswordHash } from "../../domain/value-objects/PasswordHash.js";

/**
 * Hash PHC Argon2id fixo, usado exclusivamente como "dummy" na
 * mitigação de timing attack do fluxo de login (ADR-030, "Timing
 * attacks"; task v0.6.0, seção 8).
 *
 * As 4 propriedades formais exigidas (ADR-030):
 *
 * 1. **Constante técnica** — gerado uma única vez, fixo neste arquivo,
 *    nunca recalculado em runtime.
 * 2. **Nunca corresponde a uma senha real** — a string usada para gerar
 *    este hash (`"dummy-fixed-value-never-a-real-password-anywhere-
 *    1234567890"`) nunca foi, e nunca será, a senha de nenhuma
 *    `Identity` real — é um valor arbitrário, criado especificamente
 *    para não corresponder a nada.
 * 3. **Não vem do banco** — literal embutido no código; o caminho
 *    "dummy" nunca executa uma consulta adicional a `credentials`, que
 *    também poderia vazar timing.
 * 4. **Parâmetros compatíveis com os normais** — gerado com os mesmos
 *    `ARGON2ID_PARAMS` usados para hashes reais (`Argon2PasswordHasher.ts`)
 *    — nunca um hash mais barato "só para o dummy", o que reintroduziria
 *    a mesma diferença de tempo que esta mitigação existe para eliminar.
 *
 * Uso: `AuthenticateIdentityService` chama `Argon2PasswordHasher.verify()`
 * contra este hash (com uma senha qualquer, o resultado é descartado —
 * só o CUSTO computacional importa) sempre que `Identity`/`Credential`
 * não é encontrada, antes de retornar `AuthenticationFailedError` — nunca
 * pula essa etapa "porque não há Credential para comparar de verdade".
 *
 * **Nunca exposto via HTTP** — usado apenas internamente pelo serviço de
 * autenticação, nunca serializado em nenhuma resposta/log/evento.
 */
export const DUMMY_PASSWORD_HASH = PasswordHash.fromPhcString(
  "$argon2id$v=19$m=65536,p=4,t=3$oAg5tZPBEXTk+Gflmvc5Kg$skJNMtJUB0ak4l7zyG2MYKOdVKmwTOQngzkXgGJdoSg"
);
