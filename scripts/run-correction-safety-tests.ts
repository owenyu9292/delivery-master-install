import assert from "node:assert/strict";
import { setHandlingMinutes } from "../src/domain/handlingTime";
import { calculateDay } from "../src/domain/deliveryCalc";
import { buildDailyReport } from "../src/domain/reportBuilder";
import { applyCompletedZoneEdit } from "../src/domain/zoneEdit";
import type { DayRecord, TimelineEvent } from "../src/domain/types";

const baseDay = (zoneName = "미주", zoneId = "zone-a"): DayRecord => {
  const event = (
    id: string,
    type: TimelineEvent["type"],
    at: string,
    payload?: Record<string, unknown>,
  ): TimelineEvent => ({
    id,
    type,
    at,
    zoneId,
    payload,
    source: "manual",
    createdAt: at,
    updatedAt: at,
  });
  const timeline = [
    event("start", "zone_start", "2026-09-05T09:00:00+09:00"),
    event("sort-start", "sorting_start", "2026-09-05T09:10:00+09:00"),
    event("sort-end", "sorting_end", "2026-09-05T09:30:00+09:00"),
    event("delivery-start", "delivery_start", "2026-09-05T09:30:00+09:00"),
    event("end", "zone_end", "2026-09-05T11:00:00+09:00", {
      total: 100,
      delivered: 100,
      failed: 0,
      extra: 0,
    }),
    event("close", "day_close", "2026-09-05T11:00:00+09:00"),
  ];
  return {
    schemaVersion: 1,
    id: "correction-safety",
    date: "2026-09-05",
    status: "closed",
    timeline,
    zones: [{
      id: zoneId,
      name: zoneName,
      order: 1,
      startEventId: "start",
      sortingStartEventId: "sort-start",
      sortingEndEventId: "sort-end",
      deliveryStartEventId: "delivery-start",
      endEventId: "end",
    }],
    helpers: [],
    adjustments: [],
    meta: {
      createdAt: "2026-09-05T09:00:00+09:00",
      updatedAt: "2026-09-05T11:00:00+09:00",
      recoveryStatus: "none",
    },
  };
};

const addHelper = (
  day: DayRecord,
  id: string,
  helperKind: "free_received" | "paid_received",
  quantity: number,
  sourceZoneId?: string,
): DayRecord => ({
  ...day,
  timeline: [...day.timeline, {
    id,
    type: "helper_add",
    at: "2026-09-05T11:05:00+09:00",
    source: "manual",
    createdAt: "2026-09-05T11:05:00+09:00",
    updatedAt: "2026-09-05T11:05:00+09:00",
    payload: { name: id, helperKind, quantity, sourceZoneId },
  }],
});

const handlingBase = baseDay();
handlingBase.timeline = handlingBase.timeline.filter((event) => event.id !== "delivery-start");
handlingBase.zones = handlingBase.zones.map((zone) => ({ ...zone, deliveryStartEventId: undefined }));
let handlingDay = setHandlingMinutes(handlingBase, { zoneId: "zone-a", minutes: 30 });
handlingDay = addHelper(handlingDay, "zone-free", "free_received", 30, "zone-a");
handlingDay = addHelper(handlingDay, "zone-paid", "paid_received", 30, "zone-a");
handlingDay = addHelper(handlingDay, "separate-free", "free_received", 10);
handlingDay = addHelper(handlingDay, "separate-paid", "paid_received", 10);
const handlingCalculation = calculateDay(handlingDay);
const handlingZone = handlingCalculation.zones[0]!;
assert.equal(handlingZone.deliveryMinutes, 70, "sorting 20 + handling 30 leaves 70 delivery minutes");
assert.equal(handlingZone.counts.total, 100);
assert.equal(handlingZone.efficiencyCount, 70, "zone-linked free helper is excluded from the numerator");
assert.equal(handlingCalculation.totals.totalCount, 120);
assert.equal(handlingCalculation.totals.efficiencyCount, 80, "separate paid helper adds to efficiency");

