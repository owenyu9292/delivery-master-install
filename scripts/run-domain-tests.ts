import assert from "node:assert/strict";

import {
  createEvent,
  deriveLog,
  sortTimeline,
  updateEvent,
  validateTimeline,
} from "../src/domain/eventTimeline";
import { calculateDay, calculateZone } from "../src/domain/deliveryCalc";
import { resolveMijuDetailQuantity, validateZoneQuantity } from "../src/domain/zoneValidation";
import {
  applyMissingCleanupCorrection,
  hasMissingCleanupFinish,
} from "../src/domain/cleanupCorrection";
import { applyCompletedZoneEdit } from "../src/domain/zoneEdit";
import {
  buildMigrationReport,
  inspectLegacySource,
  migrateLegacySource,
} from "../src/domain/legacyMigration";
import { migrateFieldAppBackup } from "../src/domain/fieldAppMigration";
import type { DayRecord, TimelineEvent } from "../src/domain/types";
import { buildDailyReport, buildPreviewModel } from "../src/domain/reportBuilder";
import { createDateSummary } from "../src/storage/dayStore";
import {
  FIELD_APP_BACKUP_APP,
  PHONE_INSTALL_BACKUP_APP,
  PHONE_INSTALL_BACKUP_FILENAME,
  PHONE_INSTALL_BACKUP_TYPE,
  buildFieldAppMigrationBackup,
  copyBackupImport,
  createBackupCopyDay,
  exportBackup,
  importFieldAppBackupMigration,
  overwriteBackupImport,
  previewBackupImport,
  runBackupImport,
} from "../src/storage/backupImportExport";
import { MemoryDayStore } from "../src/storage/memoryDayStore";
import {
  buildPhoneInstallDashboard,
  performExplicitPhoneInstallReset,
  preparePhoneInstallUpdate,
  recoverPhoneInstall,
} from "../src/install/phoneInstall";
import {
  buildBackupRecoveryScreen,
  buildDateIndexScreen,
  buildMonthlyStatsScreen,
  buildSettingsScreen,
  buildUiScreens,
  buildWeeklyStatsScreen,
  buildWorkScreen,
} from "../src/ui/uiScreens";
import { sampleDayRecord } from "../test/fixtures/sample-day-record";

const tests: Array<[string, () => void | Promise<void>]> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  tests.push([name, fn]);
}

test("deriveLog creates display logs from timeline only", () => {
  const logs = deriveLog(sampleDayRecord);

  assert.equal(logs.length, sampleDayRecord.timeline.length);
  assert.equal(logs[0]?.eventId, "evt-001");
  assert.equal(typeof logs[0]?.label, "string");
  assert.equal(logs.at(-1)?.eventId, "evt-011");
  assert.equal(typeof logs.at(-1)?.label, "string");
  assert.equal(Object.hasOwn(sampleDayRecord, "logs"), false);
  assert.equal(Object.hasOwn(sampleDayRecord, "logEntries"), false);
  assert.equal(Object.hasOwn(sampleDayRecord, "screenLogs"), false);
});

test("sortTimeline sorts by time and then id", () => {
  const reversed = [...sampleDayRecord.timeline].reverse();
  const sorted = sortTimeline(reversed);

  assert.deepEqual(
    sorted.map((event) => event.id),
    sampleDayRecord.timeline.map((event) => event.id),
  );
});

test("createEvent adds events immutably and keeps timeline sorted", () => {
  const next = createEvent(sampleDayRecord, {
    id: "evt-000",
    type: "incident",
    at: "2026-05-17T07:50:00+09:00",
    note: "extra incident",
  });

  assert.notEqual(next, sampleDayRecord);
  assert.equal(next.timeline.length, sampleDayRecord.timeline.length + 1);
  assert.equal(next.timeline[0]?.id, "evt-000");
  assert.equal(next.timeline[0]?.source, "manual");
  assert.equal(sampleDayRecord.timeline[0]?.id, "evt-001");
});

test("updateEvent updates existing events without changing id or createdAt", () => {
  const original = sampleDayRecord.timeline.find((event) => event.id === "evt-008");
  const next = updateEvent(sampleDayRecord, "evt-008", {
    note: "updated note",
  });
  const updated = next.timeline.find((event) => event.id === "evt-008");

  assert.equal(updated?.id, "evt-008");
  assert.equal(updated?.createdAt, original?.createdAt);
  assert.equal(updated?.note, "updated note");
  assert.notEqual(updated?.updatedAt, original?.updatedAt);
});

test("updateEvent returns the same record for unknown events", () => {
  const next = updateEvent(sampleDayRecord, "missing-event", {
    note: "ignored",
  });

  assert.equal(next, sampleDayRecord);
});

test("validateTimeline accepts the sample day record", () => {
  const result = validateTimeline(sampleDayRecord);

  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, []);
});

test("validateTimeline catches core timeline integrity issues", () => {
  const brokenEvent: TimelineEvent = {
    ...sampleDayRecord.timeline[0],
    id: "evt-001",
    type: "zone_start",
    at: "not-a-date",
    zoneId: undefined,
  };
  const broken: DayRecord = {
    ...sampleDayRecord,
    timeline: [...sampleDayRecord.timeline, brokenEvent],
    zones: [
      {
        ...sampleDayRecord.zones[0],
        endEventId: "missing-zone-end",
      },
    ],
  };

  const result = validateTimeline(broken);
  const codes = result.warnings.map((warning) => warning.code);

  assert.equal(result.valid, false);
  assert.equal(codes.includes("duplicate_event_id"), true);
  assert.equal(codes.includes("invalid_event_time"), true);
  assert.equal(codes.includes("missing_zone_id"), true);
  assert.equal(codes.includes("zone_missing_linked_event"), true);
});

