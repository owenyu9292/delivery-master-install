export type SqliteValue = string | number | null;
export type SqliteRow = Record<string, unknown>;

export interface SqliteDriver {
  open(): Promise<void>;
  query(statement: string, values?: SqliteValue[]): Promise<SqliteRow[]>;
  run(statement: string, values?: SqliteValue[]): Promise<void>;
  execute(statements: string): Promise<void>;
  close(): Promise<void>;
}
