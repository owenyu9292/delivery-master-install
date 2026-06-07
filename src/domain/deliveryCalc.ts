import { sortTimeline } from "./eventTimeline";
import type {
  CalculationWarning,
  CountPayload,
  DayCalculation,
  DayCalculationTotals,
  DayRecord,
  TimelineEvent,
  ZoneCalculation,
  ZoneCountsCache,
} from "./types";

export function calculateDay(dayRecord: DayRecord): DayCalculation {
  const warnings: CalculationWarning[] = [];
  const zones = dayRecord.zones.map((zone) =>
    calculateZone(dayRecord, zone.id, warnings),
  );
  const totals = calculateTotals(dayRecord, zones);

  return {
    date: dayRecord.date,
    zones,
    totals,
    warnings,
  };
}

export function calculateZone(
  dayRecord: DayRecord,
  zoneId: string,
  warnings: CalculationWarning[] = [],
): ZoneCalculation {
  const zone = dayRecord.zones.find((candidate) => candidate.id === zoneId);
  const zoneEvents = sortTimeline(
    dayRecord.timeline.filter((event) => event.zoneId === zoneId),
  );
  const sourceEventIds = new Set<string>();

  if (!zone) {
    warnings.push({
      code: "missing_zone",
      message: `Missing zone: ${zoneId}`,
      zoneId,
    });
  }

  const start = findEventTime(dayRecord, zone?.startEventId, "zone_start", zoneId);
  const sortingStart = findEventTime(
    dayRecord,
    zone?.sortingStartEventId,
    "sorting_start",
    zoneId,
  );
  const sortingEnd = findEventTime(
    dayRecord,
    zone?.sortingEndEventId,
    "sorting_end",
    zoneId,
  );
  const deliveryStart = findEventTime(
    dayRecord,
    zone?.deliveryStartEventId,
    "delivery_start",
    zoneId,
  );
  const end = findEventTime(dayRecord, zone?.endEventId, "zone_end", zoneId);
  const counts = calculateZoneCounts(zoneEvents, sourceEventIds);

  warnIfMissing(warnings, zoneId, "zone_start", start, zone?.startEventId);
  warnIfMissing(warnings, zoneId, "zone_end", end, zone?.endEventId);

  const elapsedMinutes = diffMinutes(start, end);
  const movementMinutes = calculateMovementMinutes(dayRecord, zoneId, sortingStart);
  const sortingMinutes = diffMinutes(sortingStart, sortingEnd);
  const baseDeliveryMinutes = calculateDeliveryMinutes({
    start,
    movementMinutes,
    sortingStart,
    sortingEnd,
    deliveryStart,
    end,
  });
  const eventMinutes = calculateIncidentMinutes(zoneEvents, sourceEventIds);
  const deliveryMinutes =
    baseDeliveryMinutes === undefined ? undefined : Math.max(0, baseDeliveryMinutes - eventMinutes);
  const efficiencyPerHour = calculateEfficiencyPerHour(counts.delivered, deliveryMinutes);

  return {
    zoneId,
    elapsedMinutes,
    movementMinutes,
    sortingMinutes,
    deliveryMinutes,
    eventMinutes,
    counts,
    efficiencyPerHour,
    sourceEventIds: [...sourceEventIds],
  };
}

export function validateCalculation(dayRecord: DayRecord): CalculationWarning[] {
  return calculateDay(dayRecord).warnings;
}

