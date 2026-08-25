import {
  EmptySelectionError,
  InvalidSourceClientError,
  InvalidSourceUserIdError,
  SelectionTooLargeError,
  WIZARD_MAX_SELECTED_USERS
} from "./HelpdeskImportScope.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HelpdeskImportSelectionInput {
  readonly sourceClientId: unknown;
  readonly selectedSourceUserIds: unknown;
  /**
   * Organization do Ingressa que o ADMIN afirma ser esta empresa.
   *
   * Opcional. Ausente, o assistente resolve pela
   * `OrganizationExternalReference` ativa e, não achando nenhuma, cria a
   * empresa. Presente, ela é uma AFIRMAÇÃO a ser verificada — nunca um
   * palpite aceito.
   */
  readonly targetOrganizationPublicId?: unknown;
  /**
   * Grupo empresarial (BUSINESS_GROUP) do Ingressa sob o qual esta
   * empresa deve ficar.
   *
   * Também afirmação explícita do operador. O vínculo grupo→empresa da
   * ORIGEM não é legível pelo principal read-only atual (ver
   * `HelpdeskCatalogPort`), então ele nunca é inferido: ou o ADMIN
   * aponta o grupo, ou nenhuma relação é criada.
   */
  readonly parentBusinessGroupPublicId?: unknown;
}

/**
 * A seleção do ADMIN, normalizada — o único formato em que ela entra no
 * planner, no fingerprint e no apply.
 *
 * Normalizar aqui, e não em cada chamador, é o que garante que a
 * seleção do DRY_RUN e a do APPLY produzam o MESMO `scopeFingerprint`
 * quando são a mesma seleção: `[44, 35]` e `[35, 44, 35]` são o mesmo
 * pedido escrito de dois jeitos, e uma ordenação diferente não pode
 * fazer o apply achar que a origem mudou.
 *
 * Deduplicar também fecha uma porta pequena e real: repetir o mesmo id
 * 200 vezes passaria pelo teto de tamanho e faria o planner decidir 200
 * vezes sobre a mesma pessoa.
 */
export class HelpdeskImportSelection {
  private constructor(
    private readonly sourceClientId: number,
    private readonly selectedSourceUserIds: readonly number[],
    private readonly targetOrganizationPublicId: string | null,
    private readonly parentBusinessGroupPublicId: string | null
  ) {}

  public static create(input: HelpdeskImportSelectionInput): HelpdeskImportSelection {
    const clientId = inteiroPositivo(input.sourceClientId);
    if (clientId === undefined) {
      throw new InvalidSourceClientError(input.sourceClientId);
    }

    const bruto = Array.isArray(input.selectedSourceUserIds) ? input.selectedSourceUserIds : undefined;
    if (bruto === undefined) {
      throw new InvalidSourceUserIdError(input.selectedSourceUserIds);
    }

    const unicos = new Set<number>();
    for (const valor of bruto) {
      const id = inteiroPositivo(valor);
      if (id === undefined) {
        throw new InvalidSourceUserIdError(valor);
      }
      unicos.add(id);
    }
    if (unicos.size === 0) {
      throw new EmptySelectionError();
    }
    if (unicos.size > WIZARD_MAX_SELECTED_USERS) {
      throw new SelectionTooLargeError(unicos.size);
    }

    return new HelpdeskImportSelection(
      clientId,
      [...unicos].sort((a, b) => a - b),
      uuidOuNulo(input.targetOrganizationPublicId),
      uuidOuNulo(input.parentBusinessGroupPublicId)
    );
  }

  public getSourceClientId(): number {
    return this.sourceClientId;
  }

  public getSelectedSourceUserIds(): readonly number[] {
    return this.selectedSourceUserIds;
  }

  public getTargetOrganizationPublicId(): string | null {
    return this.targetOrganizationPublicId;
  }

  public getParentBusinessGroupPublicId(): string | null {
    return this.parentBusinessGroupPublicId;
  }

  public includes(sourceUserId: number): boolean {
    return this.selectedSourceUserIds.includes(sourceUserId);
  }

  /**
   * Forma canônica da seleção para o `scopeFingerprint`.
   *
   * Números viram string porque `Fingerprint` canoniza valores
   * escalares e a lista precisa entrar como UM campo estável — a
   * alternativa (um campo por usuário) mudaria o formato do material
   * canônico conforme o tamanho da seleção.
   */
  public toFingerprintFields(): Readonly<Record<string, string | number | boolean | null>> {
    return {
      source_client_id: this.sourceClientId,
      selected_source_user_ids: this.selectedSourceUserIds.join(","),
      selected_source_user_count: this.selectedSourceUserIds.length,
      asserted_target_organization_public_id: this.targetOrganizationPublicId,
      asserted_parent_business_group_public_id: this.parentBusinessGroupPublicId
    };
  }
}

function inteiroPositivo(valor: unknown): number | undefined {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor.trim()) : Number.NaN;
  return Number.isInteger(numero) && numero > 0 ? numero : undefined;
}

/**
 * UUID malformado vira `null`, não erro — e a diferença importa: um
 * campo opcional preenchido com lixo é o mesmo pedido de "resolva você"
 * que o campo ausente. O que NUNCA acontece é o valor seguir adiante
 * sem formato de UUID e chegar ao banco.
 */
function uuidOuNulo(valor: unknown): string | null {
  return typeof valor === "string" && UUID.test(valor.trim()) ? valor.trim().toLowerCase() : null;
}
