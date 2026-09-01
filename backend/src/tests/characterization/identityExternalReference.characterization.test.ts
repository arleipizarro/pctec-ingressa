/**
 * Testes de CARACTERIZAÇÃO de `IdentityExternalReference` — fundação
 * PCTEC Meu RH (FASE 3, itens 6 e 7).
 *
 * **Item 6 — o que já funciona continua funcionando.** Os dois casos
 * reais em uso hoje são exercitados contra o comportamento atual:
 *
 *   - `PCTEC_PORTAL` / `portal_acesso` → resolução `legacyId → Identity`
 *     usada por `GET /api/v1/service/portal/identity-external-references/...`;
 *   - `PCTEC_HELPDESK` / `users` → mesma direção, usada pelo contexto do
 *     Helpdesk.
 *
 * **Item 7 — os dados atuais satisfazem a futura unicidade.** A
 * invariante que a migration 0024 passará a garantir no banco é
 * "no máximo 1 referência ACTIVE por (identity_public_id, system_code,
 * entity_type)". Aqui ela é ANTECIPADA no dublê de repositório: o
 * `insert` recusa tanto a chave já existente hoje (system, entity,
 * legacy) quanto a chave nova (identity, system, entity). Se os
 * cenários legítimos abaixo continuam passando com as DUAS travas
 * ligadas, a constraint nova não quebra nenhum caso existente — que é
 * exatamente a pergunta que a FASE 6 precisa responder ANTES de criar a
 * migration.
 *
 * A contagem em dado real (21 referências, 21 ACTIVE, 0 duplicidades por
 * `(identity_public_id, system_code, entity_type)`) é verificada
 * separadamente pelo preflight
 * (`preflight-identity-external-reference-binding-uniqueness`), que roda
 * contra o banco. Este arquivo prova a compatibilidade SEMÂNTICA; o
 * preflight prova a do dado.
 *
 * Nenhum dado real: public_ids sintéticos, legacyIds na faixa 9999xx.
 */
import { describe, expect, it } from "vitest";

import { IdentityExternalReference } from "../../modules/identity/domain/IdentityExternalReference.js";
import type { IdentityExternalReferenceRepository } from "../../modules/identity/domain/IdentityExternalReferenceRepository.js";
import { IdentityExternalReferenceAlreadyExistsError } from "../../modules/identity/domain/errors/IdentityExternalReferenceErrors.js";
import { GetActiveIdentityExternalReferenceService } from "../../modules/identity/application/GetActiveIdentityExternalReferenceService.js";
import { IdentityExternalReferenceNotFoundError } from "../../modules/identity/domain/errors/IdentityExternalReferenceErrors.js";
import type { PublicId } from "../../modules/identity/domain/value-objects/PublicId.js";
import type { SystemCode } from "../../modules/identity/domain/value-objects/SystemCode.js";
import type { EntityType } from "../../modules/identity/domain/value-objects/EntityType.js";
import type { LegacyId } from "../../modules/identity/domain/value-objects/LegacyId.js";

const IDENTIDADE_A = "11111111-1111-4111-8111-111111111111";
const IDENTIDADE_B = "22222222-2222-4222-8222-222222222222";
const ATOR = "00000000-0000-4000-8000-000000000000";
const CORRELACAO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * Dublê em memória com AS DUAS invariantes de unicidade ligadas:
 * a que já existe no banco (0016) e a que a 0024 vai acrescentar.
 * Referências SUPERSEDED nunca participam de nenhuma das duas.
 */
class RepositorioComInvarianteFutura implements IdentityExternalReferenceRepository {
  public readonly referencias: IdentityExternalReference[] = [];

  private ativas(): IdentityExternalReference[] {
    return this.referencias.filter((referencia) => referencia.isActive());
  }

  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<boolean> {
    return this.ativas().some(
      (referencia) =>
        referencia.getSystemCode().toString() === systemCode.toString() &&
        referencia.getEntityType().toString() === entityType.toString() &&
        referencia.getLegacyId().toNumber() === legacyId.toNumber()
    );
  }

  public async findByPublicId(publicId: PublicId): Promise<IdentityExternalReference | undefined> {
    return this.referencias.find((referencia) => referencia.getPublicId().toString() === publicId.toString());
  }

  public async findActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<IdentityExternalReference | undefined> {
    return this.ativas().find(
      (referencia) =>
        referencia.getSystemCode().toString() === systemCode.toString() &&
        referencia.getEntityType().toString() === entityType.toString() &&
        referencia.getLegacyId().toNumber() === legacyId.toNumber()
    );
  }

