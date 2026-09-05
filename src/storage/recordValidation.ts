import type {
  AdjustmentRecord,
  DayRecord,
  EventSource,
  HelperRecord,
  RecoveryStatus,
  TimelineEvent,
  TimelineEventType,
  ZoneRecord,
} from "../domain/types";

const DAY_DATE = /^\d{4}-\d{2}-\d{2}(?:__copy_\d{14}(?:_\d+)?)?$/;
const EVENT_TYPES = new Set<TimelineEventType>([
  "depart_jinjeop",
  "arrive_cheongnyangni",
  "zone_start",
  "sorting_start",
  "sorting_end",
  "delivery_start",
  "zone_end",
  "helper_add",
  "incident",
  "day_close",
  "manual_adjust",
]);
const EVENT_SOURCES = new Set<EventSource>(["manual", "migration", "import", "recovery"]);
const STATUSES = new Set(["draft", "active", "closed", "reviewNeeded"]);
const RECOVERY_STATUSES = new Set<RecoveryStatus>([
  "none",
  "complete",
  "partial",
  "textOnly",
  "needsReview",
  "failed",
]);

export function assertDayRecord(value: unknown, label = "날짜 기록"): asserts value is DayRecord {
  if (!isObject(value) || Array.isArray(value)) fail(`${label}가 객체가 아닙니다.`);
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !nonEmptyString(record.id)) fail(`${label}의 기본 정보가 손상됐습니다.`);
  if (typeof record.date !== "string" || !DAY_DATE.test(record.date)) fail(`${label}의 날짜 형식이 올바르지 않습니다.`);
  if (!STATUSES.has(record.status as string)) fail(`${label}의 상태가 올바르지 않습니다.`);
  assertArray(record.timeline, `${label}.timeline`);
  (record.timeline as unknown[]).forEach((event, index) => assertTimelineEvent(event, `${label}.timeline[${index}]`));
  assertArray(record.zones, `${label}.zones`);
  (record.zones as unknown[]).forEach((zone, index) => assertZone(zone, `${label}.zones[${index}]`));
  assertArray(record.helpers, `${label}.helpers`);
  (record.helpers as unknown[]).forEach((helper, index) => assertHelper(helper, `${label}.helpers[${index}]`));
  assertArray(record.adjustments, `${label}.adjustments`);
  (record.adjustments as unknown[]).forEach((adjustment, index) => assertAdjustment(adjustment, `${label}.adjustments[${index}]`));
  assertMeta(record.meta, `${label}.meta`);
  assertUniqueIds(record, label);
  assertFiniteNumbers(record, label);
}

export function assertBackupDaysHaveUniqueIds(days: readonly DayRecord[]): void {
  const ids = new Set<string>();
  days.forEach((day, index) => {
    if (ids.has(day.id)) fail(`백업 ${index + 1}번째 날짜 기록의 id가 중복됐습니다: ${day.id}`);
    ids.add(day.id);
  });
}

function assertTimelineEvent(value: unknown, label: string): asserts value is TimelineEvent {
  if (isObject(value) && value.payload !== undefined && isObject(value.payload) && !Array.isArray(value.payload)) {
    assertKnownPayloadFields(value.payload, `${label}.payload`);
  }
  if (!isObject(value) || Array.isArray(value)
    || !nonEmptyString(value.id) || !EVENT_TYPES.has(value.type as TimelineEventType)
    || !nonEmptyString(value.at) || !EVENT_SOURCES.has(value.source as EventSource)
    || !nonEmptyString(value.createdAt) || !nonEmptyString(value.updatedAt)) {
    fail(`${label}가 손상됐습니다.`);
  }
  if (value.zoneId !== undefined && !nonEmptyString(value.zoneId)) fail(`${label}.zoneId가 손상됐습니다.`);
  if (value.note !== undefined && typeof value.note !== "string") fail(`${label}.note가 손상됐습니다.`);
  if (value.payload !== undefined && (!isObject(value.payload) || Array.isArray(value.payload))) fail(`${label}.payload가 손상됐습니다.`);
}

function assertZone(value: unknown, label: string): asserts value is ZoneRecord {
  if (!isObject(value) || Array.isArray(value) || !nonEmptyString(value.id)
    || typeof value.name !== "string" || typeof value.order !== "number" || !Number.isFinite(value.order)) {
    fail(`${label}가 손상됐습니다.`);
  }
  assertOptionalStringFields(value, ["startEventId", "sortingStartEventId", "sortingEndEventId", "deliveryStartEventId", "endEventId", "countsCalculatedAt", "memo"], label);
  if (value.counts !== undefined) {
    if (!isObject(value.counts) || Array.isArray(value.counts)) fail(`${label}.counts가 손상됐습니다.`);
    assertFiniteNumberFields(value.counts, ["total", "delivered", "failed", "extra"], `${label}.counts`);
  }
  if (value.countsSourceEventIds !== undefined) assertStringArray(value.countsSourceEventIds, `${label}.countsSourceEventIds`);
}

