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
  const candidate = file as { app?: string; backupType?: string };
  if (candidate.app === FIELD_APP_BACKUP_APP) {
    throw new Error("Field app backups must be imported through migration, not direct restore.");
  }

  if (candidate.app && candidate.app !== PHONE_INSTALL_BACKUP_APP) {
    throw new Error(`Unsupported backup app: ${candidate.app}`);
  }

  if (candidate.backupType && candidate.backupType !== PHONE_INSTALL_BACKUP_TYPE) {
    throw new Error(`Unsupported backup type: ${candidate.backupType}`);
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
