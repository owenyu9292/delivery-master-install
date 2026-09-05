import {
  FIELD_APP_BACKUP_APP_ID,
  migrateFieldAppBackup,
} from "../domain/fieldAppMigration";
import { buildMigrationReport } from "../domain/legacyMigration";
import type { MigrationOptions, MigrationReport } from "../domain/legacyMigration";
import type { DayRecord } from "../domain/types";
import type {
  BackupFile,
  BackupScope,
  DayStore,
  ImportOptions,
  ImportResult,
} from "./dayStore";
import { assertBackupDaysHaveUniqueIds, assertDayRecord } from "./recordValidation";

export const PHONE_INSTALL_BACKUP_APP = "delivery-master-phone-install" as const;
export const PHONE_INSTALL_BACKUP_TYPE = "day-record-store" as const;
export const PHONE_INSTALL_BACKUP_FILENAME = "배송마스터_개발앱_백업_절대삭제금지.json";
export const FIELD_APP_BACKUP_APP = FIELD_APP_BACKUP_APP_ID;

export type BackupMode = ImportOptions["mode"];

export interface BackupExportRequest {
  scope?: BackupScope;
}

export interface BackupImportRequest {
  file: BackupFile;
  options?: ImportOptions;
}

export interface FieldAppBackupMigrationRequest {
  source: unknown;
  options?: ImportOptions;
  migration?: MigrationOptions;
}

export interface FieldAppBackupMigrationPreview {
  backup: BackupFile;
  report: MigrationReport;
}

export async function exportBackup(
  dayStore: DayStore,
  request: BackupExportRequest = {},
): Promise<BackupFile> {
  return normalizePhoneInstallBackup(await dayStore.createBackup(request.scope));
}

export async function previewBackupImport(
  dayStore: DayStore,
  file: BackupFile,
): Promise<ImportResult> {
  assertPhoneInstallBackup(file);
  return dayStore.importBackup(file, { mode: "preview" });
}

export async function copyBackupImport(
  dayStore: DayStore,
  file: BackupFile,
): Promise<ImportResult> {
  assertPhoneInstallBackup(file);
  return dayStore.importBackup(file, { mode: "copy" });
}

export async function overwriteBackupImport(
  dayStore: DayStore,
  file: BackupFile,
): Promise<ImportResult> {
  assertPhoneInstallBackup(file);
  return dayStore.importBackup(file, { mode: "overwrite" });
}

export async function runBackupImport(
  dayStore: DayStore,
  request: BackupImportRequest,
): Promise<ImportResult> {
  assertPhoneInstallBackup(request.file);
  return dayStore.importBackup(request.file, request.options);
}

export function buildFieldAppMigrationBackup(
  source: unknown,
  options: MigrationOptions = {},
): FieldAppBackupMigrationPreview {
  const migration = migrateFieldAppBackup(source, options);
  const backup: BackupFile = {
    schemaVersion: 1,
    app: PHONE_INSTALL_BACKUP_APP,
    backupType: PHONE_INSTALL_BACKUP_TYPE,
    exportedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    scope: { kind: "all" },
    days: migration.days,
  };

  return {
    backup,
    report: buildMigrationReport(migration),
  };
}

export async function importFieldAppBackupMigration(
  dayStore: DayStore,
  request: FieldAppBackupMigrationRequest,
): Promise<ImportResult> {
  const migration = buildFieldAppMigrationBackup(request.source, request.migration);
  return dayStore.importBackup(migration.backup, request.options || { mode: "preview" });
}

export function normalizePhoneInstallBackup(file: BackupFile): BackupFile {
  return {
    ...file,
    app: PHONE_INSTALL_BACKUP_APP,
    backupType: PHONE_INSTALL_BACKUP_TYPE,
  };
}

export function assertPhoneInstallBackup(file: unknown): asserts file is BackupFile {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new Error("백업 JSON 최상위 구조가 객체가 아닙니다.");
  }

  const candidate = file as { app?: string; backupType?: string; schemaVersion?: unknown; days?: unknown; corruptDays?: unknown };
  if (candidate.app === FIELD_APP_BACKUP_APP) {
    throw new Error("Field app backups must be imported through migration, not direct restore.");
  }
  if (candidate.app && candidate.app !== PHONE_INSTALL_BACKUP_APP) {
    throw new Error(`Unsupported backup app: ${candidate.app}`);
  }
  if (candidate.backupType && candidate.backupType !== PHONE_INSTALL_BACKUP_TYPE) {
    throw new Error(`Unsupported backup type: ${candidate.backupType}`);
  }
  if (candidate.corruptDays !== undefined) {
    throw new Error("raw corrupt entries are not directly restorable");
  }
  if (candidate.schemaVersion !== 1) {
    throw new Error("지원하지 않는 백업 스키마입니다.");
  }
  if (!Array.isArray(candidate.days)) {
    throw new Error("백업 JSON에 날짜별 기록 배열이 없습니다.");
  }

  const seenDates = new Set<string>();
  candidate.days.forEach((day, index) => {
    assertBackupDayRecord(day, index);
    if (seenDates.has(day.date)) {
      throw new Error(`백업 JSON에 중복 날짜가 있습니다: ${day.date}`);
    }
    seenDates.add(day.date);
  });
  assertBackupDaysHaveUniqueIds(candidate.days);
}

function assertBackupDayRecord(day: unknown, index: number): asserts day is DayRecord {
  assertDayRecord(day, `backup day ${index + 1}`);
  return;
  if (!day || typeof day !== "object" || Array.isArray(day)) {
    throw new Error(`백업 ${index + 1}번째 날짜 기록이 객체가 아닙니다.`);
  }
  const record = day as DayRecord;
  if (record.schemaVersion !== 1 || typeof record.id !== "string") {
    throw new Error(`백업 ${index + 1}번째 날짜 기록의 기본 정보가 손상됐습니다.`);
  }
  if (typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}(?:__copy_\d{14})?$/.test(record.date)) {
    throw new Error(`백업 ${index + 1}번째 날짜 형식이 올바르지 않습니다.`);
  }
  if (!Array.isArray(record.timeline) || !Array.isArray(record.zones)
    || !Array.isArray(record.helpers) || !Array.isArray(record.adjustments)) {
    throw new Error(`백업 ${record.date}의 기록 배열이 손상됐습니다.`);
  }
  if (!record.meta || typeof record.meta !== "object"
    || typeof record.meta.createdAt !== "string" || typeof record.meta.updatedAt !== "string"
    || typeof record.meta.recoveryStatus !== "string") {
    throw new Error(`백업 ${record.date}의 메타 정보가 손상됐습니다.`);
  }
}

export function createBackupCopyDay(day: DayRecord): DayRecord {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const copyDate = `${day.date}__copy_${timestamp}`;

  return {
    ...structuredCloneDay(day),
    id: `${day.id}__copy_${timestamp}`,
    date: copyDate,
    meta: {
      ...day.meta,
      updatedAt: new Date().toISOString(),
      recoveryStatus: "needsReview",
    },
  };
}

function structuredCloneDay(day: DayRecord): DayRecord {
  if (typeof structuredClone === "function") {
    return structuredClone(day);
  }

  return JSON.parse(JSON.stringify(day)) as DayRecord;
}
