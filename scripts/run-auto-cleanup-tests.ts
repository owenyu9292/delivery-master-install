import assert from "node:assert/strict";
import { applyAutomaticCleanup } from "../src/domain/autoCleanup";
import type { DayRecord, TimelineEvent, ZoneRecord } from "../src/domain/types";

const now = "2026-09-09T12:00:00.000Z";
function event(id: string, type: TimelineEvent["type"], at: string, zoneId?: string, payload?: Record<string, unknown>): TimelineEvent {
  return { id, type, at, zoneId, payload, source: "manual", createdAt: at, updatedAt: at };
}
function day(start = "2026-09-09T11:20:00.000Z", zone: Partial<ZoneRecord> = {}, extra: TimelineEvent[] = []): DayRecord {
  const z: ZoneRecord = { id: "hils-main", name: "Hils", order: 1, kind: "hils", ...zone };
  const parsedStart = Date.parse(start);
  const zoneStartAt = Number.isFinite(parsedStart) ? new Date(parsedStart - 5 * 60 * 1000).toISOString() : start;
  return {
    schemaVersion: 1, id: "auto-cleanup-test", date: "2026-09-09", status: "active",
    timeline: [event("zone-start", "zone_start", zoneStartAt, z.id), event("sort-start", "sorting_start", start, z.id), ...extra],
    zones: [z], helpers: [], adjustments: [],
    meta: { createdAt: zoneStartAt, updatedAt: zoneStartAt, recoveryStatus: "none" },
  };
}
function unchanged(input: DayRecord): void {
  const result = applyAutomaticCleanup(input, now);
  assert.deepEqual(result.dayRecord, input);
  assert.deepEqual(result.correctedZoneIds, []);
}

unchanged(day("2026-09-09T11:20:01.000Z"));
const corrected = applyAutomaticCleanup(day(), now);
assert.deepEqual(corrected.correctedZoneIds, ["hils-main"]);
assert.equal(corrected.dayRecord.timeline.find((e) => e.type === "sorting_end")?.at, "2026-09-09T11:50:00.000Z");
assert.equal(corrected.dayRecord.timeline.find((e) => e.type === "delivery_start")?.at, "2026-09-09T11:50:00.000Z");
assert.deepEqual(corrected.dayRecord.timeline.map((e) => e.type), ["zone_start", "sorting_start", "delivery_start", "sorting_end"]);
assert.equal(corrected.dayRecord.zones[0]?.sortingStartEventId, "sort-start");
assert.equal(corrected.dayRecord.zones[0]?.sortingEndEventId, "auto-cleanup-hils-main-sorting-end");
assert.equal(corrected.dayRecord.zones[0]?.deliveryStartEventId, "auto-cleanup-hils-main-delivery-start");
assert.equal(corrected.dayRecord.meta.updatedAt, now);
const sortingEndPayload = corrected.dayRecord.timeline.find((e) => e.type === "sorting_end")?.payload;
assert.equal(sortingEndPayload && "autoCleanup" in sortingEndPayload && sortingEndPayload.autoCleanup, true);
assert.equal(corrected.dayRecord.adjustments.length, 1);

const reopened = applyAutomaticCleanup(day("2026-09-09T10:00:00.000Z"), now);
assert.equal(reopened.dayRecord.timeline.find((e) => e.type === "sorting_end")?.at, "2026-09-09T10:30:00.000Z");
const repeated = applyAutomaticCleanup(reopened.dayRecord, now);
assert.deepEqual(repeated.dayRecord, reopened.dayRecord);
assert.deepEqual(repeated.correctedZoneIds, []);

const midnight = applyAutomaticCleanup(day("2026-09-08T23:40:00.000Z"), now);
assert.equal(midnight.dayRecord.timeline.find((e) => e.type === "sorting_end")?.at, "2026-09-09T00:10:00.000Z");

unchanged(day("2026-09-09T10:00:00.000Z", {}, [event("manual-delivery", "delivery_start", "2026-09-09T11:10:00.000Z", "hils-main")]));
unchanged(day("2026-09-09T10:00:00.000Z", {}, [event("manual-end", "sorting_end", "2026-09-09T10:15:00.000Z", "hils-main")]));
unchanged(day("2026-09-09T10:00:00.000Z", {}, [event("zone-end", "zone_end", "2026-09-09T11:00:00.000Z", "hils-main")]));
unchanged(day("2026-09-09T10:00:00.000Z", { kind: "miju" }));
unchanged(day("2026-09-09T10:00:00.000Z", { id: "delivery-zone", name: "Hils", kind: "custom" }));

const multipleActive = day("2026-09-09T10:00:00.000Z");
multipleActive.zones.push({ id: "other-zone", name: "Other", order: 2, kind: "custom" });
multipleActive.timeline.push(event("other-zone-start", "zone_start", "2026-09-09T09:55:00.000Z", "other-zone"));
unchanged(multipleActive);

const draft = day("2026-09-09T10:00:00.000Z");
draft.status = "draft";
unchanged(draft);
const dayClosed = day("2026-09-09T10:00:00.000Z");
dayClosed.timeline.push(event("day-close", "day_close", now, undefined));
unchanged(dayClosed);
unchanged(day("2026-09-09T12:01:00.000Z"));
unchanged(day("not-a-timestamp"));
unchanged(day("2026-09-09T10:00:00.000Z", {}, [event("bad-event", "incident", "not-a-timestamp", "hils-main")]));

const immutableInput = day("2026-09-09T10:00:00.000Z");
const before = structuredClone(immutableInput);
const quantityDay = day("2026-09-09T10:00:00.000Z", {}, [event("counts", "incident", "2026-09-09T10:30:00.000Z", "hils-main", { total: 10, delivered: 7, failed: 2, extra: 1 })]);
const quantityBefore = structuredClone(quantityDay);
const quantityResult = applyAutomaticCleanup(quantityDay, now);
assert.deepEqual(quantityResult.dayRecord.timeline.find((e) => e.id === "counts")?.payload, quantityBefore.timeline.find((e) => e.id === "counts")?.payload);
applyAutomaticCleanup(immutableInput, now);
assert.deepEqual(immutableInput, before);

console.log("auto cleanup tests passed: 18 cases");