test("calculateZone derives time, counts, and efficiency from timeline", () => {
  const zone = calculateZone(sampleDayRecord, "zone-a");

  assert.equal(zone.elapsedMinutes, 140);
  assert.equal(zone.sortingMinutes, 25);
  assert.equal(zone.deliveryMinutes, 105);
  assert.deepEqual(zone.counts, {
    total: 43,
    delivered: 41,
    failed: 1,
    extra: 1,
  });
  assert.deepEqual(zone.sourceEventIds, ["evt-005", "evt-009", "evt-010"]);
  assert.equal(Math.round((zone.efficiencyPerHour ?? 0) * 100) / 100, 23.43);
});

test("calculateDay hides efficiency when delivery time is under one minute", () => {
  const quickDay: DayRecord = {
    ...sampleDayRecord,
    timeline: sampleDayRecord.timeline.map((event) => {
      if (event.id === "evt-003") return { ...event, at: "2026-05-17T10:00:00+09:00" };
      if (event.id === "evt-004") return { ...event, at: "2026-05-17T10:00:10+09:00" };
      if (event.id === "evt-005") return { ...event, at: "2026-05-17T10:00:20+09:00" };
      if (event.id === "evt-006") return { ...event, at: "2026-05-17T10:00:21+09:00" };
      if (event.id === "evt-010") return { ...event, at: "2026-05-17T10:00:30+09:00" };
      if (event.id === "evt-011") return { ...event, at: "2026-05-17T10:00:30+09:00" };
      return event;
    }),
  };
  const zone = calculateZone(quickDay, "zone-a");
  const calculation = calculateDay(quickDay);

  assert.equal(zone.deliveryMinutes !== undefined && zone.deliveryMinutes < 1, true);
  assert.equal(zone.efficiencyPerHour, undefined);
  assert.equal(calculation.totals.efficiencyPerHour, undefined);
});

test("validateZoneQuantity blocks missing and zero zone quantities", () => {
  const missing = validateZoneQuantity({
    zoneName: "힐스테이트",
    entered: 0,
    hasValue: false,
    expectedTotal: 560,
    completedOther: 321,
    maxReasonable: 800,
  });
  const zero = validateZoneQuantity({
    zoneName: "힐스테이트",
    entered: 0,
    hasValue: true,
    expectedTotal: 560,
    completedOther: 321,
    maxReasonable: 800,
  });

  assert.equal(missing.ok, false);
  assert.equal(zero.ok, false);
});

