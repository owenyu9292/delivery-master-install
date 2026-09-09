import type { DayRecord, TimelineEvent, ZoneRecord } from "./types";
import { sortTimeline } from "./eventTimeline";
import { getZoneKind } from "./zoneIdentity";

const CLEANUP_THRESHOLD_MS = 40 * 60 * 1000;
const CLEANUP_DURATION_MS = 30 * 60 * 1000;

export interface AutomaticCleanupResult {
  dayRecord: DayRecord;
  correctedZoneIds: string[];
}

export function applyAutomaticCleanup(dayRecord: DayRecord, nowIso: string): AutomaticCleanupResult {
  const nowMs = Date.parse(nowIso);
  if (dayRecord.status !== "active" || !Number.isFinite(nowMs)) return unchanged(dayRecord);
  if (dayRecord.timeline.some((event) => event.type === "day_close")) return unchanged(dayRecord);

  const activeZones = dayRecord.zones.filter((zone) => {
    const events = eventsForZone(dayRecord, zone.id);
    return events.some((event) => event.type === "zone_start")
      && !events.some((event) => event.type === "zone_end");
  });
  if (activeZones.length !== 1) return unchanged(dayRecord);

  const zone = activeZones[0];
  if (!zone || getZoneKind(zone) !== "hils") return unchanged(dayRecord);
  const zoneEvents = eventsForZone(dayRecord, zone.id);
  if (zoneEvents.some((event) => !validEventTime(event.at, nowMs))) return unchanged(dayRecord);
  const sortingStarts = zoneEvents.filter((event) => event.type === "sorting_start");
  if (sortingStarts.length !== 1
    || zoneEvents.some((event) => event.type === "sorting_end")
    || zoneEvents.some((event) => event.type === "delivery_start")) return unchanged(dayRecord);

  const sortingStart = sortingStarts[0];
  const zoneStart = zoneEvents.find((event) => event.type === "zone_start");
  if (!sortingStart || !zoneStart || Date.parse(zoneStart.at) > Date.parse(sortingStart.at)) return unchanged(dayRecord);

  const sortingStartMs = Date.parse(sortingStart.at);
  if (nowMs - sortingStartMs < CLEANUP_THRESHOLD_MS) return unchanged(dayRecord);

  const sortingEndAt = new Date(sortingStartMs + CLEANUP_DURATION_MS).toISOString();
  const usedIds = new Set(dayRecord.timeline.map((event) => event.id));
  const sortingEndId = nextId(`auto-cleanup-${zone.id}-sorting-end`, usedIds);
  usedIds.add(sortingEndId);
  const deliveryStartId = nextId(`auto-cleanup-${zone.id}-delivery-start`, usedIds);
  const sortingEnd: TimelineEvent = {
    id: sortingEndId, type: "sorting_end", at: sortingEndAt, zoneId: zone.id,
    payload: { autoCleanup: true, autoCorrected: true },
    note: "Automatic cleanup correction", source: "recovery", createdAt: nowIso, updatedAt: nowIso,
  };
  const deliveryStart: TimelineEvent = {
    id: deliveryStartId, type: "delivery_start", at: sortingEndAt, zoneId: zone.id,
    payload: { autoCleanup: true, autoCorrected: true },
    note: "Automatic delivery start after cleanup", source: "recovery", createdAt: nowIso, updatedAt: nowIso,
  };
  const nextZone: ZoneRecord = {
    ...zone, sortingStartEventId: zone.sortingStartEventId ?? sortingStart.id,
    sortingEndEventId: sortingEndId, deliveryStartEventId: deliveryStartId,
  };
  return {
    dayRecord: {
      ...dayRecord,
      timeline: sortTimeline([...dayRecord.timeline, sortingEnd, deliveryStart]),
      zones: dayRecord.zones.map((candidate) => candidate.id === zone.id ? nextZone : candidate),
      adjustments: [...dayRecord.adjustments, {
        id: nextId(`auto-cleanup-${zone.id}-adjustment`, new Set(dayRecord.adjustments.map((adjustment) => adjustment.id))),
        eventId: sortingEndId, reason: "automatic_cleanup",
        note: `sorting_end and delivery_start inferred from ${sortingStart.id}`, createdAt: nowIso,
      }],
      meta: { ...dayRecord.meta, updatedAt: nowIso },
    },
    correctedZoneIds: [zone.id],
  };
}

function unchanged(dayRecord: DayRecord): AutomaticCleanupResult { return { dayRecord, correctedZoneIds: [] }; }
function eventsForZone(dayRecord: DayRecord, zoneId: string): TimelineEvent[] { return dayRecord.timeline.filter((event) => event.zoneId === zoneId); }
function validEventTime(at: string, nowMs: number): boolean { const time = Date.parse(at); return Number.isFinite(time) && time <= nowMs; }
function nextId(prefix: string, usedIds: Set<string>): string {
  if (!usedIds.has(prefix)) return prefix;
  let suffix = 2;
  while (usedIds.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}
