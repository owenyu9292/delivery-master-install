import {
  CapacitorSQLite,
  SQLiteConnection,
  type ISQLiteDBConnection,
} from "@capacitor-community/sqlite";
import type { SqliteDriver, SqliteRow, SqliteValue } from "./sqliteDriver";

export interface CapacitorSqliteDriverOptions {
  database?: string;
  version?: number;
}

export class CapacitorSqliteDriver implements SqliteDriver {
  private readonly database: string;
  private readonly version: number;
  private readonly connection = new SQLiteConnection(CapacitorSQLite);
  private db: ISQLiteDBConnection | null = null;

  constructor(options: CapacitorSqliteDriverOptions = {}) {
    this.database = options.database ?? "delivery-master";
    this.version = options.version ?? 1;
  }

  async open(): Promise<void> {
    if (this.db) return;
    const existing = await this.connection.isConnection(this.database, false);
    this.db = existing.result
      ? await this.connection.retrieveConnection(this.database, false)
      : await this.connection.createConnection(
          this.database,
          false,
          "no-encryption",
          this.version,
          false,
        );
    const openState = await this.db.isDBOpen();
    if (!openState.result) {
      await this.db.open();
    }
  }

  async beginTransaction(): Promise<void> {
    await this.requireDb().beginTransaction();
  }

  async commitTransaction(): Promise<void> {
    await this.requireDb().commitTransaction();
  }

  async rollbackTransaction(): Promise<void> {
    await this.requireDb().rollbackTransaction();
  }

  async query(statement: string, values: SqliteValue[] = []): Promise<SqliteRow[]> {
    const db = this.requireDb();
    const result = await db.query(statement, values);
    return (result.values ?? []) as SqliteRow[];
  }

  async run(statement: string, values: SqliteValue[] = [], transaction = true): Promise<void> {
    const db = this.requireDb();
    await db.run(statement, values, transaction, "no");
  }

  async execute(statements: string): Promise<void> {
    const db = this.requireDb();
    await db.execute(statements, true);
  }

  async close(): Promise<void> {
    if (!this.db) return;
    await this.db.close();
    await this.connection.closeConnection(this.database, false);
    this.db = null;
  }

  private requireDb(): ISQLiteDBConnection {
    if (!this.db) throw new Error("SQLite driver is not open.");
    return this.db;
  }
}
