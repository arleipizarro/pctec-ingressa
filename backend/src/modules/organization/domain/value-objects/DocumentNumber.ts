import { DomainError } from "../../../../shared/errors/DomainError.js";

export class DocumentNumberInvalidError extends DomainError {
  public readonly code = "ORGANIZATION_DOCUMENT_NUMBER_INVALID";
  public readonly classification = "VALIDATION" as const;

  /**
   * Deliberadamente NÃO inclui o valor bruto na mensagem — mesmo
   * princípio já aplicado a `PublicId`/`Cpf` neste repositório.
   */
  constructor() {
    super("documentNumber, quando informado, deve ter 14 dígitos (CNPJ).");
  }
}

/**
 * Value Object DocumentNumber (CNPJ).
 *
 * **Nome e semântica, deixados explícitos (revisão do Product Owner):**
 * este VO representa especificamente **CNPJ** — não um "documento
 * genérico" com semântica escondida atrás de um nome amplo. O nome da
 * classe (`DocumentNumber`) e da coluna (`organizations.document_number`)
 * seguem a nomenclatura já usada em `MODELO-RELACIONAL-PROPOSTO.md`
 * (seção 3), mas o contrato real, hoje, é CNPJ: 14 dígitos, sem qualquer
 * outro formato de documento aceito. Se no futuro um `BUSINESS_GROUP`
 * precisar de outro tipo de identificador (ex.: um código interno sem
 * relação com CNPJ), isso exige um VO/coluna própria, não uma extensão
 * silenciosa deste — fora de escopo de G1, registrado aqui apenas para
 * não deixar a ambiguidade de nome escondida.
 *
 * **Opcional para AMBOS os tipos de Organization** (ADR-031 /
 * ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 2) — `COMPANY` pode ter CNPJ;
 * `BUSINESS_GROUP` pode não ter (grupos comerciais frequentemente não
 * possuem CNPJ próprio). Este Value Object não conhece `OrganizationType`
 * e não impõe nenhuma regra condicionada a tipo — essa neutralidade é
 * deliberada: a validação de "não herdar CNPJ de empresa filha" é uma
 * regra de processo/serviço, não uma invariante de VO.
 *
 * Validação de dígito verificador de CNPJ é **Pendente de decisão**
 * nesta fatia (mesmo princípio já registrado para CPF em
 * `IDENTITY-DOMAIN-DESIGN.md`, seção 17) — verifica apenas formato
 * estrutural (14 dígitos numéricos após remover pontuação).
 *
 * Persistência: a coluna `organizations.document_number` guarda somente
 * o valor normalizado (mesma convenção descrita em
 * `MODELO-RELACIONAL-PROPOSTO.md`, seção 3, "NULL, normalizado") — ao
 * contrário de `Cpf` (que guarda display + normalizado em duas colunas),
 * aqui há uma única coluna, então `toString()` e `normalized()` retornam
 * o mesmo valor.
 */
export class DocumentNumber {
  private readonly normalizedValue: string;

  private constructor(normalizedValue: string) {
    this.normalizedValue = normalizedValue;
  }

  /**
   * Cria um DocumentNumber a partir de um valor bruto. Retorna
   * `undefined` quando o valor de entrada é ausente/vazio (documentNumber
   * é sempre opcional) — o chamador decide o que fazer com a ausência;
   * esta função nunca lança erro para ausência, apenas para formato
   * inválido quando algo foi informado.
   */
  public static createOptional(rawValue: string | undefined | null): DocumentNumber | undefined {
    if (rawValue === undefined || rawValue === null || rawValue.trim().length === 0) {
      return undefined;
    }
    const digitsOnly = rawValue.replace(/\D/g, "");
    if (digitsOnly.length !== 14) {
      throw new DocumentNumberInvalidError();
    }
    return new DocumentNumber(digitsOnly);
  }

  public static fromPersistence(normalizedValue: string): DocumentNumber {
    return new DocumentNumber(normalizedValue);
  }

  public toString(): string {
    return this.normalizedValue;
  }

  public normalized(): string {
    return this.normalizedValue;
  }

  public equals(other: DocumentNumber): boolean {
    return this.normalizedValue === other.normalizedValue;
  }
}
