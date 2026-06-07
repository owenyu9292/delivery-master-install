import type {
  AdjustmentRecord,
  DayRecord,
  HelperRecord,
  TimelineEvent,
  ZoneRecord,
} from "./types";
import type {
  LegacyInspection,
  MigrationOptions,
  MigrationResult,
  MigrationStatus,
  MigrationWarning,
} from "./legacyMigration";

export const FIELD_APP_BACKUP_APP_ID = "delivery-master-season2-pwa" as const;
export const FIELD_APP_BACKUP_TYPE = "full-localStorage" as const;
export const PRESERVED_FIELD_APP_APP_ID = "delivery-master-season2" as const;

type FieldAppObject = Record<string, unknown>;

interface FieldDayItem {
  date: string;
  state?: FieldAppObject;
  logs?: unknown[];
  summary?: FieldAppObject;
  reportText?: string;
  savedAt?: string;
}

interface FieldZoneResult {
  zIdx?: number;
  name?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  cuStart?: string;
  cuEnd?: string;
  qty?: number;
  mijuData?: {
    a1?: number;
    a2?: number;
    a3?: number;
    aTotal?: number;
    bTotal?: number;
  } | null;
}

const FIELD_MIGRATION_APP_VERSION = "0.0.0-field-app-migration";

export function isFieldAppBackup(source: unknown): boolean {
  if (Array.isArray(source)) {
    return source.some((item) => Boolean(normalizeFieldDayItem(item)));
  }

  const obj = toObject(source);
  if (!obj) {
    return false;
  }

  return obj.app === FIELD_APP_BACKUP_APP_ID
    || obj.app === PRESERVED_FIELD_APP_APP_ID
    || obj.backupType === FIELD_APP_BACKUP_TYPE
    || Array.isArray(obj.details)
    || Boolean(toObject(obj.days))
    || Boolean(toObject(obj.summaries))
    || Boolean(normalizeFieldDayItem(obj));
}

export function migrateFieldAppBackup(
  source: unknown,
  options: MigrationOptions = {},
): MigrationResult {
  const warnings: MigrationWarning[] = [];
  const statusCounts = createStatusCounts();
  const inspection = inspectFieldAppBackup(source);

  if (!isFieldAppBackup(source)) {
    statusCounts.failed = 1;
    warnings.push({
      code: "not_field_app_backup",
      message: "Source is not a Season2 PWA field app backup.",
    });
    return {
      days: [],
      inspection,
      warnings,
      statusCounts,
    };
  }

  const days: DayRecord[] = [];
  for (const item of collectFieldDayItems(source)) {
    const result = migrateFieldDayItem(item, options);
    statusCounts[result.status] += 1;
    warnings.push(...result.warnings);
    days.push(result.day);
  }

  if (days.length === 0) {
    statusCounts.failed = 1;
    warnings.push({
      code: "no_field_days",
      message: "Field app backup did not contain recognizable day records.",
    });
  }

  return {
    days,
    inspection,
    warnings,
    statusCounts,
  };
}

export function inspectFieldAppBackup(source: unknown): LegacyInspection {
  const items = collectFieldDayItems(source);
  const detectedKinds = new Set<string>();
  const dates = new Set<string>();
  const issues: string[] = [];

  if (isFieldAppBackup(source)) {
    detectedKinds.add("fieldAppBackup");
  }
  if (Array.isArray(source)) {
    detectedKinds.add("fieldArrayBackup");
  }
  const sourceObj = toObject(source);
  if (sourceObj?.app === PRESERVED_FIELD_APP_APP_ID) {
    detectedKinds.add("preservedFieldAppBackup");
  }

  for (const item of items) {
    dates.add(item.date);
    if (item.state) {
      detectedKinds.add("fieldState");
    }
    if (Array.isArray(item.logs)) {
      detectedKinds.add("fieldLogs");
    }
    if (item.reportText) {
      detectedKinds.add("fieldReportText");
    }
  }

  if (items.length === 0) {
    issues.push("no_field_days");
  }

  return {
    candidateCount: items.length,
    detectedKinds: Array.from(detectedKinds),
    dates: Array.from(dates).sort(),
    confidence: items.length > 0 ? 0.88 : 0,
    issues,
  };
}