const invalidTimeDay = {
  ...baseDay(),
  timeline: baseDay().timeline.map((event) =>
    event.id === "delivery-start" ? { ...event, at: "not-a-time" } : event,
  ),
};
const invalidCalculation = calculateDay(invalidTimeDay);
assert.equal(invalidCalculation.zones[0]?.deliveryMinutes, undefined);
assert.equal(invalidCalculation.zones[0]?.efficiencyPerHour, undefined);
assert.equal(invalidCalculation.totals.efficiencyPerHour, undefined);
assert.equal(invalidCalculation.totals.totalElapsedMinutes, 120);
assert.ok(invalidCalculation.warnings.some((warning) => warning.code === "indeterminate_delivery_time"));

for (const [label, change] of [
  ["sorting end after zone end", (event: TimelineEvent) => event.id === "sort-end" ? { ...event, at: "2026-09-05T11:30:00+09:00" } : event],
  ["sorting start before zone start", (event: TimelineEvent) => event.id === "sort-start" ? { ...event, at: "2026-09-05T08:30:00+09:00" } : event],
  ["reversed sorting", (event: TimelineEvent) => event.id === "sort-start" ? { ...event, at: "2026-09-05T09:40:00+09:00" } : event],
  ["delivery start before zone start", (event: TimelineEvent) => event.id === "delivery-start" ? { ...event, at: "2026-09-05T08:30:00+09:00" } : event],
] as const) {
  const inconsistent = baseDay();
  inconsistent.timeline = inconsistent.timeline.map(change);
  const calculation = calculateDay(inconsistent);
  assert.equal(calculation.zones[0]?.deliveryMinutes, undefined, label);
}

const earlyDelivery = baseDay();
earlyDelivery.timeline = earlyDelivery.timeline.map((event) =>
  event.id === "delivery-start" ? { ...event, at: "2026-09-05T09:05:00+09:00" } : event,
);
assert.equal(calculateDay(earlyDelivery).zones[0]?.deliveryMinutes, 95);

const mijuDay = baseDay();
mijuDay.timeline = mijuDay.timeline.map((event) =>
  event.id === "end"
    ? {
        ...event,
        payload: {
          ...event.payload,
          aTotal: 60,
          bTotal: 40,
          building1Total: 60,
          restTotal: 40,
          mijuRest: 40,
        },
      }
    : event,
);
const mijuEdited = applyCompletedZoneEdit(mijuDay, { zoneId: "zone-a", delivered: 120 });
const mijuPayload = mijuEdited.timeline.find((event) => event.id === "end")?.payload as Record<string, unknown>;
assert.equal(mijuPayload.aTotal, 60);
assert.equal(mijuPayload.bTotal, 60, "retained Miju A details recalculate B from the new total");
assert.equal(mijuPayload.restTotal, 60);
assert.equal(mijuPayload.mijuRest, 60);

const staleAggregates = applyCompletedZoneEdit(mijuDay, {
  zoneId: "zone-a",
  delivered: 120,
  mijuA: 60,
  mijuB: 40,
});
const staleAggregatePayload = staleAggregates.timeline.find((event) => event.id === "end")?.payload as Record<string, unknown>;
assert.equal(staleAggregatePayload.delivered, 120);
assert.equal(staleAggregatePayload.bTotal, 60);

const belowKnownA = applyCompletedZoneEdit(mijuDay, { zoneId: "zone-a", delivered: 50 });
const belowKnownACalculation = calculateDay(belowKnownA);
const belowKnownAPayload = belowKnownA.timeline.find((event) => event.id === "end")?.payload as Record<string, unknown>;
assert.equal(belowKnownAPayload.bTotal, 0);
assert.ok(belowKnownACalculation.warnings.some((warning) => warning.code === "miju_detail_inconsistent"));

const nonMiju = baseDay("힐스", "hils");
const nonMijuEdited = applyCompletedZoneEdit(nonMiju, { zoneId: "hils", delivered: 120 });
const nonMijuPayload = nonMijuEdited.timeline.find((event) => event.id === "end")?.payload as Record<string, unknown>;
assert.equal(Object.hasOwn(nonMijuPayload, "aTotal"), false);
assert.equal(Object.hasOwn(nonMijuPayload, "bTotal"), false);

