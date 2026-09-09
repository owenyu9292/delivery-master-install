import assert from "node:assert/strict";
import { calculateDay } from "../src/domain/deliveryCalc";
import { buildDailyReport } from "../src/domain/reportBuilder";
import type { DayRecord, ZoneRecord } from "../src/domain/types";
import { getZoneKind } from "../src/domain/zoneIdentity";
import { buildWeeklyStatsScreen } from "../src/ui/uiScreens";

const zoneKinds = ["miju", "hils", "alt", "custom"] as const;
const at = (minutes: number): string => `2026-09-09T${String(8 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+09:00`;

function zone(id: string, name: string, order: number, kind?: ZoneRecord["kind"]): ZoneRecord {
  return { id, name, order, ...(kind ? { kind } : {}) };
}

function dayRecord(zones: ZoneRecord[], events: DayRecord["timeline"]): DayRecord {
  return {
    schemaVersion: 1,
    id: "zone-identity-test",
    date: "2026-09-09",
    status: "closed",
    timeline: events,
    zones,
    helpers: [],
    adjustments: [],
    meta: { createdAt: at(0), updatedAt: at(180), recoveryStatus: "none" },
  };
}

function event(
  id: string,
  type: DayRecord["timeline"][number]["type"],
  minute: number,
  zoneId?: string,
  payload?: Record<string, unknown>,
) {
  return { id, type, at: at(minute), zoneId, payload, source: "manual" as const, createdAt: at(minute), updatedAt: at(minute) };
}

function completedZone(zoneId: string, start: number, delivered: number) {
  return [
    event(`${zoneId}-start`, "zone_start", start, zoneId),
    event(`${zoneId}-delivery`, "delivery_start", start + 5, zoneId),
    event(`${zoneId}-end`, "zone_end", start + 65, zoneId, { total: delivered, delivered }),
  ];
}

assert.equal(getZoneKind(zone("miju-2", "미주 반복", 1, "custom")), "custom");
assert.equal(getZoneKind(zone("alt-1", "미주", 1, "miju")), "miju");
assert.equal(getZoneKind(zone("miju", "대체배송", 1, "alt")), "alt");
assert.equal(getZoneKind(zone("miju-legacy", "미주 반복", 1)), "miju");
assert.equal(getZoneKind(zone("hils-legacy", "힐스테이트", 1)), "hils");
assert.equal(getZoneKind(zone("alt-legacy", "기타명", 1)), "alt");
assert.equal(getZoneKind(zone("legacy", "대체배송지", 1)), "alt");
assert.equal(getZoneKind(zone("custom-legacy", "사용자 구역", 1)), "custom");
assert.equal(getZoneKind(zone("other", "기타명", 1)), "custom");
for (const sourceKind of zoneKinds) {
  for (const targetKind of zoneKinds) {
    const pair = zone(`visit-${sourceKind}-${targetKind}`, "반복 방문 이름", 1, targetKind);
    assert.equal(getZoneKind(pair), targetKind, `${sourceKind}->${targetKind} kind round trip`);
  }
}
assert.equal(
  getZoneKind({ id: "alt-invalid", name: "기타명", kind: "invalid" as never }),
  "alt",
  "invalid kind falls back to legacy alt id",
);
assert.equal(
  getZoneKind({ id: "custom-invalid", name: "미주", kind: "invalid" as never }),
  "miju",
  "invalid kind falls back to legacy miju name",
);
assert.equal(
  getZoneKind({ id: "custom-invalid", name: "기타명", kind: "invalid" as never }),
  "custom",
  "invalid kind falls back to legacy custom",
);

const repeatedNameZones = zoneKinds.map((kind, index) => zone(`stable-id-${index}`, "같은 이름", index + 1, kind));
assert.deepEqual(repeatedNameZones.map(getZoneKind), [...zoneKinds], "same names do not merge or change explicit classifications");

const paidZone = zone("miju-paid", "미주", 1, "miju");
const paidDay = dayRecord(
  [paidZone],
  [
    ...completedZone(paidZone.id, 10, 100),
    event("free-helper", "helper_add", 75, paidZone.id, { helperKind: "free_received", quantity: 20, sourceZoneId: paidZone.id }),
    event("paid-helper", "helper_add", 80, paidZone.id, { helperKind: "paid_received", quantity: 10, sourceZoneId: paidZone.id }),
  ],
);
const paidCalculation = calculateDay(paidDay);
assert.equal(paidCalculation.zones[0]?.efficiencyCount, 80, "free helper quantity remains excluded from zone efficiency");
assert.equal(paidCalculation.totals.efficiencyCount, 80, "paid zone helper does not double-count while free helper stays excluded");