test("validateZoneQuantity suggests subtracting completed zones from a day total", () => {
  const result = validateZoneQuantity({
    zoneName: "힐스테이트",
    entered: 560,
    hasValue: true,
    expectedTotal: 552,
    completedOther: 321,
    maxReasonable: 800,
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestionReason, "looks_like_day_total");
  assert.equal(result.suggestedValue, 239);
});

test("resolveMijuDetailQuantity calculates rest from total and A section", () => {
  const result = resolveMijuDetailQuantity({
    total: 321,
    totalHasValue: true,
    one: 44,
    two: 55,
    three: 54,
    rest: 0,
    restHasValue: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.aTotal, 153);
  assert.equal(result.rest, 168);
  assert.equal(result.delivered, 321);
  assert.equal(result.autoCalculatedRest, true);
});

test("miju detail uses order-resolved zone quantity when miju is not first", () => {
  const quantity = validateZoneQuantity({
    zoneName: "미주",
    entered: 150,
    hasValue: true,
    expectedTotal: 150,
    completedOther: 92,
    maxReasonable: 800,
  });
  const zoneDelivered = quantity.suggestedValue ?? quantity.value;
  const detail = resolveMijuDetailQuantity({
    total: zoneDelivered,
    totalHasValue: true,
    one: 5,
    two: 6,
    three: 9,
    rest: 0,
    restHasValue: false,
  });

  assert.equal(quantity.suggestionReason, "looks_like_day_total");
  assert.equal(zoneDelivered, 58);
  assert.equal(detail.ok, true);
  assert.equal(detail.aTotal, 20);
  assert.equal(detail.rest, 38);
  assert.equal(detail.delivered, 58);
});

test("resolveMijuDetailQuantity rejects totals smaller than detailed counts", () => {
  const result = resolveMijuDetailQuantity({
    total: 100,
    totalHasValue: true,
    one: 44,
    two: 55,
    three: 54,
    rest: 0,
    restHasValue: false,
  });

  assert.equal(result.ok, false);
});

test("calculateDay derives totals from timeline and ignores ZoneRecord.counts cache", () => {
  const withoutCounts: DayRecord = {
    ...sampleDayRecord,
    zones: sampleDayRecord.zones.map((zone) => ({
      ...zone,
      counts: undefined,
      countsSourceEventIds: undefined,
      countsCalculatedAt: undefined,
    })),
  };

  const calculation = calculateDay(withoutCounts);

  assert.equal(calculation.warnings.length, 0);
  assert.equal(calculation.totals.totalCount, 43);
  assert.equal(calculation.totals.deliveredCount, 41);
  assert.equal(calculation.totals.failedCount, 1);
  assert.equal(calculation.totals.extraCount, 1);
  assert.equal(calculation.totals.totalElapsedMinutes, 215);
  assert.equal(calculation.totals.deliveryMinutes, 105);
  assert.equal(
    Math.round((calculation.totals.efficiencyPerHour ?? 0) * 100) / 100,
    23.43,
  );
});

test("calculateDay warns when required zone events are missing", () => {
  const broken: DayRecord = {
    ...sampleDayRecord,
    zones: [
      {
        ...sampleDayRecord.zones[0],
        startEventId: "missing-start",
      },
    ],
  };

  const calculation = calculateDay(broken);
  const codes = calculation.warnings.map((warning) => warning.code);

  assert.equal(codes.includes("missing_calculation_event"), true);
});

test("calculateZone treats end-of-zone cleanup as non-delivery time", () => {
  const endCleanupDay: DayRecord = {
    ...sampleDayRecord,
    timeline: sampleDayRecord.timeline.map((event) => {
      if (event.id === "evt-004") {
        return { ...event, at: "2026-05-17T10:50:00+09:00" };
      }
      if (event.id === "evt-005") {
        return { ...event, at: "2026-05-17T11:20:00+09:00" };
      }
      return event;
    }).filter((event) => event.id !== "evt-006"),
    zones: sampleDayRecord.zones.map((zone) => ({
      ...zone,
      deliveryStartEventId: undefined,
    })),
  };

  const zone = calculateZone(endCleanupDay, "zone-a");

  assert.equal(zone.elapsedMinutes, 140);
  assert.equal(zone.sortingMinutes, 30);
  assert.equal(zone.deliveryMinutes, 110);
});

test("calculateZone subtracts linked incident minutes from delivery time", () => {
  const withIncident: DayRecord = createEvent(sampleDayRecord, {
    id: "evt-incident-hils",
    type: "incident",
    at: "2026-05-17T10:30:00+09:00",
    zoneId: "zone-a",
    payload: {
      title: "반품 선수거",
      minutes: 10,
      affectsEfficiency: true,
    },
  });

  const zone = calculateZone(withIncident, "zone-a");

  assert.equal(zone.eventMinutes, 10);
  assert.equal(zone.deliveryMinutes, 95);
});

test("applyMissingCleanupCorrection anchors cleanup to zone close time", () => {
  const missingCleanupEnd: DayRecord = {
    ...sampleDayRecord,
    timeline: sampleDayRecord.timeline.filter((event) => event.id !== "evt-005" && event.id !== "evt-006"),
    zones: sampleDayRecord.zones.map((zone) => ({
      ...zone,
      sortingEndEventId: undefined,
      deliveryStartEventId: undefined,
    })),
  };

  assert.equal(hasMissingCleanupFinish(missingCleanupEnd, "zone-a"), true);

  const result = applyMissingCleanupCorrection(missingCleanupEnd, {
    zoneId: "zone-a",
    closeAt: "2026-05-17T11:20:00+09:00",
    minutes: 30,
    source: "zone_close_prompt",
  });
  const zone = calculateZone(result.dayRecord, "zone-a");

  assert.equal(result.minutes, 30);
  assert.equal(result.sortingStartAt, "2026-05-17T01:50:00.000Z");
  assert.equal(result.sortingEndAt, "2026-05-17T02:20:00.000Z");
  assert.equal(zone.sortingMinutes, 30);
  assert.equal(zone.deliveryMinutes, 110);
  assert.equal(result.dayRecord.adjustments.at(-1)?.reason, "missing_cleanup_finish");
});

test("calculateZone gives non-miju zero movement a five minute floor", () => {
  const movementDay: DayRecord = {
    ...sampleDayRecord,
    timeline: [
      ...sampleDayRecord.timeline.filter((event) => event.id !== "evt-011"),
      {
        id: "evt-b-start",
        type: "zone_start",
        at: "2026-05-17T11:20:00+09:00",
        zoneId: "zone-b",
        payload: { zoneName: "B zone", order: 2 },
        source: "manual",
        createdAt: "2026-05-17T11:20:00+09:00",
        updatedAt: "2026-05-17T11:20:00+09:00",
      },
      {
        id: "evt-b-sort-start",
        type: "sorting_start",
        at: "2026-05-17T11:20:00+09:00",
        zoneId: "zone-b",
        source: "manual",
        createdAt: "2026-05-17T11:20:00+09:00",
        updatedAt: "2026-05-17T11:20:00+09:00",
      },
      {
        id: "evt-b-sort-end",
        type: "sorting_end",
        at: "2026-05-17T11:50:00+09:00",
        zoneId: "zone-b",
        source: "manual",
        createdAt: "2026-05-17T11:50:00+09:00",
        updatedAt: "2026-05-17T11:50:00+09:00",
      },
      {
        id: "evt-b-end",
        type: "zone_end",
        at: "2026-05-17T11:50:00+09:00",
        zoneId: "zone-b",
        payload: { total: 20, delivered: 20, failed: 0, extra: 0 },
        source: "manual",
        createdAt: "2026-05-17T11:50:00+09:00",
        updatedAt: "2026-05-17T11:50:00+09:00",
      },
      {
        ...sampleDayRecord.timeline.at(-1)!,
        at: "2026-05-17T11:55:00+09:00",
      },
    ],
    zones: [
      ...sampleDayRecord.zones,
      {
        id: "zone-b",
        name: "B zone",
        order: 2,
        startEventId: "evt-b-start",
        sortingStartEventId: "evt-b-sort-start",
        sortingEndEventId: "evt-b-sort-end",
        endEventId: "evt-b-end",
      },
    ],
  };

  const zone = calculateZone(movementDay, "zone-b");

  assert.equal(zone.movementMinutes, 5);
  assert.equal(zone.sortingMinutes, 30);
  assert.equal(zone.deliveryMinutes, 0);
});

test("applyCompletedZoneEdit updates completed zone times and counts from timeline", () => {
  const edited = applyCompletedZoneEdit(sampleDayRecord, {
    zoneId: "zone-a",
    startAt: "2026-05-17T09:10:00+09:00",
    sortingStartAt: "2026-05-17T09:15:00+09:00",
    sortingEndAt: "2026-05-17T09:40:00+09:00",
    endAt: "2026-05-17T11:40:00+09:00",
    delivered: 55,
    failed: 2,
    extra: 3,
  });
  const zone = calculateZone(edited, "zone-a");
  const end = edited.timeline.find((event) => event.id === "evt-010");

  assert.equal(end?.at, "2026-05-17T11:40:00+09:00");
  assert.equal(zone.counts.delivered, 55);
  assert.equal(zone.counts.failed, 2);
  assert.equal(zone.counts.extra, 3);
  assert.equal(zone.elapsedMinutes, 150);
  assert.equal(zone.sortingMinutes, 25);
  assert.equal(edited.zones[0]?.counts, undefined);
  assert.equal(edited.adjustments.at(-1)?.reason, "completed_zone_edit");
  assert.equal(edited.meta.recoveryStatus, "needsReview");
});

test("applyCompletedZoneEdit stores miju building details and sums them", () => {
  const edited = applyCompletedZoneEdit(sampleDayRecord, {
    zoneId: "zone-a",
    miju1: 5,
    miju2: 6,
    miju3: 9,
    mijuRest: 32,
  });
  const zone = calculateZone(edited, "zone-a");
  const end = edited.timeline.find((event) => event.id === "evt-010");
  const payload = end?.payload as Record<string, unknown> | undefined;

  assert.equal(zone.counts.delivered, 52);
  assert.equal(payload?.building1Total, 5);
  assert.equal(payload?.building2Total, 6);
  assert.equal(payload?.building3Total, 9);
  assert.equal(payload?.aTotal, 20);
  assert.equal(payload?.bTotal, 32);
});

test("received helpers affect totals and efficiency by helper kind", () => {
  let day = createEvent(sampleDayRecord, {
    type: "helper_add",
    at: "2026-05-17T12:00:00+09:00",
    payload: {
      helperId: "helper-free",
      name: "도우미 배송 무료",
      helperKind: "free_received",
      quantity: 13,
      countsForEfficiency: false,
    },
  });
  day = createEvent(day, {
    type: "helper_add",
    at: "2026-05-17T12:05:00+09:00",
    payload: {
      helperId: "helper-paid",
      name: "도우미 배송 유료",
      helperKind: "paid_received",
      quantity: 7,
      countsForEfficiency: true,
    },
  });
  const base = calculateDay(sampleDayRecord);
  const calculation = calculateDay(day);
  const report = buildDailyReport(day, calculation);

  assert.equal(calculation.totals.totalCount, base.totals.totalCount + 20);
  assert.equal(calculation.totals.deliveredCount, base.totals.deliveredCount + 20);
  assert.equal(calculation.totals.efficiencyCount, base.totals.deliveredCount + 7);
  assert.equal(calculation.totals.helperFreeCount, 13);
  assert.equal(calculation.totals.helperPaidCount, 7);
  assert.equal(report.text.includes("무료 13개 (효율 제외)"), true);
  assert.equal(report.text.includes("유료 7개 (효율 포함)"), true);
});

test("unpaid helper day keeps drive and helper time without delivery efficiency", () => {
  const helperDay = createUnpaidHelperDay("2026-05-24", "2026-05-24T14:00:00+09:00");
  const calculation = calculateDay(helperDay);
  const report = buildDailyReport(helperDay, calculation);

  assert.equal(calculation.zones.length, 0);
  assert.equal(calculation.totals.totalCount, 0);
  assert.equal(calculation.totals.deliveredCount, 0);
  assert.equal(calculation.totals.deliveryMinutes, 0);
  assert.equal(calculation.totals.efficiencyPerHour, undefined);
  assert.equal(calculation.totals.totalElapsedMinutes, 360);
  assert.equal(helperDay.helpers.length, 1);
  assert.equal(report.sourceEventIds.length, helperDay.timeline.length);
});

test("unpaid helper day can close with a manually supplied finish time", () => {
  const helperDay = createUnpaidHelperDay("2026-05-24", "2026-05-24T17:10:00+09:00");
  const helperEvent = helperDay.timeline.find((event) => event.type === "helper_add");
  const closeEvent = helperDay.timeline.find((event) => event.type === "day_close");

  assert.equal(helperEvent?.at, "2026-05-24T17:10:00+09:00");
  assert.equal(closeEvent?.at, "2026-05-24T17:10:00+09:00");
  assert.equal((helperEvent?.payload as { minutes?: number })?.minutes, 505);
});

test("in-progress unpaid helper day is not closed until finish is confirmed", () => {
  const helperDay = createUnpaidHelperDay("2026-05-24", undefined);
  const calculation = calculateDay(helperDay);

  assert.equal(helperDay.status, "active");
  assert.equal(helperDay.timeline.some((event) => event.type === "day_close"), false);
  assert.equal(helperDay.helpers.length, 0);
  assert.equal(calculation.totals.totalCount, 0);
  assert.equal(calculation.totals.efficiencyPerHour, undefined);
});

test("buildDailyReport derives report text without storing report data on DayRecord", () => {
  const calculation = calculateDay(sampleDayRecord);
  const report = buildDailyReport(sampleDayRecord, calculation);

  assert.equal(report.date, sampleDayRecord.date);
  assert.equal(report.sourceEventIds.length, sampleDayRecord.timeline.length);
  assert.equal(report.text.includes(sampleDayRecord.date), true);
  assert.equal(report.text.includes("43"), true);
  assert.equal(report.text.includes("41"), true);
  assert.equal(report.text.length > 0, true);
  assert.equal(Object.hasOwn(sampleDayRecord, "report"), false);
  assert.equal(Object.hasOwn(sampleDayRecord, "reportText"), false);
});

test("buildPreviewModel returns a small derived model for UI display", () => {
  const calculation = calculateDay(sampleDayRecord);
  const preview = buildPreviewModel(sampleDayRecord, calculation);

  assert.equal(preview.date, "2026-05-17");
  assert.equal(preview.zoneCount, 1);
  assert.equal(preview.totalCount, 43);
  assert.equal(preview.deliveredCount, 41);
  assert.equal(preview.failedCount, 1);
  assert.equal(preview.deliveryMinutes, 105);
  assert.equal(preview.sourceEventIds.length, sampleDayRecord.timeline.length);
});

test("uiScreens orchestrates derived screens from current and historical data", () => {
  const otherDay = structuredClone(sampleDayRecord);

  otherDay.id = "day-2026-05-16";
  otherDay.date = "2026-05-16";
  otherDay.status = "active";
  otherDay.timeline = otherDay.timeline.map((event) => ({
    ...event,
    at: event.at.replaceAll("2026-05-17", "2026-05-16"),
    createdAt: event.createdAt.replaceAll("2026-05-17", "2026-05-16"),
    updatedAt: event.updatedAt.replaceAll("2026-05-17", "2026-05-16"),
  }));
  otherDay.zones = otherDay.zones.map((zone) => ({
    ...zone,
    counts: {
      total: 12,
      delivered: 10,
      failed: 1,
      extra: 1,
    },
    countsCalculatedAt: "2026-05-16T11:20:10+09:00",
  }));
  otherDay.meta = {
    ...otherDay.meta,
    updatedAt: "2026-05-16T11:35:02+09:00",
  };
  otherDay.timeline = otherDay.timeline.map((event) =>
    event.id === "evt-010"
      ? {
          ...event,
          payload: { delivered: 10, failed: 1, extra: 1, total: 12 },
        }
      : event,
  );

  const screens = buildUiScreens({
    dayRecord: sampleDayRecord,
    history: [otherDay, sampleDayRecord],
    selectedDate: "2026-05-16",
  });

  assert.deepEqual(screens.navigation.map((screen) => screen.key), [
    "work",
    "logs",
    "report",
    "dates",
    "stats",
    "settings",
    "backup",
  ]);
  assert.equal(screens.work.day.date, sampleDayRecord.date);
  assert.equal(screens.work.stage, "closed");
  assert.equal(screens.logs.entries.length, sampleDayRecord.timeline.length);
  assert.equal(screens.report.preview.zoneCount, 1);
  assert.equal(screens.dates.items[0]?.date, "2026-05-17");
  assert.equal(screens.dates.selectedDate, "2026-05-16");
  assert.equal(screens.stats.dayCount, 2);
  assert.equal(screens.stats.totals.totalCount, 55);
  assert.equal(screens.settings.installMode, "phoneInstall");
  assert.equal(screens.backup.safetyRules.includes("Automatic snapshots are required."), true);
});

test("uiScreens specific builders keep recovery and install rules explicit", () => {
  const work = buildWorkScreen(sampleDayRecord);
  const dates = buildDateIndexScreen([
    createDateSummary(sampleDayRecord),
    createDateSummary({
      ...sampleDayRecord,
      date: "2026-05-16",
      meta: {
        ...sampleDayRecord.meta,
        updatedAt: "2026-05-16T11:35:02+09:00",
      },
    }),
  ]);
  const settings = buildSettingsScreen(sampleDayRecord);
  const backup = buildBackupRecoveryScreen(sampleDayRecord, 2);
  const stats = buildMonthlyStatsScreen([sampleDayRecord], "2026-05");

  assert.equal(work.stage, "closed");
  assert.equal(dates.items[0]?.date, "2026-05-17");
  assert.equal(settings.installMode, "phoneInstall");
  assert.equal(settings.safetyRules[0], "Automatic snapshots before destructive operations.");
  assert.equal(backup.backupHint.includes("2 date snapshots"), true);
  assert.equal(stats.monthKey, "2026-05");
  assert.equal(stats.dayCount, 1);
  assert.equal(stats.totals.totalCount, 43);
});

test("weekly and monthly stats compare miju hils and alternate quantities", () => {
  const monday = createQuantityComparisonDay("2026-05-18", 40, 20, 10);
  const tuesday = createQuantityComparisonDay("2026-05-19", 20, 10, 0);
  const nextWeek = createQuantityComparisonDay("2026-05-26", 999, 999, 999);
  const monthly = buildMonthlyStatsScreen([monday, tuesday, nextWeek], "2026-05");
  const weekly = buildWeeklyStatsScreen([monday, tuesday, nextWeek], "2026-W21");

  assert.equal(weekly.dayCount, 2);
  assert.equal(weekly.quantityComparison.totalQuantity, 100);
  assert.equal(weekly.quantityComparison.ratioLabel, "6:3:1");
  assert.deepEqual(
    weekly.quantityComparison.buckets.map((bucket) => [bucket.quantity, bucket.ratioPart]),
    [
      [60, 6],
      [30, 3],
      [10, 1],
    ],
  );
  assert.equal(monthly.quantityComparison.ratioLabel, "1059:1029:1009");
});

test("phoneInstall dashboard exposes install, recovery, and reset rules", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const dashboard = await buildPhoneInstallDashboard(store);

  assert.equal(dashboard.installMode, "phoneInstall");
  assert.equal(dashboard.latestSummary?.date, sampleDayRecord.date);
  assert.equal(dashboard.screens?.work.day.date, sampleDayRecord.date);
  assert.equal(dashboard.recovery.allowedModes.includes("preview"), true);
  assert.equal(dashboard.update.requiresAutomaticSnapshot, true);
  assert.equal(dashboard.reset.requiresExplicitConfirmation, true);
  assert.equal(dashboard.safetyRules[1], "Explicit reset only. No silent wipe on cancel, back, app switch, or restart.");
});

test("phoneInstall update preparation creates an automatic snapshot before changes", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const plan = await preparePhoneInstallUpdate(store, { kind: "date", date: sampleDayRecord.date });

  assert.equal(plan.scope.kind, "date");
  assert.equal(plan.snapshot.days.length, 1);
  assert.equal(plan.snapshot.days[0]?.date, sampleDayRecord.date);
  assert.equal(plan.recoveryPreview.preview, true);
  assert.equal(plan.safetyRules[0], "Automatic snapshot captured before update preparation.");
});

