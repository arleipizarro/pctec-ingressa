import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../../domain/OrganizationRepository.js";
import { Organization, type OrganizationPersistedState } from "../../domain/Organization.js";
import { OrganizationVersionConflictError } from "../../domain/errors/OrganizationErrors.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import type { OrganizationType } from "../../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../../domain/value-objects/DocumentNumber.js";

type OrganizationRow = Record<string, unknown>;

function readString(row: OrganizationRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de organizations.`);
  }
  return value;
}

function readOptionalString(row: OrganizationRow, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined ? undefined : String(value);
}

function readNumber(row: OrganizationRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de organizations.`);
}

function readDate(row: OrganizationRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de organizations.`);
}

function mapRowToPersistedState(row: OrganizationRow): OrganizationPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    type: readString(row, "type"),
    legalName: readString(row, "legal_name"),
    tradeName: readOptionalString(row, "trade_name"),
    documentNumber: readOptionalString(row, "document_number"),
    status: readString(row, "status"),
    version: readNumber(row, "version"),
    createdAt: readDate(row, "created_at"),
    updatedAt: readDate(row, "updated_at")
  };
}

/**
 * Implementação MariaDB de OrganizationRepository, conforme
 * `0010_create_organizations.up.sql`. Todas as queries usam parâmetros
 * preparados (`?`), nunca concatenação de SQL com entrada.
 */
export class MariaDbOrganizationRepository implements OrganizationRepository {
  public constructor(private readonly connection: Queryable) {}

  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, type, legal_name, trade_name, document_number,
              status, version, created_at, updated_at
         FROM organizations
        WHERE public_id = ?
        LIMIT 1`,
      [publicId.toString()]
    );
    const rowList = rows as OrganizationRow[];
    const row = rowList[0];
    return row === undefined ? undefined : Organization.reconstitute(mapRowToPersistedState(row));
  }

  public async existsByDocumentNumberAndType(
    documentNumber: DocumentNumber,
    type: OrganizationType
  ): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1 FROM organizations WHERE document_number = ? AND type = ? LIMIT 1`,
      [documentNumber.normalized(), type.toString()]
    );
    return (rows as OrganizationRow[]).length > 0;
  }

  public async insert(organization: Organization): Promise<void> {
    const documentNumber = organization.getDocumentNumber();
    const tradeName = organization.getTradeName();
    const [result] = await this.connection.execute(
      `INSERT INTO organizations
         (public_id, type, legal_name, trade_name, document_number,
          status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        organization.getPublicId().toString(),
        organization.getType().toString(),
        organization.getLegalName().toString(),
        tradeName?.toString() ?? null,
        documentNumber?.normalized() ?? null,
        organization.getStatus(),
        organization.getVersion(),
        organization.getCreatedAt(),
        organization.getUpdatedAt()
      ]
    );
    const insertResult = result as { insertId: number };
    organization.assignInternalIdFromPersistence(insertResult.insertId);
  }

  public async update(organization: Organization, expectedVersion: number): Promise<void> {
    const [result] = await this.connection.execute(
      `UPDATE organizations
          SET legal_name = ?,
              trade_name = ?,
              version = ?,
              updated_at = ?
        WHERE public_id = ?
          AND version = ?`,
      [
        organization.getLegalName().toString(),
        organization.getTradeName()?.toString() ?? null,
        organization.getVersion(),
        organization.getUpdatedAt(),
        organization.getPublicId().toString(),
        expectedVersion
      ]
    );
    // `type`, `status` e `document_number` ficam FORA do SET de
    // propósito: não existe comando de domínio que os altere, e um
    // UPDATE que os reescrevesse com o valor carregado transformaria
    // qualquer leitura defasada em regravação silenciosa deles.
    const { affectedRows } = result as { affectedRows: number };
    if (affectedRows === 0) {
      throw new OrganizationVersionConflictError(expectedVersion, organization.getVersion());
    }
  }

}
