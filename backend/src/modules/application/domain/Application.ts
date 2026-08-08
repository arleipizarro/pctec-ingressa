import { PublicId } from "./value-objects/PublicId.js";
import { ApplicationCode } from "./value-objects/ApplicationCode.js";
import { ApplicationName } from "./value-objects/ApplicationName.js";

export type ApplicationStatusValue = "ACTIVE" | "INACTIVE";

/** Estado completo, como persistido — usado exclusivamente por `reconstitute`. */
export interface ApplicationPersistedState {
  readonly internalId: number;
  readonly publicId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Aggregate Application.
 *
 * Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 7;
 * docs/03-dominio/APPLICATION-ACCESS-DESIGN.md.
 *
 * Nesta fatia (v0.5.0), `Application` é criada exclusivamente por seed
 * técnico de migration (a Application `PCTEC_INGRESSA` — ver
 * `ApplicationCodes.ts` e a migration
 * `0005_create_applications_and_application_accesses`), não por um
 * comando de domínio `create()` — por isso este Aggregate só expõe
 * `reconstitute()`. Um comando de criação via API/CLI fica para uma
 * fatia futura, se e quando o catálogo de aplicações precisar de gestão
 * dinâmica.
 */
export class Application {
  private constructor(
    private readonly internalId: number,
    private readonly publicId: PublicId,
    private readonly code: ApplicationCode,
    private readonly name: ApplicationName,
    private readonly status: ApplicationStatusValue,
    private readonly version: number,
    private readonly createdAt: Date,
    private readonly updatedAt: Date
  ) {}

  public static reconstitute(state: ApplicationPersistedState): Application {
    return new Application(
      state.internalId,
      PublicId.fromString(state.publicId),
      ApplicationCode.create(state.code),
      ApplicationName.create(state.name),
      state.status === "ACTIVE" || state.status === "INACTIVE" ? state.status : "INACTIVE",
      state.version,
      state.createdAt,
      state.updatedAt
    );
  }

  public getPublicId(): PublicId {
    return this.publicId;
  }

  public getCode(): ApplicationCode {
    return this.code;
  }

  public getName(): ApplicationName {
    return this.name;
  }

  public getStatus(): ApplicationStatusValue {
    return this.status;
  }

  public isActive(): boolean {
    return this.status === "ACTIVE";
  }

  public getVersion(): number {
    return this.version;
  }

  /** Uso exclusivo da camada de infraestrutura — nunca exposto por getter público comum. */
  public getInternalIdForPersistence(): number {
    return this.internalId;
  }
}