function calculateTotals(
  dayRecord: DayRecord,
  zones: ZoneCalculation[],
): DayCalculationTotals {
  const firstEvent = sortTimeline(dayRecord.timeline)[0];
  const closeEvent = [...sortTimeline(dayRecord.timeline)]
    .reverse()
    .find((event) => event.type === "day_close");
  const deliveryMinutes = sumDefined(zones.map((zone) => zone.deliveryMinutes));
  const zoneTotalCount = sumDefined(zones.map((zone) => zone.counts.total));
  const zoneDeliveredCount = sumDefined(zones.map((zone) => zone.counts.delivered));
  const helperCounts = calculateReceivedHelperCounts(dayRecord);
  const deliveredCount = zoneDeliveredCount + helperCounts.free + helperCounts.paid;
  const efficiencyCount = zoneDeliveredCount + helperCounts.paid;

  return {
    totalCount: zoneTotalCount + helperCounts.free + helperCounts.paid,
    deliveredCount,
    efficiencyCount,
    helperFreeCount: helperCounts.free,
    helperPaidCount: helperCounts.paid,
    failedCount: sumDefined(zones.map((zone) => zone.counts.failed)),
    extraCount: sumDefined(zones.map((zone) => zone.counts.extra)),
    totalElapsedMinutes: diffMinutes(firstEvent?.at, closeEvent?.at),
    deliveryMinutes,
    efficiencyPerHour: calculateEfficiencyPerHour(efficiencyCount, deliveryMinutes),
  };
}

function calculateReceivedHelperCounts(dayRecord: DayRecord): { free: number; paid: number } {
  const counts = { free: 0, paid: 0 };
  for (const event of dayRecord.timeline) {
    if (event.type !== "helper_add" || !event.payload) continue;
    const payload = event.payload as {
      helperKind?: unknown;
      quantity?: unknown;
      unpaid?: unknown;
    };
    const quantity = typeof payload.quantity === "number" && Number.isFinite(payload.quantity)
      ? payload.quantity
      : 0;
    if (quantity <= 0 || payload.unpaid === true) continue;
    if (payload.helperKind === "paid_received") counts.paid += quantity;
    if (payload.helperKind === "free_received") counts.free += quantity;
  }
  return counts;
}

function calculateEfficiencyPerHour(deliveredCount: number, deliveryMinutes?: number): number | undefined {
  if (deliveryMinutes === undefined || deliveryMinutes < 1) return undefined;
  return deliveredCount / (deliveryMinutes / 60);
}

function calculateZoneCounts(
  zoneEvents: TimelineEvent[],
  sourceEventIds: Set<string>,
): ZoneCountsCache {
  const counts: ZoneCountsCache = {
    total: 0,
    delivered: 0,
    failed: 0,
    extra: 0,
  };

  for (const event of zoneEvents) {
    if (!event.payload) {
      continue;
    }

    if (event.type === "manual_adjust") {
      applyManualAdjust(counts, event, sourceEventIds);
      continue;
    }

    const payload = event.payload as CountPayload;
    let used = false;

    if (typeof payload.total === "number") {
      counts.total = payload.total;
      used = true;
    }
    if (typeof payload.delivered === "number") {
      counts.delivered = payload.delivered;
      used = true;
    }
    if (typeof payload.failed === "number") {
      counts.failed = payload.failed;
      used = true;
    }
    if (typeof payload.extra === "number") {
      counts.extra = payload.extra;
      used = true;
    }

    if (used) {
      sourceEventIds.add(event.id);
    }
  }

  return counts;
}

function applyManualAdjust(
  counts: ZoneCountsCache,
  event: TimelineEvent,
  sourceEventIds: Set<string>,
): void {
  const payload = event.payload as {
    field?: string;
    after?: unknown;
  };

  if (typeof payload.after !== "number") {
    return;
  }

  switch (payload.field) {
    case "payload.total":
    case "total":
      counts.total = payload.after;
      sourceEventIds.add(event.id);
      break;
    case "payload.delivered":
    case "delivered":
      counts.delivered = payload.after;
      sourceEventIds.add(event.id);
      break;
    case "payload.failed":
    case "failed":
      counts.failed = payload.after;
      sourceEventIds.add(event.id);
      break;
    case "payload.extra":
    case "extra":
      counts.extra = payload.after;
      sourceEventIds.add(event.id);
      break;
    default:
      break;
  }
}