  /**
   * Direção Identity → legado, acrescentada na FASE 5. O dublê passou a
   * implementá-la porque o CONTRATO passou a exigi-la; nenhuma asserção
   * deste arquivo mudou por causa disso.
   */
  public async findActiveByIdentityAndSystemCodeAndEntityType(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<IdentityExternalReference | undefined> {
    return this.ativas().find(
      (referencia) =>
        referencia.getIdentityPublicId() === identityPublicId &&
        referencia.getSystemCode().toString() === systemCode.toString() &&
        referencia.getEntityType().toString() === entityType.toString()
    );
  }

  public async insert(referencia: IdentityExternalReference): Promise<void> {
    const colideNaChaveDeHoje = this.ativas().some(
      (existente) =>
        existente.getSystemCode().toString() === referencia.getSystemCode().toString() &&
        existente.getEntityType().toString() === referencia.getEntityType().toString() &&
        existente.getLegacyId().toNumber() === referencia.getLegacyId().toNumber()
    );
    const colideNaChaveFutura = this.ativas().some(
      (existente) =>
        existente.getIdentityPublicId() === referencia.getIdentityPublicId() &&
        existente.getSystemCode().toString() === referencia.getSystemCode().toString() &&
        existente.getEntityType().toString() === referencia.getEntityType().toString()
    );
    if (colideNaChaveDeHoje || colideNaChaveFutura) {
      throw new IdentityExternalReferenceAlreadyExistsError();
    }
    this.referencias.push(referencia);
  }
}

function referencia(props: {
  identityPublicId: string;
  systemCode: string;
  entityType: string;
  legacyId: number;
}): IdentityExternalReference {
  return IdentityExternalReference.create({
    identityPublicId: props.identityPublicId,
    systemCode: props.systemCode,
    entityType: props.entityType,
    legacyId: props.legacyId,
    matchMethod: "MATCHED_MANUAL_CONFIRMED",
    actorPublicId: ATOR,
    correlationId: CORRELACAO
  });
}

function superseded(props: {
  identityPublicId: string;
  systemCode: string;
  entityType: string;
  legacyId: number;
}): IdentityExternalReference {
  return IdentityExternalReference.reconstitute({
    internalId: 999,
    publicId: "99999999-9999-4999-8999-999999999999",
    identityPublicId: props.identityPublicId,
    systemCode: props.systemCode,
    entityType: props.entityType,
    legacyId: props.legacyId,
    matchMethod: "MATCHED_BY_EMAIL",
    status: "SUPERSEDED",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z")
  });
}

describe("caracterização — 6. os casos Portal e Helpdesk em uso hoje continuam funcionando", () => {
  it("resolve PCTEC_PORTAL/portal_acesso pelo legacyId (direção usada pela rota de serviço do Portal)", async () => {
    const repositorio = new RepositorioComInvarianteFutura();
    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_PORTAL", entityType: "portal_acesso", legacyId: 999901 })
    );
    const service = new GetActiveIdentityExternalReferenceService(repositorio);

    const encontrada = await service.execute("PCTEC_PORTAL", "portal_acesso", 999901);

    expect(encontrada.getIdentityPublicId()).toBe(IDENTIDADE_A);
    expect(encontrada.isActive()).toBe(true);
  });

  it("resolve PCTEC_HELPDESK/users pelo legacyId (direção usada pelo contexto do Helpdesk)", async () => {
    const repositorio = new RepositorioComInvarianteFutura();
    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HELPDESK", entityType: "users", legacyId: 999902 })
    );
    const service = new GetActiveIdentityExternalReferenceService(repositorio);

    const encontrada = await service.execute("PCTEC_HELPDESK", "users", 999902);

    expect(encontrada.getIdentityPublicId()).toBe(IDENTIDADE_A);
  });

  it("legacyId sem referência ACTIVE continua sendo IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND", async () => {
    const service = new GetActiveIdentityExternalReferenceService(new RepositorioComInvarianteFutura());

    await expect(service.execute("PCTEC_PORTAL", "portal_acesso", 999903)).rejects.toBeInstanceOf(
      IdentityExternalReferenceNotFoundError
    );
  });
});

describe("caracterização — 7. a futura unicidade por (identity, system, entity) não quebra nada existente", () => {
  it("a MESMA Identity pode ter referências em sistemas DIFERENTES", async () => {
    const repositorio = new RepositorioComInvarianteFutura();

    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_PORTAL", entityType: "portal_acesso", legacyId: 999910 })
    );
    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HELPDESK", entityType: "users", legacyId: 999911 })
    );

    expect(repositorio.referencias).toHaveLength(2);
  });

  it("a MESMA Identity pode ter referências em entidades DIFERENTES do mesmo sistema", async () => {
    const repositorio = new RepositorioComInvarianteFutura();

    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999920 })
    );
    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HUB", entityType: "usuarios", legacyId: 999921 })
    );

    expect(repositorio.referencias).toHaveLength(2);
  });

  it("Identities DIFERENTES podem ter referências no mesmo sistema/entidade", async () => {
    const repositorio = new RepositorioComInvarianteFutura();

    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HELPDESK", entityType: "users", legacyId: 999930 })
    );
    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_B, systemCode: "PCTEC_HELPDESK", entityType: "users", legacyId: 999931 })
    );

    expect(repositorio.referencias).toHaveLength(2);
  });

  it("linhas SUPERSEDED coexistem livremente e nunca disputam a chave", async () => {
    const repositorio = new RepositorioComInvarianteFutura();
    repositorio.referencias.push(
      superseded({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999940 }),
      superseded({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999941 })
    );

    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999942 })
    );

    expect(repositorio.referencias.filter((r) => r.isActive())).toHaveLength(1);
  });

  it("DUAS referências ACTIVE para a mesma (identity, system, entity) são recusadas — a invariante crítica", async () => {
    const repositorio = new RepositorioComInvarianteFutura();
    await repositorio.insert(
      referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 10 })
    );

    await expect(
      repositorio.insert(
        referencia({ identityPublicId: IDENTIDADE_A, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 20 })
      )
    ).rejects.toBeInstanceOf(IdentityExternalReferenceAlreadyExistsError);
  });
});
