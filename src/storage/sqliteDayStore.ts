import type { DayRecord } from "../domain/types";
import {
  PHONE_INSTALL_BACKUP_APP,
  PHONE_INSTALL_BACKUP_TYPE,
  assertPhoneInstallBackup,
  createBackupCopyDay,
} from "./backupImportExport";
import {
  cloneBackupFile,
  cloneDayRecord,
  createDateSummary,
  type BackupFile,
  type BackupScope,
  type DateSummary,
  type DayStore,
  type ImportOptions,
  type ImportResult,
  type ResetResult,
  type SaveResult,
} from "./dayStore";
import type { SqliteDriver, SqliteRow } from "./sqliteDriver";

const SCHEMA_VERSION = 1;

export interface SqliteDayStoreOptions {
  driver: SqliteDriver;
  appVersion?: string;
}

export class SqliteDayStore implements DayStore {
  private readonly driver: SqliteDriver;
  private readonly appVersion: string;
  private ready: Promise<void> | null = null;

  constructor(options: SqliteDayStoreOptions) {
    this.driver = options.driver;
    this.appVersion = options.appVersion ?? "0.0.0-prototype";
  }

  async listDates(): Promise<DateSummary[]> {
    const rows = await this.rows();
    return rows.map(rowToDay).map(createDateSummary).sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDay(date: string): Promise<DayRecord | null> {
    const rows = await this.query("SELECT record_json FROM day_records WHERE date = ?", [date]);
    return rows[0] ? cloneDayRecord(parseJson(rows[0].record_json)) : null;
  }

  async saveDay(dayRecord: DayRecord): Promise<SaveResult> {
    const existing = await this.getDay(dayRecord.date);
    const savedAt = new Date().toISOString();
    await this.run(
      `INSERT INTO day_records (date, record_json, updated_at, schema_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET record_json = excluded.record_json,
         updated_at = excluded.updated_at, schema_version = excluded.schema_version`,
      [dayRecord.date, JSON.stringify(cloneDayRecord(dayRecord)), dayRecord.meta.updatedAt, SCHEMA_VERSION],
    );
    return { date: dayRecord.date, savedAt, created: !existing };
  }

  async resetAll(): Promise<ResetResult> {
    const rows = await this.query("SELECT COUNT(*) AS count FROM day_records");
    await this.execute("DELETE FROM day_records");
    return { clearedCount: Number(rows[0]?.count ?? 0), resetAt: new Date().toISOString() };
  }

  async createBackup(scope: BackupScope = { kind: "all" }): Promise<BackupFile> {
    const allDays = await this.allDays();
    const days = scope.kind === "all" ? allDays : allDays.filter((day) => day.date === scope.date);
    return {
      schemaVersion: 1,
      app: PHONE_INSTALL_BACKUP_APP,
      backupType: PHONE_INSTALL_BACKUP_TYPE,
      exportedAt: new Date().toISOString(),
      appVersion: this.appVersion,
      scope,
      days: days.map(cloneDayRecord),
    };
  }

  async importBackup(file: BackupFile, options: ImportOptions = { mode: "preview" }): Promise<ImportResult> {
    assertPhoneInstallBackup(file);
    const backup = cloneBackupFile(file);
    const imported: DateSummary[] = [];
    const skipped: ImportResult["skipped"] = [];
    for (const day of backup.days) {
      const existing = await this.getDay(day.date);
      if (options.mode === "preview") {
        if (existing) skipped.push({ date: day.date, reason: "existing_day_preview", existingUpdatedAt: existing.meta.updatedAt, incomingUpdatedAt: day.meta.updatedAt });
        else imported.push(createDateSummary(day));
        continue;
      }
      if (existing && options.mode === "skip") {

        skipped.push({

          date: day.date,

          reason: "existing_day_preserved",

          existingUpdatedAt: existing.meta.updatedAt,

          incomingUpdatedAt: day.meta.updatedAt,

        });

        continue;

      }


      if (existing && options.mode === "copy") {
        const copy = createBackupCopyDay(day);
        await this.saveDay(copy);
        imported.push(createDateSummary(copy));
        continue;
      }
      if (existing && options.mode !== "overwrite") {
        skipped.push({ date: day.date, reason: "existing_day_requires_copy_or_overwrite", existingUpdatedAt: existing.meta.updatedAt, incomingUpdatedAt: day.meta.updatedAt });
        continue;
      }
      await this.saveDay(day);
      imported.push(createDateSummary(day));
    }
    return { mode: options.mode, imported, skipped, preview: options.mode === "preview" };
  }

  private async allDays(): Promise<DayRecord[]> {
    return (await this.rows()).map(rowToDay);
  }

  private async rows(): Promise<SqliteRow[]> {
    return this.query("SELECT record_json FROM day_records ORDER BY date DESC");
  }

  private async query(statement: string, values: string[] = []): Promise<SqliteRow[]> {
    await this.ensureReady();
    return this.driver.query(statement, values);
  }

  private async run(statement: string, values: (string | number)[]): Promise<void> {
    await this.ensureReady();
    await this.driver.run(statement, values);
  }

  private async execute(statements: string): Promise<void> {
    await this.ensureReady();
    await this.driver.execute(statements);
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.driver.open().then(() => this.driver.execute(
        `CREATE TABLE IF NOT EXISTS day_records (
          date TEXT PRIMARY KEY NOT NULL,
          record_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          schema_version INTEGER NOT NULL
        )`,
      ));
    }
    return this.ready;
  }
}

function rowToDay(row: SqliteRow): DayRecord {
  return parseJson(row.record_json);
}

function parseJson(value: unknown): DayRecord {
  if (typeof value !== "string") throw new Error("SQLite day record JSON is not text.");
  return JSON.parse(value) as DayRecord;
}