function assertHelper(value: unknown, label: string): asserts value is HelperRecord {
  if (!isObject(value) || Array.isArray(value) || !nonEmptyString(value.id) || typeof value.name !== "string") fail(`${label}가 손상됐습니다.`);
  assertStringArray(value.linkedEventIds, `${label}.linkedEventIds`);
  assertOptionalStringFields(value, ["memo", "kind"], label);
  if (value.quantity !== undefined && (typeof value.quantity !== "number" || !Number.isFinite(value.quantity))) fail(`${label}.quantity가 손상됐습니다.`);
  if (value.countsForEfficiency !== undefined && typeof value.countsForEfficiency !== "boolean") fail(`${label}.countsForEfficiency가 손상됐습니다.`);
}

function assertAdjustment(value: unknown, label: string): asserts value is AdjustmentRecord {
  if (!isObject(value) || Array.isArray(value) || !nonEmptyString(value.id) || !nonEmptyString(value.reason) || !nonEmptyString(value.createdAt)) fail(`${label}가 손상됐습니다.`);
  assertOptionalStringFields(value, ["eventId", "note"], label);
}

function assertMeta(value: unknown, label: string): void {
  if (!isObject(value) || Array.isArray(value) || !nonEmptyString(value.createdAt) || !nonEmptyString(value.updatedAt)
    || !RECOVERY_STATUSES.has(value.recoveryStatus as RecoveryStatus)) fail(`${label}가 손상됐습니다.`);
  assertOptionalStringFields(value, ["deviceId", "appVersion", "migrationSource"], label);
}

function assertUniqueIds(record: Record<string, unknown>, label: string): void {
  for (const field of ["timeline", "zones", "helpers", "adjustments"] as const) {
    const ids = new Set<string>();
    for (const entry of record[field] as Array<Record<string, unknown>>) {
      if (ids.has(entry.id as string)) fail(`${label}.${field}에 id가 중복됐습니다: ${entry.id}`);
      ids.add(entry.id as string);
    }
  }
}

function assertFiniteNumbers(value: unknown, label: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) fail(`${label}에 유한하지 않은 숫자가 있습니다.`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(item, `${label}[${index}]`));
  } else if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) => assertFiniteNumbers(item, `${label}.${key}`));
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(`기록 배열이 손상됐습니다: ${label}`);
}

function assertKnownPayloadFields(payload: Record<string, unknown>, label: string): void {
  const numericFields = ["total", "delivered", "failed", "extra", "quantity", "minutes", "order", "aTotal", "bTotal", "restTotal", "mijuA", "mijuB", "miju1", "miju2", "miju3", "mijuRest"];
  numericFields.forEach((field) => {
    if (payload[field] !== undefined) assertCompatibleNumber(payload[field], `${label}.${field}`);
  });
  ["helperId", "name", "reason", "title", "detail", "zoneName", "field", "targetEventId", "sourceZoneId"]
    .forEach((field) => assertOptionalPrimitive(payload, field, "string", label));
  ["countsForEfficiency", "unpaid", "affectsEfficiency"]
    .forEach((field) => assertOptionalPrimitive(payload, field, "boolean", label));
  if (payload.action !== undefined && !["add", "remove", "update"].includes(payload.action as string)) fail(`${label}.action is invalid.`);
  if (payload.helperKind !== undefined && !["free_received", "paid_received", "unpaid_given"].includes(payload.helperKind as string)) fail(`${label}.helperKind is invalid.`);
  if (payload.severity !== undefined && !["info", "warning", "critical"].includes(payload.severity as string)) fail(`${label}.severity is invalid.`);
}

function assertCompatibleNumber(value: unknown, label: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} is invalid.`);
    return;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return;
  fail(`${label} is invalid.`);
}

function assertOptionalPrimitive(value: Record<string, unknown>, field: string, type: "string" | "boolean", label: string): void {
  if (value[field] !== undefined && typeof value[field] !== type) fail(`${label}.${field} is invalid.`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail(`${label}가 손상됐습니다.`);
}

function assertOptionalStringFields(value: Record<string, unknown>, fields: string[], label: string): void {
  fields.forEach((field) => {
    if (value[field] !== undefined && typeof value[field] !== "string") fail(`${label}.${field}가 손상됐습니다.`);
  });
}

function assertFiniteNumberFields(value: Record<string, unknown>, fields: string[], label: string): void {
  fields.forEach((field) => {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field])) fail(`${label}.${field}가 손상됐습니다.`);
  });
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function fail(message: string): never {
  throw new Error(message);
}