test("phoneInstall reset stays blocked until confirmation and clears on explicit approval", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const blocked = await performExplicitPhoneInstallReset(store, { confirmed: false });
  const afterBlocked = await store.listDates();
  const applied = await performExplicitPhoneInstallReset(store, { confirmed: true });
  const afterApplied = await store.listDates();

  assert.equal(blocked.blocked, true);
  assert.equal(blocked.reset, undefined);
  assert.equal(afterBlocked.length, 1);
  assert.equal(applied.blocked, false);
  assert.equal(applied.reset?.clearedCount, 1);
  assert.equal(afterApplied.length, 0);
  assert.equal(applied.snapshot.days.length, 1);
});

test("phoneInstall recovery routes to preview, copy, and overwrite workflows", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const backup = await store.createBackup();
  const preview = await recoverPhoneInstall(store, { file: backup, mode: "preview" });
  const copy = await recoverPhoneInstall(store, { file: backup, mode: "copy" });
  const overwrite = await recoverPhoneInstall(store, { file: backup, mode: "overwrite" });

  assert.equal(preview.preview, true);
  assert.equal(copy.mode, "copy");
  assert.equal(overwrite.mode, "overwrite");
});

test("MemoryDayStore saves and reads cloned DayRecord values", async () => {
  const store = new MemoryDayStore();
  const save = await store.saveDay(sampleDayRecord);
  const loaded = await store.getDay(sampleDayRecord.date);

  assert.equal(save.created, true);
  assert.deepEqual(loaded, sampleDayRecord);
  assert.notEqual(loaded, sampleDayRecord);

  if (loaded) {
    loaded.timeline = [];
  }

  const loadedAgain = await store.getDay(sampleDayRecord.date);
  assert.equal(loadedAgain?.timeline.length, sampleDayRecord.timeline.length);
});

