import { describe, it, expect } from "vitest";
import { GetIdentityByPublicIdService } from "../application/GetIdentityByPublicIdService.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import { Identity } from "../domain/Identity.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import { InvalidPublicIdError } from "../domain/value-objects/PublicId.js";
import { IdentityNotFoundError } from "../domain/errors/IdentityErrors.js";

const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

/** Fake em memória — nenhum destes testes toca SQL, mysql2 ou rede. */
class InMemoryIdentityRepository implements IdentityRepository {
  public readonly stored = new Map<string, Identity>();
  public findByPublicIdCalls: string[] = [];

  public async findByPublicId(publicId: PublicId): Promise<Identity | undefined> {
    this.findByPublicIdCalls.push(publicId.toString());
    return this.stored.get(publicId.toString());
  }

  public async findByNormalizedEmail(): Promise<Identity | undefined> {
    return undefined;
  }

  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }

  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }

  public async countAll(): Promise<number> {
    return this.stored.size;
  }

  public async insert(identity: Identity): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
  }

  public async update(identity: Identity): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
  }
}

function createValidIdentity() {
  return Identity.create({
    type: "HUMAN",
    fullName: "Maria da Silva",
    email: "maria@example.com",
    actor: SYSTEM_ACTOR,
    correlationId: CORRELATION_ID
  });
}

describe("GetIdentityByPublicIdService", () => {
  it("encontra uma Identity existente pelo publicId", async () => {
    const repository = new InMemoryIdentityRepository();
    const identity = createValidIdentity();
    repository.stored.set(identity.getPublicId().toString(), identity);
    const service = new GetIdentityByPublicIdService(repository);

    const found = await service.execute(identity.getPublicId().toString());

    expect(found.getPublicId().equals(identity.getPublicId())).toBe(true);
  });

  it("lança IdentityNotFoundError (IDENTITY_NOT_FOUND) quando não existe nenhuma Identity com o publicId informado", async () => {
    const repository = new InMemoryIdentityRepository();
    const service = new GetIdentityByPublicIdService(repository);
    const someValidButAbsentUuid = "11111111-1111-1111-1111-111111111111";

    await expect(service.execute(someValidButAbsentUuid)).rejects.toThrow(IdentityNotFoundError);
    await expect(service.execute(someValidButAbsentUuid)).rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND" });
  });

  it("lança InvalidPublicIdError (IDENTITY_PUBLIC_ID_INVALID) quando o publicId não é um UUID sintaticamente válido — nunca consulta o repositório nesse caso", async () => {
    const repository = new InMemoryIdentityRepository();
    const service = new GetIdentityByPublicIdService(repository);

    await expect(service.execute("nao-e-um-uuid")).rejects.toThrow(InvalidPublicIdError);
    await expect(service.execute("nao-e-um-uuid")).rejects.toMatchObject({ code: "IDENTITY_PUBLIC_ID_INVALID" });
    expect(repository.findByPublicIdCalls).toEqual([]);
  });

  it("a mensagem de IDENTITY_PUBLIC_ID_INVALID NUNCA inclui o valor bruto inválido (docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md)", async () => {
    const repository = new InMemoryIdentityRepository();
    const service = new GetIdentityByPublicIdService(repository);
    const sensitiveLookingInput = "input-suspeito-<script>-ou-dado-nao-esperado";

    try {
      await service.execute(sensitiveLookingInput);
      expect.unreachable("deveria ter lançado InvalidPublicIdError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPublicIdError);
      expect((error as Error).message).not.toContain(sensitiveLookingInput);
      expect((error as Error).message).not.toContain("nao-e-um-uuid");
    }
  });

  it("consulta o repositório com o publicId normalizado (minúsculo)", async () => {
    const repository = new InMemoryIdentityRepository();
    const identity = createValidIdentity();
    repository.stored.set(identity.getPublicId().toString(), identity);
    const service = new GetIdentityByPublicIdService(repository);

    await service.execute(identity.getPublicId().toString().toUpperCase());

    expect(repository.findByPublicIdCalls).toEqual([identity.getPublicId().toString()]);
  });

  it("não exige actor — é uma operação de leitura pura, diferente de CreateIdentity", async () => {
    const repository = new InMemoryIdentityRepository();
    const identity = createValidIdentity();
    repository.stored.set(identity.getPublicId().toString(), identity);
    const service = new GetIdentityByPublicIdService(repository);

    // A própria assinatura de execute() só recebe o publicId — nenhum
    // actor é aceito nem exigido. Este teste apenas comprova que a
    // chamada funciona sem qualquer informação de actor.
    await expect(service.execute(identity.getPublicId().toString())).resolves.toBeInstanceOf(Identity);
  });
});
