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

const DEFAULT_DB_NAME = "delivery-master";
const DEFAULT_STORE_NAME = "dayRecords";
const DEFAULT_VERSION = 1;
export interface IndexedDbDayStoreOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
  appVersion?: string;
  indexedDb?: IDBFactory;
}

export class IndexedDbDayStore implements DayStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly version: number;
  private readonly appVersion: string;
  private readonly indexedDb: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbDayStoreOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.version = options.version ?? DEFAULT_VERSION;
    this.appVersion = options.appVersion ?? "0.0.0-prototype";
    this.indexedDb = options.indexedDb ?? getBrowserIndexedDb();
  }

  async listDates(): Promise<DateSummary[]> {
    const days = await this.getAllDays();

    return days
      .map(createDateSummary)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDay(date: string): Promise<DayRecord | null> {
    const db = await this.openDb();
    const day = await requestToPromise<DayRecord | undefined>(
      db.transaction(this.storeName, "readonly")
        .objectStore(this.storeName)
        .get(date),
    );

    return day ? cloneDayRecord(day) : null;
  }

  async saveDay(dayRecord: DayRecord): Promise<SaveResult> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    const existing = await requestToPromise<DayRecord | undefined>(
      store.get(dayRecord.date),
    );

    await requestToPromise(store.put(cloneDayRecord(dayRecord)));
    await transactionToPromise(tx);

    return {
      date: dayRecord.date,
      savedAt: new Date().toISOString(),
      created: !existing,
    };
  }

  async resetAll(): Promise<ResetResult> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    const existing = await requestToPromise<DayRecord[]>(store.getAll());

    await requestToPromise(store.clear());
    await transactionToPromise(tx);

    return {
      clearedCount: existing.length,
      resetAt: new Date().toISOString(),
    };
  }

  async createBackup(scope: BackupScope = { kind: "all" }): Promise<BackupFile> {
    const allDays = await this.getAllDays();
    const days = scope.kind === "all"
      ? allDays
      : allDays.filter((day) => day.date === scope.date);

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

  async importBackup(
    file: BackupFile,
    options: ImportOptions = { mode: "preview" },
  ): Promise<ImportResult> {
    assertPhoneInstallBackup(file);
    const backup = cloneBackupFile(file);
    const imported: DateSummary[] = [];
    const skipped: ImportResult["skipped"] = [];

    for (const day of backup.days) {
      const existing = await this.getDay(day.date);

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
        await this.saveDay(copy);
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

      await this.saveDay(day);
      imported.push(createDateSummary(day));
    }

    return {
      mode: options.mode,
      imported,
      skipped,
      preview: options.mode === "preview",
    };
  }

  private async getAllDays(): Promise<DayRecord[]> {
    const db = await this.openDb();
    const days = await requestToPromise<DayRecord[]>(
      db.transaction(this.storeName, "readonly")
        .objectStore(this.storeName)
        .getAll(),
    );

    return days.map(cloneDayRecord);
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase(
        this.indexedDb,
        this.dbName,
        this.storeName,
        this.version,
      );
    }

    return this.dbPromise;
  }
}

function openDatabase(
  indexedDb: IDBFactory,
  dbName: string,
  storeName: string,
  version: number,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(dbName, version);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "date" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      reject(new Error(`IndexedDB open blocked for ${dbName}`));
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function getBrowserIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this runtime.");
  }

  return indexedDB;
}
