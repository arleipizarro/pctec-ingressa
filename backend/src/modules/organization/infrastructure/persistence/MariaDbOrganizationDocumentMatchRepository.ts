import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { OrganizationDocumentMatchRepository } from "../../domain/OrganizationDocumentMatchRepository.js";
import { Organization, type OrganizationPersistedState } from "../../domain/Organization.js";
import type { DocumentNumber } from "../../domain/value-objects/DocumentNumber.js";
import type { OrganizationType } from "../../domain/value-objects/OrganizationType.js";

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
 * Implementação MariaDB de OrganizationDocumentMatchRepository — reusa a
 * tabela `organizations` (migration 0010), mas é um contrato próprio,
 * usado exclusivamente pelo `BootstrapOrganizationsService` (ver
 * justificativa completa em `OrganizationDocumentMatchRepository.ts`).
 * SQL parametrizado.
 */
export class MariaDbOrganizationDocumentMatchRepository implements OrganizationDocumentMatchRepository {
  public constructor(private readonly connection: Queryable) {}

  public async findAllByDocumentNumberAndType(
    documentNumber: DocumentNumber,
    type: OrganizationType
  ): Promise<Organization[]> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, type, legal_name, trade_name, document_number,
              status, version, created_at, updated_at
         FROM organizations
        WHERE document_number = ? AND type = ?`,
      [documentNumber.normalized(), type.toString()]
    );
    return (rows as OrganizationRow[]).map((row) => Organization.reconstitute(mapRowToPersistedState(row)));
  }
}