const renamedAlt = zone("alt-legacy-id", "이름만 미주", 1, "miju");
const renamedMiju = zone("miju", "이름만 대체배송", 2, "alt");
const mixedDay = dayRecord(
  [renamedAlt, renamedMiju],
  [...completedZone(renamedAlt.id, 10, 40), ...completedZone(renamedMiju.id, 90, 60)],
);
const mixedCalculation = calculateDay(mixedDay);
const mixedReport = buildDailyReport(mixedDay, mixedCalculation);
assert.match(mixedReport.text, /A구간\(1,2,3동\)/, "explicit miju kind keeps A/B detail despite alt-like id");
assert.match(mixedReport.text, /정규 효율 \(대체배송 제외\)/);

const stats = buildWeeklyStatsScreen([mixedDay], "2026-W37");
const statsQuantities = Object.fromEntries(stats.quantityComparison.buckets.map((bucket) => [bucket.key, bucket.quantity]));
assert.equal(statsQuantities.miju, 40, "stats follow explicit miju kind");
assert.equal(statsQuantities.alternate, 60, "stats exclude explicit alt from miju despite miju id");

const customZone = zone("custom-legacy", "기타명", 1);
const customDay = dayRecord([customZone], completedZone(customZone.id, 10, 60));
const customReport = buildDailyReport(customDay, calculateDay(customDay));
assert.match(customReport.text, /정규 효율 \(대체배송 제외\)\]\n  시간당 60개/, "legacy custom zones remain in regular efficiency");

const startedZone = zone("started-miju", "실제 미주", 1, "miju");
const plannedZone = zone("planned-custom", "예정 구역", 2, "custom");
const startedOnlyDay = dayRecord([startedZone], completedZone(startedZone.id, 10, 60));
const plannedClosedDay = dayRecord(
  [plannedZone, startedZone],
  completedZone(startedZone.id, 10, 60),
);
const startedOnlyReport = buildDailyReport(startedOnlyDay, calculateDay(startedOnlyDay));
const plannedClosedReport = buildDailyReport(plannedClosedDay, calculateDay(plannedClosedDay));
assert.equal(plannedClosedReport.text.includes("예정 구역"), false, "unstarted planned zone is absent from report details");
assert.equal(plannedClosedReport.text.match(/총 배송 수량:.*\n/)?.[0], startedOnlyReport.text.match(/총 배송 수량:.*\n/)?.[0], "planned zone does not change report total");
assert.equal(
  plannedClosedReport.text.match(/정규 효율 \(대체배송 제외\)\]\n.*\n/)?.[0],
  startedOnlyReport.text.match(/정규 효율 \(대체배송 제외\)\]\n.*\n/)?.[0],
  "planned zone does not change regular efficiency",
);
assert.equal(plannedClosedReport.warnings.some((warning) => warning.zoneId === plannedZone.id), false, "unstarted planned zone has no report warning");

const incompleteZone = zone("incomplete-hils", "미완료 힐스", 1, "hils");
const incompleteDay = dayRecord([incompleteZone], [event("incomplete-start", "zone_start", 10, incompleteZone.id)]);
const incompleteReport = buildDailyReport(incompleteDay, calculateDay(incompleteDay));
assert.equal(incompleteReport.text.includes("미완료 힐스"), true, "started incomplete zone remains in report details");
assert.equal(
  incompleteReport.warnings.some((warning) => warning.code === "missing_calculation_event" && warning.zoneId === incompleteZone.id),
  true,
  "started incomplete zone keeps missing event warning",
);

const immutableBefore = JSON.stringify(customDay);
const parsedCustomDay = JSON.parse(JSON.stringify(customDay)) as DayRecord;
assert.equal(JSON.stringify(customDay), immutableBefore, "classification does not mutate the original record");
assert.deepEqual(
  parsedCustomDay.timeline.map((item) => ({ id: item.id, at: item.at, payload: item.payload })),
  customDay.timeline.map((item) => ({ id: item.id, at: item.at, payload: item.payload })),
  "event ids, timestamps, and quantities survive JSON round trip",
);
assert.equal(getZoneKind(parsedCustomDay.zones[0]), "custom", "kind fallback survives JSON round trip");
assert.equal(
  buildDailyReport(parsedCustomDay, calculateDay(parsedCustomDay)).text,
  customReport.text,
  "report classification survives JSON stringify/parse",
);

console.log("zone identity tests passed: explicit kind, repeated names/ids, legacy fallback, paid efficiency, report and stats");