test("MemoryDayStore lists date summaries without derived report/log storage", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const summaries = await store.listDates();

  assert.deepEqual(summaries, [createDateSummary(sampleDayRecord)]);
  assert.equal(Object.hasOwn(sampleDayRecord, "logs"), false);
  assert.equal(Object.hasOwn(sampleDayRecord, "reportText"), false);
});

test("MemoryDayStore creates date-scoped backups", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const backup = await store.createBackup({
    kind: "date",
    date: sampleDayRecord.date,
  });

  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.app, PHONE_INSTALL_BACKUP_APP);
  assert.equal(backup.backupType, PHONE_INSTALL_BACKUP_TYPE);
  assert.equal(backup.scope.kind, "date");
  assert.equal(backup.days.length, 1);
  assert.deepEqual(backup.days[0], sampleDayRecord);
  assert.notEqual(backup.days[0], sampleDayRecord);
});

test("MemoryDayStore previews imports without mutating existing data", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const backup = await store.createBackup();
  const result = await store.importBackup(backup, { mode: "preview" });
  const loaded = await store.getDay(sampleDayRecord.date);

  assert.equal(result.preview, true);
  assert.equal(result.imported.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]?.reason, "existing_day_preview");
  assert.deepEqual(loaded, sampleDayRecord);
});