function migrateFieldDayItem(
  item: FieldDayItem,
  options: MigrationOptions,
): { day: DayRecord; status: MigrationStatus; warnings: MigrationWarning[] } {
  const now = new Date().toISOString();
  const warnings: MigrationWarning[] = [];
  const state = item.state || {};
  const events: TimelineEvent[] = [];
  const zones: ZoneRecord[] = [];
  const adjustments: AdjustmentRecord[] = [];
  const helpers: HelperRecord[] = [];

  pushEvent(events, {
    id: eventId(item.date, "depart", 1),
    type: "depart_jinjeop",
    at: normalizeAt(state.departTime, item.date, "08:00"),
    note: "Migrated from field app depart time",
  });

  pushEvent(events, {
    id: eventId(item.date, "arrive", 1),
    type: "arrive_cheongnyangni",
    at: normalizeAt(state.arriveTime, item.date, "09:00"),
    note: "Migrated from field app arrive time",
  });

  const results = Array.isArray(state.results)
    ? state.results
      .map((value) => toFieldZoneResult(value))
      .filter((result): result is FieldZoneResult => Boolean(result))
    : [];

  if (results.length === 0) {
    warnings.push({
      code: "field_day_missing_results",
      message: "Field app day has no structured zone results.",
      date: item.date,
      kind: "fieldAppBackup",
    });
  }

  results.forEach((result, index) => {
    const order = Number.isFinite(result.zIdx) ? Number(result.zIdx) + 1 : index + 1;
    const name = result.name || "zone-" + order;
    const zoneId = "zone-" + order + "-" + safeId(name);
    const startId = eventId(item.date, "zone-start", order);
    const sortingStartId = result.cuStart ? eventId(item.date, "sorting-start", order) : undefined;
    const sortingEndId = result.cuEnd ? eventId(item.date, "sorting-end", order) : undefined;
    const endId = eventId(item.date, "zone-end", order);
    const qty = numberOrZero(result.qty);
    const mijuA = result.mijuData?.aTotal ?? sumMijuA(result.mijuData);
    const mijuB = result.mijuData?.bTotal;
    const mijuPayload =
      mijuA !== undefined || mijuB !== undefined
        ? {
            aTotal: numberOrZero(mijuA),
            bTotal: numberOrZero(mijuB),
            restTotal: numberOrZero(mijuB),
            detailMode: true,
          }
        : {};

    pushEvent(events, {
      id: startId,
      type: "zone_start",
      at: normalizeAt(result.startTime, item.date, "09:00"),
      zoneId,
      payload: {
        zoneName: name,
        order,
        sourceType: result.type,
        mijuA,
        mijuB,
      },
      note: "Migrated from field app zone start",
    });

    if (sortingStartId) {
      pushEvent(events, {
        id: sortingStartId,
        type: "sorting_start",
        at: normalizeAt(result.cuStart, item.date, "09:00"),
        zoneId,
        note: "Migrated from field app sorting start",
      });
    }

    if (sortingEndId) {
      pushEvent(events, {
        id: sortingEndId,
        type: "sorting_end",
        at: normalizeAt(result.cuEnd, item.date, "09:00"),
        zoneId,
        note: "Migrated from field app sorting end",
      });
    }

    pushEvent(events, {
      id: endId,
      type: "zone_end",
      at: normalizeAt(result.endTime, item.date, "18:00"),
      zoneId,
      payload: {
        total: qty,
        delivered: qty,
        failed: 0,
        extra: 0,
        sourceType: result.type,
        ...mijuPayload,
      },
      note: "Migrated from field app zone close",
    });

    zones.push({
      id: zoneId,
      name,
      order,
      startEventId: startId,
      sortingStartEventId: sortingStartId,
      sortingEndEventId: sortingEndId,
      endEventId: endId,
      counts: {
        total: qty,
        delivered: qty,
        failed: 0,
        extra: 0,
      },
      countsSourceEventIds: [endId],
      countsCalculatedAt: normalizeAt(result.endTime, item.date, "18:00"),
    });
  });

  const fieldEvents = Array.isArray(state.events) ? state.events : [];
  fieldEvents.forEach((value, index) => {
    const obj = toObject(value);
    if (!obj) {
      return;
    }
    pushEvent(events, {
      id: eventId(item.date, "field-event", index + 1),
      type: "incident",
      at: normalizeAt(obj.at || obj.time || obj.timestamp, item.date, "12:00"),
      zoneId: zoneIdFromIndex(zones, obj.zIdx),
      payload: {
        title: stringOr(obj.title, "Field app event"),
        detail: stringOr(obj.detail, undefined),
      },
      note: stringOr(obj.title, "Migrated field app event"),
    });
  });

  const closeAt = normalizeAt(state.finishTime || item.savedAt, item.date, "18:00");
  pushEvent(events, {
    id: eventId(item.date, "day-close", 1),
    type: "day_close",
    at: closeAt,
    note: "Migrated from field app finish time",
  });

  const status: MigrationStatus = warnings.length > 0 ? "needsReview" : "complete";
  const day: DayRecord = {
    schemaVersion: 1,
    id: "day-" + safeId(item.date),
    date: item.date,
    status: status === "complete" ? "closed" : "reviewNeeded",
    timeline: events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)),
    zones: zones.sort((a, b) => a.order - b.order),
    helpers,
    adjustments,
    meta: {
      createdAt: now,
      updatedAt: now,
      deviceId: options.deviceId,
      appVersion: options.appVersion || FIELD_MIGRATION_APP_VERSION,
      migrationSource: "fieldAppBackup",
      recoveryStatus: status === "complete" ? "complete" : "needsReview",
    },
  };

  return { day, status, warnings };
}

