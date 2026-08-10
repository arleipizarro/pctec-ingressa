import type { SessionRepository } from "../domain/session/SessionRepository.js";
import type { Session } from "../domain/session/Session.js";

/**
 * Fake mínimo de SessionRepository — nunca abre rede/MariaDB real.
 */
export class FakeSessionValidationRepository implements SessionRepository {
  public readonly byTokenHash = new Map<string, Session>();
  public readonly byPublicId = new Map<string, Session>();
  public findByTokenHashCalls: string[] = [];
  public updateCalls: Array<{ session: Session; expectedVersion: number }> = [];

  public async insert(): Promise<void> {
    // não exercitado nesta fatia
  }

  public async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    this.findByTokenHashCalls.push(tokenHash);
    return this.byTokenHash.get(tokenHash);
  }

  public async findByPublicId(publicId: string): Promise<Session | undefined> {
    return this.byPublicId.get(publicId);
  }

  public async update(session: Session, expectedVersion: number): Promise<void> {
    this.updateCalls.push({ session, expectedVersion });
  }
}
