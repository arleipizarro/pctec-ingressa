import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { AuthorizationCodeRepository } from "../domain/AuthorizationCodeRepository.js";
import type { AuthorizationCode } from "../domain/AuthorizationCode.js";

/**
 * `UnitOfWork` de teste — executa o trabalho e propaga a exceção, sem
 * banco. Não simula rollback porque os repositórios em memória abaixo
 * não têm o que desfazer: o que os testes precisam provar é a ORDEM das
 * operações e a atomicidade do consumo, e essa vive no repositório.
 */
export class FakeUnitOfWork implements UnitOfWork {
  public transacoes = 0;

  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    this.transacoes += 1;
    return work({ execute: async () => [[], []] });
  }
}

export class FakeAuditEventRepository implements AuditEventRepository {
  public readonly eventos: AuditEvent[] = [];

  public async insert(event: AuditEvent): Promise<void> {
    this.eventos.push(event);
  }

  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.eventos.push(...events);
  }

  public tipos(): readonly string[] {
    return this.eventos.map((evento) => evento.eventType);
  }
}

/**
 * Repositório de códigos em memória com a MESMA semântica de consumo do
 * MariaDB: `consumeByCodeHash` só devolve o código se ele ainda não foi
 * consumido e não expirou, e marca o consumo no mesmo passo. É essa
 * semântica que os testes de replay exercitam.
 */
export class FakeAuthorizationCodeRepository implements AuthorizationCodeRepository {
  public readonly codigos = new Map<string, AuthorizationCode>();

  public async insert(authorizationCode: AuthorizationCode): Promise<void> {
    this.codigos.set(authorizationCode.getCodeHash(), authorizationCode);
  }

  public async consumeByCodeHash(codeHash: string, now: Date): Promise<AuthorizationCode | undefined> {
    const codigo = this.codigos.get(codeHash);
    if (codigo === undefined || codigo.isConsumed() || codigo.isExpired(now)) {
      return undefined;
    }
    codigo.markConsumed(now);
    return codigo;
  }
}

/* -------------------------------------------------------------------- */
/* Construtores de agregados sintéticos                                  */
/*                                                                        */
/* Reconstituídos a partir de estado, e não criados por comando: estes    */
/* testes exercitam SSO, não a criação de Identity/Application. Nenhum    */
/* dado real — e-mails em `@example.invalid` (reservado por RFC).         */
/* -------------------------------------------------------------------- */

export const IDENTIDADE_PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
export const OUTRA_IDENTIDADE_PUBLIC_ID = "77777777-7777-4777-8777-777777777777";
export const APLICACAO_PORTAL_PUBLIC_ID = "22222222-2222-4222-8222-222222222222";
export const APLICACAO_OUTRA_PUBLIC_ID = "33333333-3333-4333-8333-333333333333";
export const ORGANIZACAO_PUBLIC_ID = "44444444-4444-4444-8444-444444444444";
export const REDIRECT_URI = "https://portal.example.invalid/api/auth/ingressa/callback";
