import { DomainError } from "../../../../shared/errors/DomainError.js";

const FORMAT = /^[a-z0-9][a-z0-9-]{0,31}$/;

export class InvalidMappingRulesVersionError extends DomainError {
  public readonly code = "MAPPING_RULES_VERSION_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "mappingRulesVersion inválida: use minúsculas, dígitos e hífen, até 32 caracteres (ex.: helpdesk-v1)."
    );
  }
}

/**
 * Value Object MappingRulesVersion.
 *
 * Versiona a DECISÃO DE NEGÓCIO, não o código. A regra "no Helpdesk,
 * `client_group_id` é classificação e não concessão de acesso" — provada
 * por auditoria do código real — pertence a `helpdesk-v1`. Se o Helpdesk
 * um dia implementar acesso de grupo de verdade, a regra muda, a versão
 * sobe para `helpdesk-v2`, e os lotes antigos continuam explicáveis pelo
 * que valia quando rodaram.
 */
export class MappingRulesVersion {
  private constructor(private readonly value: string) {}

  public static create(rawValue: string): MappingRulesVersion {
    const normalizado = rawValue.trim().toLowerCase();
    if (!FORMAT.test(normalizado)) {
      throw new InvalidMappingRulesVersionError();
    }
    return new MappingRulesVersion(normalizado);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: MappingRulesVersion): boolean {
    return this.value === other.value;
  }
}