test("MemoryDayStore copy import never overwrites existing dates", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const backup = await store.createBackup();
  const result = await store.importBackup(backup, { mode: "copy" });
  const dates = await store.listDates();
  const original = await store.getDay(sampleDayRecord.date);

  assert.equal(result.imported.length, 1);
  assert.equal(dates.length, 2);
  assert.equal(original?.date, sampleDayRecord.date);
  assert.equal(result.imported[0]?.recoveryStatus, "needsReview");
});

test("backupImportExport wraps store backup and import workflows", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const backup = await exportBackup(store, { scope: { kind: "date", date: sampleDayRecord.date } });
  const preview = await previewBackupImport(store, backup);
  const copy = await copyBackupImport(store, backup);
  const overwrite = await overwriteBackupImport(store, backup);
  const run = await runBackupImport(store, { file: backup, options: { mode: "preview" } });
  const copiedDay = createBackupCopyDay(sampleDayRecord);

  assert.equal(PHONE_INSTALL_BACKUP_FILENAME.endsWith(".json"), true);
  assert.equal(backup.app, PHONE_INSTALL_BACKUP_APP);
  assert.equal(backup.backupType, PHONE_INSTALL_BACKUP_TYPE);
  assert.equal(backup.scope.kind, "date");
  assert.equal(backup.days.length, 1);
  assert.equal(preview.preview, true);
  assert.equal(copy.mode, "copy");
  assert.equal(overwrite.mode, "overwrite");
  assert.equal(run.mode, "preview");
  assert.equal(copiedDay.meta.recoveryStatus, "needsReview");
  assert.notEqual(copiedDay.date, sampleDayRecord.date);
  assert.notEqual(copiedDay.id, sampleDayRecord.id);
});

test("backupImportExport rejects field app backups for direct restore", async () => {
  const store = new MemoryDayStore([sampleDayRecord]);
  const backup = await exportBackup(store);
  const fieldBackup = {
    ...backup,
    app: FIELD_APP_BACKUP_APP,
    backupType: "full-localStorage",
  };

  await assert.rejects(
    () => previewBackupImport(store, fieldBackup),
    /Field app backups must be imported through migration/,
  );
});

test("fieldAppMigration converts Season2 PWA backup details into DayRecord", () => {
  const fieldBackup = createSampleFieldAppBackup();
  const migration = migrateFieldAppBackup(fieldBackup, { appVersion: "field-test" });
  const day = migration.days[0];

  assert.equal(migration.inspection.candidateCount, 1);
  assert.equal(migration.statusCounts.complete, 1);
  assert.equal(day?.date, "2026-05-21");
  assert.equal(day?.meta.migrationSource, "fieldAppBackup");
  assert.equal(day?.meta.appVersion, "field-test");
  assert.equal(day?.zones.length, 2);
  assert.equal(day?.zones[0]?.name, "miju");
  assert.equal(day?.zones[1]?.name, "hils");
  assert.equal(day?.zones[1]?.sortingStartEventId, "field-2026-05-21-sorting-start-2");
  assert.equal(day?.zones[1]?.sortingEndEventId, "field-2026-05-21-sorting-end-2");

  const hils = calculateZone(day!, day!.zones[1]!.id);
  assert.equal(hils.movementMinutes, 30);
  assert.equal(hils.sortingMinutes, 24);
  assert.equal(hils.deliveryMinutes, 107);
  assert.equal(hils.counts.delivered, 117);
});