function collectFieldDayItems(source: unknown): FieldDayItem[] {
  if (Array.isArray(source)) {
    return mergeFieldDayItems(source);
  }

  const obj = toObject(source);
  if (!obj) {
    return [];
  }

  const byDate = new Map<string, FieldDayItem>();
  const add = (candidate: unknown) => {
    const item = normalizeFieldDayItem(candidate);
    if (!item) {
      return;
    }
    const existing = byDate.get(item.date);
    if (!existing || fieldDayScore(item) >= fieldDayScore(existing)) {
      byDate.set(item.date, item);
    }
  };

  if (Array.isArray(obj.details)) {
    obj.details.forEach(add);
  }

  if (Array.isArray(obj.days)) {
    obj.days.forEach(add);
  } else {
    const days = toObject(obj.days);
    if (days) {
      Object.values(days).forEach(add);
    }
  }

  const summaries = toObject(obj.summaries);
  if (summaries) {
    Object.values(summaries).forEach(add);
  }

  if (toObject(obj.state) || toObject(obj.zones)) {
    add(obj);
  }

  const days = toObject(obj.days);
  if (days && !Array.isArray(obj.days)) {
    Object.values(days).forEach(add);
  }

  add(obj.currentState);

  const storageItems = toObject(obj.storageItems) || toObject(obj.storage);
  if (storageItems) {
    for (const [key, value] of Object.entries(storageItems)) {
      const cleanKey = key.startsWith("dm2_") ? key.slice(4) : key;
      if (!cleanKey.startsWith("report_")) {
        continue;
      }
      add(parseMaybeJson(value));
    }
  }

  const logsByDate = toObject(obj.logsByDate);
  if (logsByDate) {
    for (const [date, logs] of Object.entries(logsByDate)) {
      const existing = byDate.get(date);
      if (existing && !existing.logs && Array.isArray(logs)) {
        byDate.set(date, { ...existing, logs });
      }
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function mergeFieldDayItems(candidates: unknown[]): FieldDayItem[] {
  const byDate = new Map<string, FieldDayItem>();
  for (const candidate of candidates) {
    const item = normalizeFieldDayItem(candidate);
    if (!item) {
      continue;
    }
    const existing = byDate.get(item.date);
    if (!existing || fieldDayScore(item) >= fieldDayScore(existing)) {
      byDate.set(item.date, item);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeFieldDayItem(value: unknown): FieldDayItem | null {
  const parsed = parseMaybeJson(value);
  const obj = toObject(parsed);
  if (!obj) {
    return null;
  }
  const date = stringOr(obj.date, undefined);
  if (!date) {
    return null;
  }
  const summary = toObject(obj.summary) || (toObject(obj.zones) ? obj : undefined);
  const state = toObject(obj.state) || buildStateFromSummary(date, summary);
  return {
    date,
    state,
    logs: Array.isArray(obj.logs) ? obj.logs : undefined,
    summary,
    reportText: stringOr(obj.reportText, undefined),
    savedAt: stringOr(obj.savedAt, undefined),
  };
}

function buildStateFromSummary(date: string, summary: FieldAppObject | undefined): FieldAppObject | undefined {
  const zones = toObject(summary?.zones);
  if (!zones) {
    return undefined;
  }

  const results = Object.entries(zones).map(([name, value], index) => {
    const zone = toObject(value) || {};
    return {
      zIdx: index,
      name,
      type: stringOr(zone.type, index === 0 ? "miju" : "hils"),
      startTime: `${date}T00:00:00`,
      endTime: `${date}T00:00:00`,
      qty: numberOr(zone.qty, 0),
      mijuData: toObject(zone.mijuData),
    };
  });

  return {
    phase: "finished",
    departTime: `${date}T00:00:00`,
    arriveTime: `${date}T00:00:00`,
    results,
    events: [],
    helpers: [],
    logs: [],
    finishTime: `${date}T00:00:00`,
  };
}

function toFieldZoneResult(value: unknown): FieldZoneResult | null {
  const obj = toObject(value);
  if (!obj) {
    return null;
  }
  return {
    zIdx: numberOr(obj.zIdx, undefined),
    name: stringOr(obj.name, undefined),
    type: stringOr(obj.type, undefined),
    startTime: stringOr(obj.startTime, undefined),
    endTime: stringOr(obj.endTime, undefined),
    cuStart: stringOr(obj.cuStart, undefined),
    cuEnd: stringOr(obj.cuEnd, undefined),
    qty: numberOr(obj.qty, undefined),
    mijuData: toObject(obj.mijuData) as FieldZoneResult["mijuData"],
  };
}

function pushEvent(events: TimelineEvent[], input: Omit<TimelineEvent, "source" | "createdAt" | "updatedAt">): void {
  events.push({
    ...input,
    source: "migration",
    createdAt: input.at,
    updatedAt: input.at,
  });
}

function fieldDayScore(item: FieldDayItem): number {
  let score = 0;
  if (item.state) score += 10;
  if (Array.isArray(item.state?.results)) score += 20;
  if (Array.isArray(item.logs)) score += 5;
  if (item.reportText) score += 1;
  return score;
}

function createStatusCounts(): Record<MigrationStatus, number> {
  return {
    complete: 0,
    partial: 0,
    textOnly: 0,
    needsReview: 0,
    failed: 0,
  };
}

function normalizeAt(value: unknown, date: string, fallbackTime: string): string {
  const raw = stringOr(value, undefined);
  if (!raw) {
    return `${date}T${fallbackTime}:00+09:00`;
  }
  if (/^\d{2}:\d{2}$/.test(raw)) {
    return `${date}T${raw}:00+09:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return raw;
  }
  return `${date}T${fallbackTime}:00+09:00`;
}

function eventId(date: string, kind: string, index: number): string {
  return `field-${safeId(date)}-${kind}-${index}`;
}

function zoneIdFromIndex(zones: ZoneRecord[], zIdx: unknown): string | undefined {
  const index = numberOr(zIdx, undefined);
  if (index === undefined) {
    return undefined;
  }
  return zones.find((zone) => zone.order === index + 1)?.id;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toObject(value: unknown): FieldAppObject | null {
  return value && typeof value === "object" ? (value as FieldAppObject) : null;
}

function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrZero(value: unknown): number {
  return numberOr(value, 0) || 0;
}

function sumMijuA(value: FieldZoneResult["mijuData"]): number | undefined {
  if (!value) {
    return undefined;
  }
  const sum = (value.a1 || 0) + (value.a2 || 0) + (value.a3 || 0);
  return sum > 0 ? sum : undefined;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "") || "field";
}
