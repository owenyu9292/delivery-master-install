import type { DayRecord } from "../domain/types";

export interface DayStore {
  listDates(): Promise<DateSummary[]>;
  getDay(date: string): Promise<DayRecord | null>;
  saveDay(dayRecord: DayRecord): Promise<SaveResult>;
  resetAll(): Promise<ResetResult>;
  createBackup(scope?: BackupScope): Promise<BackupFile>;
  importBackup(file: BackupFile, options?: ImportOptions): Promise<ImportResult>;
}

export interface DateSummary {
  date: string;
  status: DayRecord["status"];
  eventCount: number;
  updatedAt: string;
  recoveryStatus: DayRecord["meta"]["recoveryStatus"];
}

export interface SaveResult {
  date: string;
  savedAt: string;
  created: boolean;
}

export interface ResetResult {
  clearedCount: number;
  resetAt: string;
}

export type BackupScope =
  | { kind: "all" }
  | { kind: "date"; date: string };

export interface BackupFile {
  schemaVersion: 1;
  app: "delivery-master-phone-install";
  backupType: "day-record-store";
  exportedAt: string;
  appVersion?: string;
  scope: BackupScope;
  days: DayRecord[];
}

export interface ImportOptions {
  mode: "preview" | "copy" | "overwrite";
}

export interface ImportResult {
  mode: ImportOptions["mode"];
  imported: DateSummary[];
  skipped: ImportConflict[];
  preview: boolean;
}

export interface ImportConflict {
  date: string;
  reason: string;
  existingUpdatedAt?: string;
  incomingUpdatedAt?: string;
}

export function createDateSummary(dayRecord: DayRecord): DateSummary {
  return {
    date: dayRecord.date,
    status: dayRecord.status,
    eventCount: dayRecord.timeline.length,
    updatedAt: dayRecord.meta.updatedAt,
    recoveryStatus: dayRecord.meta.recoveryStatus,
  };
}

export function cloneDayRecord(dayRecord: DayRecord): DayRecord {
  return structuredCloneFallback(dayRecord);
}

export function cloneBackupFile(backupFile: BackupFile): BackupFile {
  return structuredCloneFallback(backupFile);
}

function structuredCloneFallback<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
