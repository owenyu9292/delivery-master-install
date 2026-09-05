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
  type DateSummary,
  type DayStore,
  type ImportOptions,
  type ImportResult,
  type ResetResult,
  type SaveResult,
} from "./dayStore";
import { assertDayRecord } from "./recordValidation";
import { buildImportPlan } from "./importPlan";

export class MemoryDayStore implements DayStore {
  private readonly days = new Map<string, DayRecord>();

  constructor(initialDays: DayRecord[] = []) {
    for (const day of initialDays) {
      assertDayRecord(day, "Memory day record");
      this.days.set(day.date, cloneDayRecord(day));
    }
  }

  async listDates(): Promise<DateSummary[]> {
    return [...this.days.values()]
      .map(createDateSummary)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDay(date: string): Promise<DayRecord | null> {
    const day = this.days.get(date);
    return day ? cloneDayRecord(day) : null;
  }

  async saveDay(dayRecord: DayRecord): Promise<SaveResult> {
    assertDayRecord(dayRecord, "Memory day record");
    const created = !this.days.has(dayRecord.date);
    this.days.set(dayRecord.date, cloneDayRecord(dayRecord));

    return {
      date: dayRecord.date,
      savedAt: new Date().toISOString(),
      created,
    };
  }

  async resetAll(): Promise<ResetResult> {
    const clearedCount = this.days.size;
    this.days.clear();

    return {
      clearedCount,
      resetAt: new Date().toISOString(),
    };
  }

  async createBackup(scope: BackupScope = { kind: "all" }): Promise<BackupFile> {
    const days = scope.kind === "all"
      ? [...this.days.values()]
      : [...this.days.values()].filter((day) => day.date === scope.date);

    return {
      schemaVersion: 1,
      app: PHONE_INSTALL_BACKUP_APP,
      backupType: PHONE_INSTALL_BACKUP_TYPE,
      exportedAt: new Date().toISOString(),
      appVersion: "0.0.0-prototype",
      scope,
      days: days.map(cloneDayRecord),
    };
  }

  async importBackup(
    file: BackupFile,
    options: ImportOptions = { mode: "preview" },
  ): Promise<ImportResult> {
    assertPhoneInstallBackup(file);
    const existing = [...this.days.values()];
    existing.forEach((day) => assertDayRecord(day, "Memory existing day record"));
    const plan = buildImportPlan(cloneBackupFile(file), existing, options.mode);
    if (options.mode === "preview" || plan.writes.length === 0) return plan.result;
    const snapshot = new Map([...this.days.entries()].map(([date, day]) => [date, cloneDayRecord(day)]));
    try {
      plan.writes.forEach((day) => this.days.set(day.date, cloneDayRecord(day)));
      return plan.result;
    } catch (error) {
      this.days.clear();
      snapshot.forEach((day, date) => this.days.set(date, day));
      throw error;
    }
  }

}
