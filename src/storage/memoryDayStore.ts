import type { DayRecord } from "../domain/types";
import { createBackupCopyDay } from "./backupImportExport";
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

export class MemoryDayStore implements DayStore {
  private readonly days = new Map<string, DayRecord>();

  constructor(initialDays: DayRecord[] = []) {
    for (const day of initialDays) {
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
    const backup = cloneBackupFile(file);
    const imported: DateSummary[] = [];
    const skipped: ImportResult["skipped"] = [];

    for (const day of backup.days) {
      const existing = this.days.get(day.date);

      if (options.mode === "preview") {
        if (existing) {
          skipped.push({
            date: day.date,
            reason: "existing_day_preview",
            existingUpdatedAt: existing.meta.updatedAt,
            incomingUpdatedAt: day.meta.updatedAt,
          });
        } else {
          imported.push(createDateSummary(day));
        }
        continue;
      }

      if (existing && options.mode === "copy") {
        const copy = createBackupCopyDay(day);
        this.days.set(copy.date, copy);
        imported.push(createDateSummary(copy));
        continue;
      }

      if (existing && options.mode !== "overwrite") {
        skipped.push({
          date: day.date,
          reason: "existing_day_requires_copy_or_overwrite",
          existingUpdatedAt: existing.meta.updatedAt,
          incomingUpdatedAt: day.meta.updatedAt,
        });
        continue;
      }

      this.days.set(day.date, cloneDayRecord(day));
      imported.push(createDateSummary(day));
    }

    return {
      mode: options.mode,
      imported,
      skipped,
      preview: options.mode === "preview",
    };
  }
}
