export type SqliteValue = string | number | null;
export type SqliteRow = Record<string, unknown>;

export interface SqliteDriver {
  open(): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  query(statement: string, values?: SqliteValue[]): Promise<SqliteRow[]>;
  run(statement: string, values?: SqliteValue[], transaction?: boolean): Promise<void>;
  execute(statements: string): Promise<void>;
  close(): Promise<void>;
}
