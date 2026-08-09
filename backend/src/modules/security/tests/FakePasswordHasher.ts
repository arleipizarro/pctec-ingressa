import type { PasswordHasher } from "../application/BootstrapFirstCredentialService.js";
import { PasswordHash } from "../domain/value-objects/PasswordHash.js";
import type { PlainPassword } from "../domain/value-objects/PlainPassword.js";

/**
 * Fake de PasswordHasher — nunca chama Argon2id real (lento, não
 * necessário para testar orquestração/atomicidade). Retorna sempre um
 * PHC sintaticamente válido, mas fixo — a cobertura do algoritmo real
 * fica em `Argon2PasswordHasher.test.ts`.
 *
 * Aceita opcionalmente uma `timeline` compartilhada (a mesma array usada
 * por `FakeCredentialConnection.timeline`) para registrar `HASH_PASSWORD`
 * na MESMA sequência das chamadas SQL — prova a posição exata do hashing
 * na ordem real da operação (revisão crítica: o relatório anterior
 * omitiu esse passo da timeline resumida).
 */
export class FakePasswordHasher implements PasswordHasher {
  public hashCallCount = 0;
  public shouldFail = false;

  public constructor(private readonly sharedTimeline?: string[]) {}

  public async hash(_password: PlainPassword): Promise<PasswordHash> {
    this.hashCallCount += 1;
    if (this.shouldFail) {
      this.sharedTimeline?.push("HASH_PASSWORD_FAILED");
      throw new Error("ER_SIMULATED: falha ao gerar hash (mensagem simulada, nunca a senha)");
    }
    this.sharedTimeline?.push("HASH_PASSWORD");
    return PasswordHash.fromPhcString(
      "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$c29tZWhhc2h2YWx1ZTEyMzQ1Ng"
    );
  }
}