test("backupImportExport imports field app backups through migration path", async () => {
  const store = new MemoryDayStore();
  const fieldBackup = createSampleFieldAppBackup();
  const migration = buildFieldAppMigrationBackup(fieldBackup);
  const preview = await importFieldAppBackupMigration(store, {
    source: fieldBackup,
    options: { mode: "preview" },
  });
  const copy = await importFieldAppBackupMigration(store, {
    source: fieldBackup,
    options: { mode: "copy" },
  });
  const loaded = await store.getDay("2026-05-21");

  assert.equal(migration.backup.app, PHONE_INSTALL_BACKUP_APP);
  assert.equal(migration.backup.backupType, PHONE_INSTALL_BACKUP_TYPE);
  assert.equal(migration.backup.days.length, 1);
  assert.equal(migration.report.migratedCount, 1);
  assert.equal(preview.preview, true);
  assert.equal(copy.imported.length, 1);
  assert.equal(loaded?.date, "2026-05-21");
  assert.equal(loaded?.meta.migrationSource, "fieldAppBackup");
});

test("fieldAppMigration accepts preserved, array, single-day, and summary export formats", () => {
  const single = createSampleFieldAppDay("2026-05-22", 40, 20, 10);
  const preserved = {
    app: "delivery-master-season2",
    exportedAt: "2026-05-22T02:08:17.600Z",
    totalDays: 2,
    details: [
      single,
      createSampleFieldAppDay("2026-05-23", 12, 6, 0),
    ],
  };
  const arrayResult = migrateFieldAppBackup([single]);
  const singleResult = migrateFieldAppBackup(single);
  const preservedResult = migrateFieldAppBackup(preserved);
  const summaryResult = migrateFieldAppBackup({
    app: "delivery-master-season2",
    summaries: {
      "2026-05-24": {
        date: "2026-05-24",
        zones: {
          "miju": { type: "miju", qty: 10, mijuData: { a1: 1, a2: 2, a3: 3, bTotal: 4 } },
          "hils": { type: "hils", qty: 5 },
        },
      },
    },
  });

  assert.equal(arrayResult.days.length, 1);
  assert.equal(singleResult.days.length, 1);
  assert.equal(preservedResult.days.length, 2);
  assert.equal(preservedResult.inspection.detectedKinds.includes("preservedFieldAppBackup"), true);
  assert.equal(summaryResult.days.length, 1);
  assert.equal(calculateDay(summaryResult.days[0]!).totals.deliveredCount, 15);
  const mijuStart = summaryResult.days[0]?.timeline.find((event) => event.type === "zone_start" && event.zoneId?.includes("miju"));
  assert.equal(mijuStart?.payload?.mijuA, 6);
});

test("legacyMigration keeps structured day records complete", () => {
  const legacy = {
    date: "2026-05-16",
    timeline: sampleDayRecord.timeline,
    zones: sampleDayRecord.zones,
    helpers: sampleDayRecord.helpers,
    adjustments: sampleDayRecord.adjustments,
  };

  const inspection = inspectLegacySource(legacy);
  const result = migrateLegacySource(legacy, { appVersion: "1.0.0", deviceId: "fixture-device" });
  const report = buildMigrationReport(result);

  assert.equal(inspection.candidateCount, 1);
  assert.equal(result.days.length, 1);
  assert.equal(result.statusCounts.complete, 1);
  assert.equal(result.days[0]?.meta.recoveryStatus, "complete");
  assert.equal(result.days[0]?.status, "closed");
  assert.equal(result.days[0]?.meta.appVersion, "1.0.0");
  assert.equal(report.text.includes("Complete: 1"), true);
});

test("legacyMigration can recover logsByDate and text-only records", () => {
  const legacy = {
    logsByDate: {
      "2026-05-15": [
        { at: "2026-05-15T08:00:00+09:00", type: "zone_start", zoneId: "zone-b", text: "start" },
        { at: "2026-05-15T09:00:00+09:00", total: 12, delivered: 10, failed: 1, extra: 1 },
      ],
    },
    reportText: "legacy summary",
  };

  const result = migrateLegacySource(legacy);

  assert.equal(result.days.length >= 2, true);
  assert.equal(result.statusCounts.partial >= 1 || result.statusCounts.textOnly >= 1, true);
  assert.equal(result.inspection.detectedKinds.includes("logs"), true);
  assert.equal(result.inspection.detectedKinds.includes("reportText"), true);
});

test("legacyMigration reports failure for empty input", () => {
  const result = migrateLegacySource(null);

  assert.equal(result.days.length, 0);
  assert.equal(result.statusCounts.failed, 1);
  assert.equal(result.warnings[0]?.code, "no_legacy_content");
});

function createSampleFieldAppBackup(): Record<string, unknown> {
  const day = {
    date: "2026-05-21",
    state: {
      phase: "finished",
      departTime: "2026-05-21T11:29:00",
      arriveTime: "2026-05-21T12:19:00",
      finishTime: "2026-05-21T17:30:00",
      results: [
        {
          zIdx: 0,
          name: "miju",
          type: "miju",
          startTime: "2026-05-21T12:19:00",
          endTime: "2026-05-21T14:48:00",
          qty: 169,
          mijuData: { aTotal: 73, bTotal: 96 },
        },
        {
          zIdx: 1,
          name: "hils",
          type: "hils",
          startTime: "2026-05-21T14:49:00",
          endTime: "2026-05-21T17:30:00",
          cuStart: "2026-05-21T15:18:00",
          cuEnd: "2026-05-21T15:42:00",
          qty: 117,
        },
      ],
      events: [],
      helpers: [],
      logs: [],
    },
    summary: {
      date: "2026-05-21",
      totalQty: 286,
      expQty: 285,
      scanMiss: 1,
    },
    reportText: "field report",
    savedAt: "2026-05-21T17:30:00",
  };

  return {
    app: FIELD_APP_BACKUP_APP,
    backupType: "full-localStorage",
    details: [day],
    days: {
      "2026-05-21": day,
    },
    storageItems: {
      dm2_all_dates: JSON.stringify(["2026-05-21"]),
      "dm2_report_2026-05-21": JSON.stringify(day),
      "dm2_logs_2026-05-21": JSON.stringify([]),
    },
  };
}

