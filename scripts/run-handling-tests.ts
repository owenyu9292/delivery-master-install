import assert from "node:assert/strict";
import { createEvent } from "../src/domain/eventTimeline";
import { calculateDay } from "../src/domain/deliveryCalc";
import {
  findHandlingEvent,
  isHandlingEvent,
  readHandlingMinutes,
  setHandlingMinutes,
} from "../src/domain/handlingTime";
import type { DayRecord, TimelineEvent } from "../src/domain/types";
import {
  assertPhoneInstallBackup,
  normalizePhoneInstallBackup,
} from "../src/storage/backupImportExport";
import type { BackupFile } from "../src/storage/dayStore";

const TIMES = {
  start: "2026-09-05T09:00:00+09:00",
  sortingStart: "2026-09-05T09:10:00+09:00",
  sortingEnd: "2026-09-05T09:30:00+09:00",
  end: "2026-09-05T11:00:00+09:00",
  close: "2026-09-05T11:00:00+09:00",
} as const;

function makeDay(options: {
  sorting?: boolean;
  otherIncident?: boolean;
  zones?: string[];
} = {}): DayRecord {
  const zoneIds = options.zones ?? ["hils-zone", "other-zone"];
  let day: DayRecord = {
    schemaVersion: 1,
    id: "day-handling-tests",
    date: "2026-09-05",
    status: "active",
    timeline: [],
    zones: zoneIds.map((id, index) => ({
      id,
      name: id === "hils-zone" ? "힐스" : id,
      order: index + 1,
      counts: { total: 100, delivered: 100, failed: 0, extra: 0 },
    })),
    helpers: [],
    adjustments: [],
    meta: {
      createdAt: TIMES.start,
      updatedAt: TIMES.start,
      recoveryStatus: "none",
    },
  };

  for (const [index, zoneId] of zoneIds.entries()) {
    const startId = `zone-start-${zoneId}`;
    const endId = `zone-end-${zoneId}`;
    day = createEvent(day, { id: startId, type: "zone_start", zoneId, at: TIMES.start });
    if (index === 0 && options.sorting) {
      day = createEvent(day, {
        id: `sorting-start-${zoneId}`,
        type: "sorting_start",
        zoneId,
        at: TIMES.sortingStart,
      });
      day = createEvent(day, {
        id: `sorting-end-${zoneId}`,
        type: "sorting_end",
        zoneId,
        at: TIMES.sortingEnd,
        payload: { total: 100 },
      });
    }
    day = createEvent(day, {
      id: endId,
      type: "zone_end",
      zoneId,
      at: TIMES.end,
      payload: { delivered: 100, total: 100, failed: 0, extra: 0 },
    });
    day = {
      ...day,
      zones: day.zones.map((zone) =>
        zone.id === zoneId
          ? {
              ...zone,
              startEventId: startId,
              endEventId: endId,
              ...(index === 0 && options.sorting
                ? {
                    sortingStartEventId: `sorting-start-${zoneId}`,
                    sortingEndEventId: `sorting-end-${zoneId}`,
                  }
                : {}),
            }
          : zone,
      ),
    };
  }

  if (options.otherIncident) {
    day = createEvent(day, {
      id: "ordinary-incident",
      type: "incident",
      zoneId: zoneIds[0],
      at: "2026-09-05T10:00:00+09:00",
      payload: { title: "일반 지연", minutes: 10 },
    });
  }
  return createEvent(day, { id: "day-close", type: "day_close", at: TIMES.close });
}

function handlingEvents(day: DayRecord, zoneId?: string): TimelineEvent[] {
  return day.timeline.filter((event) => isHandlingEvent(event) && (!zoneId || event.zoneId === zoneId));
}

function expectThrows(action: () => unknown, label: string): void {
  assert.throws(action, undefined, label);
}

const original = makeDay({ sorting: true });
const originalJson = JSON.stringify(original);
const withDefault = setHandlingMinutes(original, {
  zoneId: "hils-zone",
  minutes: 30,
  at: "2026-09-05T09:01:00+09:00",
});
const calculated = calculateDay(withDefault);
const hils = calculated.zones.find((zone) => zone.zoneId === "hils-zone");
assert.equal(hils?.deliveryMinutes, 70, "sorting 20 + handling 30 must leave 70 delivery minutes");
assert.equal(hils?.counts.total, 100);
assert.equal(hils?.counts.delivered, 100);
assert.equal(calculated.totals.totalElapsedMinutes, 120);
assert.equal(calculated.totals.totalCount, 200);
assert.equal(JSON.stringify(original), originalJson, "set must not mutate source input");

