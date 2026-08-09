import * as argon2 from "argon2";
import { PlainPassword } from "../../domain/value-objects/PlainPassword.js";
import { PasswordHash } from "../../domain/value-objects/PasswordHash.js";

/**
 * Parâmetros de custo do Argon2id — centralizados aqui, não espalhados.
 *
 * **Provisórios: correspondem aos defaults documentados da própria
 * biblioteca `argon2` (`memoryCost=65536` [64 MiB], `timeCost=3`,
 * `parallelism=4`), escolhidos explicitamente para nunca depender
 * silenciosamente do default da lib sem essa decisão documentada — mas
 * NÃO são um número arbitrário inventado aqui.**
 *
 * ADR-029, seção "Argon2id": estes valores exigem benchmark no ambiente
 * de produção real antes de serem considerados definitivos — nenhuma
 * suposição de adequação a hardware de produção foi feita.
 */
export const ARGON2ID_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB — default da biblioteca; benchmark de produção pendente (ADR-029)
  timeCost: 3, // default da biblioteca; benchmark de produção pendente (ADR-029)
  parallelism: 4 // default da biblioteca; benchmark de produção pendente (ADR-029)
} as const;

/**
 * Encapsula a biblioteca `argon2` (node-argon2) atrás de um contrato que
 * só conhece os Value Objects do domínio (`PlainPassword`/`PasswordHash`)
 * — nenhuma outra camada importa `argon2` diretamente.
 *
 * A senha em texto puro só é lida via `PlainPassword.revealForHashing()`,
 * no escopo mínimo desta função — nunca logada, nunca serializada.
 */
export class Argon2PasswordHasher {
  public async hash(password: PlainPassword): Promise<PasswordHash> {
    const phcString = await argon2.hash(password.revealForHashing(), ARGON2ID_PARAMS);
    return PasswordHash.fromPhcString(phcString);
  }

  /**
   * Verifica uma senha em texto puro contra um hash PHC já persistido.
   * Não usada pelo bootstrap (que só cria, nunca verifica) — reservada
   * para a Fase D (login real). Incluída aqui porque pertence à mesma
   * classe de infraestrutura, não para uso nesta fatia.
   */
  public async verify(password: PlainPassword, hash: PasswordHash): Promise<boolean> {
    return argon2.verify(hash.toString(), password.revealForHashing());
  }
}
