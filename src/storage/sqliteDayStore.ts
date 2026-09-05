import type { DayRecord } from "../domain/types";
import {
  PHONE_INSTALL_BACKUP_APP,
  PHONE_INSTALL_BACKUP_TYPE,
  assertPhoneInstallBackup,
} from "./backupImportExport";
import {
  cloneBackupFile,
  cloneDayRecord,
  createDateSummary,
  type BackupFile,
  type BackupScope,
  type CorruptDayRecord,
  type DateSummary,
  type DayStore,
  type ImportOptions,
  type ImportResult,
  type ResetResult,
  type SaveResult,
} from "./dayStore";
import type { SqliteDriver, SqliteRow } from "./sqliteDriver";
import { assertDayRecord } from "./recordValidation";
import { buildImportPlan } from "./importPlan";

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
    return rows.map((row) => safeDateSummary(parseStoredRow(row))).sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDay(date: string): Promise<DayRecord | null> {
    const rows = await this.query("SELECT date, record_json FROM day_records WHERE date = ?", [date]);
    if (!rows[0]) return null;
    const day = parseStoredRow(rows[0]);
    if (isCorruptDayRecord(day)) throw new Error("SQLite day record JSON is corrupt.");
    assertDayRecord(day, "SQLite day record");
    return cloneDayRecord(day);
  }

  async saveDay(dayRecord: DayRecord): Promise<SaveResult> {
    assertDayRecord(dayRecord, "SQLite day record");
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
    const storedDays = await this.allDaysRaw();
    const selected = scope.kind === "all" ? storedDays : storedDays.filter((day) => rawDate(day) === scope.date);
    const days = selected.filter((day): day is DayRecord => !isCorruptDayRecord(day)).map((day) => cloneDayRecord(day));
    const corruptDays = selected.filter(isCorruptDayRecord);
    return {
      schemaVersion: 1,
      app: PHONE_INSTALL_BACKUP_APP,
      backupType: PHONE_INSTALL_BACKUP_TYPE,
      exportedAt: new Date().toISOString(),
      appVersion: this.appVersion,
      scope,
      days,
      ...(corruptDays.length > 0 ? { corruptDays } : {}),
    };
  }

  async importBackup(file: BackupFile, options: ImportOptions = { mode: "preview" }): Promise<ImportResult> {
    assertPhoneInstallBackup(file);
    const backup = cloneBackupFile(file);
    const existing = await this.allDaysRaw();
    const plan = buildImportPlan(backup, existing, options.mode);
    if (options.mode === "preview" || plan.writes.length === 0) return plan.result;
    await this.ensureReady();
    await this.driver.beginTransaction();
    try {
      for (const day of plan.writes) await this.runInTransaction(day);
      await this.driver.commitTransaction();
      return plan.result;
    } catch (error) {
      try { await this.driver.rollbackTransaction(); } catch { /* retain the original failure */ }
      throw error;
    }
  }

  private async allDaysRaw(): Promise<unknown[]> {
    return (await this.rows()).map(parseStoredRow);
  }

  private async rows(): Promise<SqliteRow[]> {
    return this.query("SELECT date, record_json FROM day_records ORDER BY date DESC");
  }

  private async query(statement: string, values: string[] = []): Promise<SqliteRow[]> {
    await this.ensureReady();
    return this.driver.query(statement, values);
  }

  private async run(statement: string, values: (string | number)[]): Promise<void> {
    await this.ensureReady();
    await this.driver.run(statement, values);
  }

  private async runInTransaction(dayRecord: DayRecord): Promise<void> {
    await this.driver.run(
      `INSERT INTO day_records (date, record_json, updated_at, schema_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET record_json = excluded.record_json,
         updated_at = excluded.updated_at, schema_version = excluded.schema_version`,
      [dayRecord.date, JSON.stringify(cloneDayRecord(dayRecord)), dayRecord.meta.updatedAt, SCHEMA_VERSION],
      false,
    );
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

function validatedDay(day: DayRecord, label: string): DayRecord {
  assertDayRecord(day, label);
  return day;
}

function safeDateSummary(day: unknown): DateSummary {
  if (isCorruptDayRecord(day)) {
    return { date: day.date, status: "reviewNeeded", eventCount: 0, updatedAt: "", recoveryStatus: "needsReview" };
  }
  if (isRecord(day)) {
    try {
      assertDayRecord(day, "SQLite day record");
      return createDateSummary(day);
    } catch {
      return {
        date: typeof day.date === "string" ? day.date : "unknown",
        status: "reviewNeeded",
        eventCount: Array.isArray(day.timeline) ? day.timeline.length : 0,
        updatedAt: isRecord(day.meta) && typeof day.meta.updatedAt === "string" ? day.meta.updatedAt : "",
        recoveryStatus: "needsReview",
      };
    }
  }
  return { date: "unknown", status: "reviewNeeded", eventCount: 0, updatedAt: "", recoveryStatus: "needsReview" };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}

function parseStoredRow(row: SqliteRow): unknown {
  const date = typeof row.date === "string" ? row.date : "unknown";
  const rawCorruptJson = rawJsonText(row.record_json);
  if (typeof row.record_json !== "string") return corruptDay(date, rawCorruptJson);
  try {
    const parsed = JSON.parse(row.record_json) as unknown;
    if (!isRecord(parsed) || typeof parsed.date !== "string") return corruptDay(date, rawCorruptJson);
    return parsed;
  } catch {
    return corruptDay(date, rawCorruptJson);
  }
}

function corruptDay(date: string, rawCorruptJson: string): CorruptDayRecord {
  return { kind: "corrupt-day-record", date, rawCorruptJson };
}

function isCorruptDayRecord(value: unknown): value is CorruptDayRecord {
  return isRecord(value) && value.kind === "corrupt-day-record"
    && typeof value.date === "string" && typeof value.rawCorruptJson === "string";
}

function rawDate(value: unknown): string | undefined {
  return isRecord(value) && typeof value.date === "string" ? value.date : undefined;
}

function rawJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}