const firstEvent = findHandlingEvent(withDefault, "hils-zone");
assert(firstEvent);
assert.equal(readHandlingMinutes(firstEvent), 30);
assert.equal(firstEvent.payload?.kind, "handling_time");
assert.equal(firstEvent.payload?.title, "반품·선집화·상차");
assert.equal(firstEvent.payload?.affectsEfficiency, true);
assert.equal(firstEvent.payload?.scope, "zone:hils-zone");
assert.equal(handlingEvents(withDefault, "hils-zone").length, 1);

const edited = setHandlingMinutes(withDefault, { zoneId: "hils-zone", minutes: 45 });
const editedEvent = findHandlingEvent(edited, "hils-zone");
assert(editedEvent);
assert.equal(editedEvent.id, firstEvent.id);
assert.equal(editedEvent.at, firstEvent.at);
assert.equal(readHandlingMinutes(editedEvent), 45);
assert.equal(handlingEvents(edited, "hils-zone").length, 1);

const cancelled = setHandlingMinutes(edited, { zoneId: "hils-zone", minutes: 0 });
assert.equal(readHandlingMinutes(findHandlingEvent(cancelled, "hils-zone")), 0);
assert.equal(handlingEvents(cancelled, "hils-zone").length, 1, "zero keeps the trace");
const reapplied = setHandlingMinutes(cancelled, { zoneId: "hils-zone", minutes: 30 });
assert.equal(findHandlingEvent(reapplied, "hils-zone")?.id, firstEvent.id);
assert.equal(readHandlingMinutes(findHandlingEvent(reapplied, "hils-zone")), 30);

const customIdDay = makeDay({ sorting: false, zones: ["custom-hils", "non-hils"] });
const customWithHandling = setHandlingMinutes(customIdDay, { zoneId: "custom-hils", minutes: 30 });
assert.equal(customWithHandling.zones[0].id, "custom-hils");
assert.equal(customWithHandling.zones[1].id, "non-hils");
assert.equal(handlingEvents(customWithHandling, "custom-hils").length, 1);
assert.equal(handlingEvents(customWithHandling, "non-hils").length, 0);
const repeatedZones = setHandlingMinutes(customWithHandling, { zoneId: "non-hils", minutes: 15 });
assert.equal(handlingEvents(repeatedZones, "custom-hils").length, 1);
assert.equal(handlingEvents(repeatedZones, "non-hils").length, 1);
assert.equal(readHandlingMinutes(findHandlingEvent(repeatedZones, "non-hils")), 15);

for (const minutes of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5, 1000]) {
  expectThrows(
    () => setHandlingMinutes(original, { zoneId: "hils-zone", minutes }),
    `invalid minutes ${String(minutes)} must be rejected`,
  );
}
expectThrows(() => setHandlingMinutes(original, { zoneId: "missing-zone", minutes: 30 }), "unknown zone must be rejected");
const unstarted = makeDay({ zones: ["known-but-unstarted"] });
unstarted.zones = [{ id: "known-but-unstarted", name: "미시작", order: 1 }];
unstarted.timeline = unstarted.timeline.filter(
  (event) => !(event.zoneId === "known-but-unstarted" && event.type === "zone_start"),
);
expectThrows(() => setHandlingMinutes(unstarted, { zoneId: "known-but-unstarted", minutes: 30 }), "unstarted zone must be rejected");

const noSorting = calculateDay(setHandlingMinutes(makeDay({ sorting: false }), { zoneId: "hils-zone", minutes: 30 }));
assert.equal(noSorting.zones.find((zone) => zone.zoneId === "hils-zone")?.deliveryMinutes, 90);
const withOrdinaryIncident = calculateDay(
  setHandlingMinutes(makeDay({ sorting: true, otherIncident: true }), { zoneId: "hils-zone", minutes: 30 }),
);
assert.equal(withOrdinaryIncident.zones.find((zone) => zone.zoneId === "hils-zone")?.deliveryMinutes, 60);
const overRemaining = calculateDay(
  setHandlingMinutes(makeDay({ sorting: true }), { zoneId: "hils-zone", minutes: 999 }),
);
assert.equal(overRemaining.zones.find((zone) => zone.zoneId === "hils-zone")?.deliveryMinutes, 0);

const backup: BackupFile = normalizePhoneInstallBackup({
  schemaVersion: 1,
  app: "delivery-master-phone-install",
  backupType: "day-record-store",
  exportedAt: TIMES.start,
  scope: { kind: "all" },
  days: [reapplied],
});
const decoded = JSON.parse(JSON.stringify(backup)) as unknown;
assertPhoneInstallBackup(decoded);
assert.equal(readHandlingMinutes(findHandlingEvent(decoded.days[0], "hils-zone")), 30);
assert.equal(decoded.days[0].timeline.filter((event) => isHandlingEvent(event)).length, 1);

console.log("handling tests passed");