const autoCorrected = {
  ...baseDay(),
  timeline: baseDay().timeline.map((event) =>
    event.id === "delivery-start"
      ? { ...event, payload: { autoCorrected: true, correctionReason: "missing start" } }
      : event,
  ),
};
const correctedOnce = applyCompletedZoneEdit(autoCorrected, {
  zoneId: "zone-a",
  sortingEndAt: "2026-09-05T09:40:00+09:00",
});
assert.equal(correctedOnce.timeline.find((event) => event.id === "delivery-start")?.at, "2026-09-05T09:40:00+09:00");
const correctedTwice = applyCompletedZoneEdit(correctedOnce, {
  zoneId: "zone-a",
  sortingEndAt: "2026-09-05T09:50:00+09:00",
});
assert.equal(correctedTwice.timeline.find((event) => event.id === "delivery-start")?.at, "2026-09-05T09:50:00+09:00");

const sameSortingEndAfterInsertion = {
  ...autoCorrected,
  timeline: autoCorrected.timeline.map((event) =>
    event.id === "sort-end" ? { ...event, at: "2026-09-05T09:40:00+09:00" } :
      event.id === "delivery-start" ? { ...event, at: "2026-09-05T09:30:00+09:00" } : event,
  ),
};
const reconciledSameSortingEnd = applyCompletedZoneEdit(sameSortingEndAfterInsertion, {
  zoneId: "zone-a",
  sortingEndAt: "2026-09-05T09:40:00+09:00",
});
assert.equal(reconciledSameSortingEnd.timeline.find((event) => event.id === "delivery-start")?.at, "2026-09-05T09:40:00+09:00");

const manualStart = applyCompletedZoneEdit(baseDay(), {
  zoneId: "zone-a",
  sortingEndAt: "2026-09-05T09:40:00+09:00",
  deliveryStartAt: "2026-09-05T09:35:00+09:00",
});
assert.equal(manualStart.timeline.find((event) => event.id === "delivery-start")?.at, "2026-09-05T09:35:00+09:00");

const manualOverrideOfAutoStart = applyCompletedZoneEdit(autoCorrected, {
  zoneId: "zone-a",
  sortingEndAt: "2026-09-05T09:40:00+09:00",
  deliveryStartAt: "2026-09-05T09:35:00+09:00",
});
const manualOverrideEvent = manualOverrideOfAutoStart.timeline.find((event) => event.id === "delivery-start");
assert.equal(manualOverrideEvent?.at, "2026-09-05T09:35:00+09:00");
assert.equal((manualOverrideEvent?.payload as Record<string, unknown>)?.autoCorrected, false);

const weightedReportDay = baseDay();
weightedReportDay.timeline.push(
  {
    id: "alt-start",
    type: "zone_start",
    at: "2026-09-05T11:00:00+09:00",
    zoneId: "alt-1",
    source: "manual",
    createdAt: "2026-09-05T11:00:00+09:00",
    updatedAt: "2026-09-05T11:00:00+09:00",
  },
  {
    id: "alt-delivery-start",
    type: "delivery_start",
    at: "2026-09-05T11:00:00+09:00",
    zoneId: "alt-1",
    source: "manual",
    createdAt: "2026-09-05T11:00:00+09:00",
    updatedAt: "2026-09-05T11:00:00+09:00",
  },
  {
    id: "alt-end",
    type: "zone_end",
    at: "2026-09-05T12:00:00+09:00",
    zoneId: "alt-1",
    payload: { total: 200, delivered: 200, failed: 0, extra: 0 },
    source: "manual",
    createdAt: "2026-09-05T12:00:00+09:00",
    updatedAt: "2026-09-05T12:00:00+09:00",
  },
);
weightedReportDay.zones.push({
  id: "alt-1",
  name: "대체배송",
  order: 2,
  startEventId: "alt-start",
  deliveryStartEventId: "alt-delivery-start",
  endEventId: "alt-end",
});
const weightedCalculation = calculateDay(weightedReportDay);
const weightedReport = buildDailyReport(weightedReportDay, weightedCalculation);
assert.match(weightedReport.text, /전체 평균:\s+시간당 120개/);
assert.match(weightedReport.text, /\[정규 효율 \(대체배송 제외\)\]\n  시간당 67개/);

const unclearRegularDay = baseDay();
unclearRegularDay.timeline = unclearRegularDay.timeline.map((event) =>
  event.id === "delivery-start" ? { ...event, at: "invalid-time" } : event,
);
const unclearRegularReport = buildDailyReport(unclearRegularDay, calculateDay(unclearRegularDay));
assert.match(unclearRegularReport.text, /\[정규 효율 \(대체배송 제외\)\]\n  시간당 -/);

console.log("correction safety tests passed");
