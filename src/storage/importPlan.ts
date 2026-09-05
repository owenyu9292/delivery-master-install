import { createBackupCopyDay } from "./backupImportExport";
import { assertDayRecord } from "./recordValidation";
import type { DayRecord } from "../domain/types";
import { cloneDayRecord, createDateSummary, type BackupFile, type ImportOptions, type ImportResult } from "./dayStore";

export interface ImportPlan {
  writes: DayRecord[];
  result: ImportResult;
}

export function buildImportPlan(backup: BackupFile, existingDays: readonly unknown[], mode: ImportOptions["mode"]): ImportPlan {
  const existing = new Map<string, unknown>();
  existingDays.forEach((day) => { const date = rawDate(day); if (date) existing.set(date, day); });
  const writes: DayRecord[] = [];
  const imported: ImportResult["imported"] = [];
  const skipped: ImportResult["skipped"] = [];
  const plannedDates = new Set(existing.keys());

  for (const day of backup.days) {
    const current = existing.get(day.date);
    if (mode === "preview") {
      if (current) skipped.push(conflict(day, current, "existing_day_preview"));
      else imported.push(createDateSummary(day));
      continue;
    }
    if (current && mode === "skip") {
      skipped.push(conflict(day, current, "existing_day_preserved"));
      continue;
    }
    if (current && mode === "copy") {
      if (!isValidDay(current)) {
        skipped.push(conflict(day, current, "existing_day_requires_copy_or_overwrite"));
        continue;
      }
      const copy = createBackupCopyDay(day);
      ensureNewDate(copy.date, plannedDates);
      plannedDates.add(copy.date);
      writes.push(copy);
      imported.push(createDateSummary(copy));
      continue;
    }
    if (current && mode !== "overwrite") {
      skipped.push(conflict(day, current, "existing_day_requires_copy_or_overwrite"));
      continue;
    }
    writes.push(cloneDayRecord(day));
    imported.push(createDateSummary(day));
  }

  return { writes, result: { mode, imported, skipped, preview: mode === "preview" } };
}

function conflict(day: DayRecord, current: unknown, reason: string) {
  const meta = isObject(current) && isObject(current.meta) ? current.meta : undefined;
  return { date: day.date, reason, existingUpdatedAt: typeof meta?.updatedAt === "string" ? meta.updatedAt : undefined, incomingUpdatedAt: day.meta.updatedAt };
}

function rawDate(value: unknown): string | undefined {
  return isObject(value) && typeof value.date === "string" ? value.date : undefined;
}

function isValidDay(value: unknown): value is DayRecord {
  try { assertDayRecord(value); return true; } catch { return false; }
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}

function ensureNewDate(date: string, plannedDates: Set<string>): void {
  if (plannedDates.has(date)) throw new Error(`가져오기 복사 날짜가 이미 존재합니다: ${date}`);
}