function calculateIncidentMinutes(
  zoneEvents: TimelineEvent[],
  sourceEventIds: Set<string>,
): number {
  let total = 0;
  for (const event of zoneEvents) {
    if (event.type !== "incident" || !event.payload) continue;
    const payload = event.payload as { minutes?: unknown; affectsEfficiency?: unknown };
    if (payload.affectsEfficiency === false || typeof payload.minutes !== "number") continue;
    if (payload.minutes <= 0) continue;
    total += payload.minutes;
    sourceEventIds.add(event.id);
  }
  return total;
}

function findEventTime(
  dayRecord: DayRecord,
  eventId: string | undefined,
  type: TimelineEvent["type"],
  zoneId: string,
): string | undefined {
  if (eventId) {
    return dayRecord.timeline.find((event) => event.id === eventId)?.at;
  }

  return sortTimeline(dayRecord.timeline).find(
    (event) => event.zoneId === zoneId && event.type === type,
  )?.at;
}

function warnIfMissing(
  warnings: CalculationWarning[],
  zoneId: string,
  eventType: string,
  value: string | undefined,
  eventId?: string,
): void {
  if (value) {
    return;
  }

  warnings.push({
    code: "missing_calculation_event",
    message: `Missing ${eventType} for zone ${zoneId}`,
    eventIds: eventId ? [eventId] : undefined,
    zoneId,
  });
}

function diffMinutes(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) {
    return undefined;
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return undefined;
  }

  return (endMs - startMs) / 60000;
}

function calculateMovementMinutes(
  dayRecord: DayRecord,
  zoneId: string,
  sortingStart: string | undefined,
): number | undefined {
  const zone = dayRecord.zones.find((candidate) => candidate.id === zoneId);
  if (!zone || zone.order <= 1 || !sortingStart) {
    return undefined;
  }

  const previousZone = [...dayRecord.zones]
    .filter((candidate) => candidate.order < zone.order)
    .sort((a, b) => b.order - a.order)[0];
  if (!previousZone) {
    return undefined;
  }

  const previousEnd = findEventTime(
    dayRecord,
    previousZone.endEventId,
    "zone_end",
    previousZone.id,
  );
  const minutes = diffMinutes(previousEnd, sortingStart);
  if (minutes === undefined) {
    return undefined;
  }

  return minutes < 1 ? 5 : minutes;
}

function calculateDeliveryMinutes(input: {
  start: string | undefined;
  movementMinutes: number | undefined;
  sortingStart: string | undefined;
  sortingEnd: string | undefined;
  deliveryStart: string | undefined;
  end: string | undefined;
}): number | undefined {
  const { start, movementMinutes, sortingStart, sortingEnd, deliveryStart, end } = input;

  if (!start || !end) {
    return undefined;
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const sortingStartMs = sortingStart ? Date.parse(sortingStart) : undefined;
  const sortingEndMs = sortingEnd ? Date.parse(sortingEnd) : undefined;
  const deliveryStartMs = deliveryStart ? Date.parse(deliveryStart) : undefined;

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return undefined;
  }

  if (deliveryStartMs !== undefined && !Number.isNaN(deliveryStartMs)) {
    if (
      sortingStartMs !== undefined &&
      !Number.isNaN(sortingStartMs) &&
      sortingStartMs > deliveryStartMs &&
      sortingStartMs <= endMs
    ) {
      return (sortingStartMs - deliveryStartMs) / 60000;
    }

    return endMs >= deliveryStartMs ? (endMs - deliveryStartMs) / 60000 : undefined;
  }

  if (
    sortingStartMs !== undefined &&
    sortingEndMs !== undefined &&
    !Number.isNaN(sortingStartMs) &&
    !Number.isNaN(sortingEndMs) &&
    sortingStartMs >= startMs &&
    sortingEndMs <= endMs
  ) {
    const elapsed = endMs - startMs;
    const sorting = sortingEndMs - sortingStartMs;
    const movement = (movementMinutes ?? 0) * 60000;
    if (sorting < 0 || elapsed < sorting) {
      return undefined;
    }

    return Math.max(0, (elapsed - sorting - movement) / 60000);
  }

  return (endMs - startMs) / 60000;
}

function sumDefined(values: Array<number | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
