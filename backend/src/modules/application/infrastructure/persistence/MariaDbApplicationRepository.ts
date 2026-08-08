import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { ApplicationRepository } from "../../domain/ApplicationRepository.js";
import { Application, type ApplicationPersistedState } from "../../domain/Application.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import type { ApplicationCode } from "../../domain/value-objects/ApplicationCode.js";

type ApplicationRow = Record<string, unknown>;

function readString(row: ApplicationRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de applications.`);
  }
  return value;
}

function readNumber(row: ApplicationRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de applications.`);
}

function readDate(row: ApplicationRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de applications.`);
}

function mapRowToPersistedState(row: ApplicationRow): ApplicationPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    code: readString(row, "code"),
    name: readString(row, "name"),
    status: readString(row, "status"),
    version: readNumber(row, "version"),
    createdAt: readDate(row, "created_at"),
    updatedAt: readDate(row, "updated_at")
  };
}

/**
 * Implementação MariaDB de ApplicationRepository, conforme
 * `0005_create_applications_and_application_accesses.up.sql`.
 * Somente-leitura (ver contrato) — parâmetros sempre preparados, nunca
 * concatenação de SQL com entrada.
 */
export class MariaDbApplicationRepository implements ApplicationRepository {
  public constructor(private readonly connection: Queryable) {}

  public async findByPublicId(publicId: PublicId): Promise<Application | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, code, name, status, version, created_at, updated_at
         FROM applications
        WHERE public_id = ?
        LIMIT 1`,
      [publicId.toString()]
    );
    const rowList = rows as ApplicationRow[];
    const row = rowList[0];
    return row === undefined ? undefined : Application.reconstitute(mapRowToPersistedState(row));
  }

  public async findByCode(code: ApplicationCode): Promise<Application | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, code, name, status, version, created_at, updated_at
         FROM applications
        WHERE code = ?
        LIMIT 1`,
      [code.toString()]
    );
    const rowList = rows as ApplicationRow[];
    const row = rowList[0];
    return row === undefined ? undefined : Application.reconstitute(mapRowToPersistedState(row));
  }
}