function createSampleFieldAppDay(
  date: string,
  mijuQty: number,
  hilsQty: number,
  alternateQty: number,
): Record<string, unknown> {
  const results: Record<string, unknown>[] = [
    {
      zIdx: 0,
      name: "miju",
      type: "miju",
      startTime: `${date}T12:19:00`,
      endTime: `${date}T14:48:00`,
      qty: mijuQty,
      mijuData: { aTotal: 73, bTotal: Math.max(0, mijuQty - 73) },
    },
    {
      zIdx: 1,
      name: "hils",
      type: "hils",
      startTime: `${date}T14:49:00`,
      endTime: `${date}T17:30:00`,
      cuStart: `${date}T15:18:00`,
      cuEnd: `${date}T15:42:00`,
      qty: hilsQty,
    },
  ];
  if (alternateQty > 0) {
    results.push({
      zIdx: 2,
      name: "alternate",
      type: "alt",
      startTime: `${date}T17:30:00`,
      endTime: `${date}T18:00:00`,
      qty: alternateQty,
    });
  }

  return {
    date,
    state: {
      phase: "finished",
      departTime: `${date}T11:29:00`,
      arriveTime: `${date}T12:19:00`,
      finishTime: `${date}T18:00:00`,
      results,
      events: [],
      helpers: [],
      logs: [],
    },
    summary: {
      date,
      totalQty: mijuQty + hilsQty + alternateQty,
      expQty: mijuQty + hilsQty + alternateQty,
      scanMiss: 0,
    },
    reportText: "field report",
    savedAt: `${date}T18:00:00`,
  };
}

function createQuantityComparisonDay(
  date: string,
  mijuQty: number,
  hilsQty: number,
  alternateQty: number,
): DayRecord {
  const zoneInputs = [
    { id: "miju", name: "miju", quantity: mijuQty, order: 1 },
    { id: "hils", name: "hils", quantity: hilsQty, order: 2 },
    { id: "alt-1", name: "alternate", quantity: alternateQty, order: 3 },
  ];
  const timeline: TimelineEvent[] = [
    createSimpleEvent("depart", "depart_jinjeop", `${date}T08:00:00+09:00`),
    createSimpleEvent("arrive", "arrive_cheongnyangni", `${date}T08:30:00+09:00`),
  ];
  const zones = zoneInputs.map((zone, index) => {
    const startId = `${zone.id}-start`;
    const endId = `${zone.id}-end`;
    const hour = 9 + index;
    timeline.push({
      id: startId,
      type: "zone_start",
      at: `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`,
      zoneId: zone.id,
      payload: { zoneName: zone.name, order: zone.order },
      source: "manual",
      createdAt: `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`,
      updatedAt: `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`,
    });
    timeline.push({
      id: endId,
      type: "zone_end",
      at: `${date}T${String(hour).padStart(2, "0")}:30:00+09:00`,
      zoneId: zone.id,
      payload: {
        total: zone.quantity,
        delivered: zone.quantity,
        failed: 0,
        extra: 0,
      },
      source: "manual",
      createdAt: `${date}T${String(hour).padStart(2, "0")}:30:00+09:00`,
      updatedAt: `${date}T${String(hour).padStart(2, "0")}:30:00+09:00`,
    });
    return {
      id: zone.id,
      name: zone.name,
      order: zone.order,
      startEventId: startId,
      endEventId: endId,
    };
  });
  timeline.push(createSimpleEvent("close", "day_close", `${date}T13:00:00+09:00`));

  return {
    schemaVersion: 1,
    id: `day-${date}`,
    date,
    status: "closed",
    timeline,
    zones,
    helpers: [],
    adjustments: [],
    meta: {
      createdAt: `${date}T08:00:00+09:00`,
      updatedAt: `${date}T13:00:00+09:00`,
      recoveryStatus: "none",
    },
  };
}

function createUnpaidHelperDay(date: string, finishAt?: string): DayRecord {
  const arriveAt = `${date}T08:45:00+09:00`;
  const timeline: TimelineEvent[] = [
    {
      id: "depart",
      type: "depart_jinjeop",
      at: `${date}T08:00:00+09:00`,
      payload: { total: 0, helperDay: true },
      source: "manual",
      createdAt: `${date}T08:00:00+09:00`,
      updatedAt: `${date}T08:00:00+09:00`,
    },
    createSimpleEvent("arrive", "arrive_cheongnyangni", arriveAt),
  ];

  if (finishAt) {
    timeline.push({
      id: "helper",
      type: "helper_add",
      at: finishAt,
      payload: {
        helperId: "helper-day",
        name: "unpaid helper",
        action: "add",
        unpaid: true,
        minutes: Math.round((Date.parse(finishAt) - Date.parse(arriveAt)) / 60000),
      },
      source: "manual",
      createdAt: finishAt,
      updatedAt: finishAt,
    });
    timeline.push(createSimpleEvent("close", "day_close", finishAt));
  }

  return {
    schemaVersion: 1,
    id: `day-${date}`,
    date,
    status: finishAt ? "closed" : "active",
    timeline,
    zones: [],
    helpers: finishAt ? [
      {
        id: "helper-day",
        name: "unpaid helper",
        linkedEventIds: ["helper"],
      },
    ] : [],
    adjustments: [],
    meta: {
      createdAt: `${date}T08:00:00+09:00`,
      updatedAt: finishAt ?? arriveAt,
      recoveryStatus: "none",
    },
  };
}

function createSimpleEvent(
  id: string,
  type: TimelineEvent["type"],
  at: string,
): TimelineEvent {
  return {
    id,
    type,
    at,
    source: "manual",
    createdAt: at,
    updatedAt: at,
  };
}

let passed = 0;

for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} domain tests passed`);
