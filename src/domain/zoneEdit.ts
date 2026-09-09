import { sortTimeline } from "./eventTimeline";
import { linkTimePatches } from "./timeLinks";
import { getZoneKind } from "./zoneIdentity";
import type { AdjustmentRecord, DayRecord, TimelineEvent, TimelineEventPayload } from "./types";

export interface CompletedZoneEditInput {
  zoneId: string;
  startAt?: string;
  deliveryStartAt?: string;
  sortingStartAt?: string;
  sortingEndAt?: string;
  endAt?: string;
  delivered?: number;
  failed?: number;
  extra?: number;
  mijuA?: number;
  mijuB?: number;
  miju1?: number;
  miju2?: number;
  miju3?: number;
  mijuRest?: number;
  reason?: string;
}

export function applyCompletedZoneEdit(dayRecord: DayRecord, input: CompletedZoneEditInput): DayRecord {
  const zone = dayRecord.zones.find((candidate) => candidate.id === input.zoneId);
  if (!zone) return dayRecord;

  const now = new Date().toISOString();
  const updates = linkTimePatches(dayRecord, buildEventUpdates(dayRecord, input, zone));
  if (updates.size === 0) return dayRecord;

  const timeline = sortTimeline(dayRecord.timeline.map((event) => {
    const patch = updates.get(event.id);
    return patch ? { ...event, ...patch, updatedAt: now } : event;
  }));
  const adjustment: AdjustmentRecord = {
    id: createAdjustmentId(dayRecord, now),
    eventId: zone.endEventId,
    reason: input.reason ?? "completed_zone_edit",
    note: `Edited zone ${zone.id}; linked events: ${[...updates.keys()].join(", ")}`,
    createdAt: now,
  };

  return {
    ...dayRecord,
    timeline,
    zones: dayRecord.zones.map((candidate) =>
      candidate.id === zone.id
        ? {
            ...candidate,
            counts: undefined,
            countsSourceEventIds: undefined,
            countsCalculatedAt: undefined,
          }
        : candidate,
    ),
    adjustments: [...dayRecord.adjustments, adjustment],
    meta: {
      ...dayRecord.meta,
      updatedAt: now,
      recoveryStatus: dayRecord.meta.recoveryStatus === "none" ? "needsReview" : dayRecord.meta.recoveryStatus,
    },
  };
}

function buildEventUpdates(
  dayRecord: DayRecord,
  input: CompletedZoneEditInput,
  zone: DayRecord["zones"][number],
): Map<string, Partial<TimelineEvent>> {
  const updates = new Map<string, Partial<TimelineEvent>>();
  const start = findZoneEvent(dayRecord, input.zoneId, "zone_start");
  const deliveryStart = findZoneEvent(dayRecord, input.zoneId, "delivery_start");
  const sortingStart = findZoneEvent(dayRecord, input.zoneId, "sorting_start");
  const sortingEnd = findZoneEvent(dayRecord, input.zoneId, "sorting_end");
  const end = findZoneEvent(dayRecord, input.zoneId, "zone_end");

  if (start && input.startAt) updates.set(start.id, { at: input.startAt });
  const manualDeliveryStartChanged =
    deliveryStart &&
    isAutoCorrectedDeliveryStart(deliveryStart) &&
    input.deliveryStartAt !== undefined &&
    input.deliveryStartAt !== deliveryStart.at;
  if (deliveryStart && input.deliveryStartAt) {
    updates.set(deliveryStart.id, {
      at: input.deliveryStartAt,
      ...(manualDeliveryStartChanged ? { payload: clearAutoCorrectionFlag(deliveryStart.payload) } : {}),
    });
  }
  if (sortingStart && input.sortingStartAt) updates.set(sortingStart.id, { at: input.sortingStartAt });
  if (sortingEnd && input.sortingEndAt) {
    updates.set(sortingEnd.id, { at: input.sortingEndAt });
  }
  if (end) {
    const nextPayload = buildZoneEndPayload(
      end.payload,
      input,
      getZoneKind(zone) === "miju",
    );
    const patch: Partial<TimelineEvent> = {};
    if (input.endAt) patch.at = input.endAt;
    if (nextPayload) patch.payload = nextPayload;
    if (Object.keys(patch).length > 0) updates.set(end.id, patch);
  }

  return updates;
}

function buildZoneEndPayload(
  payload: TimelineEventPayload | undefined,
  input: CompletedZoneEditInput,
  isMiju: boolean,
): TimelineEventPayload | undefined {
  const previous = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const failed = input.failed ?? numberOr(previous.failed, 0);
  const extra = input.extra ?? numberOr(previous.extra, 0);
  const hasMijuBuildings =
    input.miju1 !== undefined ||
    input.miju2 !== undefined ||
    input.miju3 !== undefined ||
    input.mijuRest !== undefined;
  const delivered = hasMijuBuildings
    ? (input.miju1 ?? 0) + (input.miju2 ?? 0) + (input.miju3 ?? 0) + (input.mijuRest ?? 0)
    : input.delivered !== undefined
      ? input.delivered
    : input.mijuA !== undefined || input.mijuB !== undefined
      ? (input.mijuA ?? 0) + (input.mijuB ?? 0)
    : input.delivered;
  const previousA = numberOrOptional(previous.aTotal);
  const previousB = numberOrOptional(previous.bTotal);
  const suppliedBChanged = input.mijuB !== undefined && input.mijuB !== previousB;
  const shouldRecalculateRetainedB =
    isMiju &&
    !hasMijuBuildings &&
    input.delivered !== undefined &&
    previousA !== undefined &&
    previousB !== undefined &&
    !suppliedBChanged;

  if (delivered === undefined && input.failed === undefined && input.extra === undefined) {
    return undefined;
  }

  return {
    ...previous,
    total: delivered ?? numberOr(previous.total, 0),
    delivered: delivered ?? numberOr(previous.delivered, 0),
    failed,
    extra,
    ...(hasMijuBuildings
      ? {
          building1Total: input.miju1 ?? 0,
          building2Total: input.miju2 ?? 0,
          building3Total: input.miju3 ?? 0,
          restTotal: input.mijuRest ?? 0,
          aTotal: (input.miju1 ?? 0) + (input.miju2 ?? 0) + (input.miju3 ?? 0),
          bTotal: input.mijuRest ?? 0,
        }
      : {}),
    ...(input.mijuA !== undefined || input.mijuB !== undefined
      ? shouldRecalculateRetainedB
        ? retainedMijuBFields(
            input.mijuA ?? previousA ?? 0,
            Math.max(0, input.delivered! - (input.mijuA ?? previousA!)),
            previous,
          )
        : {
            aTotal: input.mijuA ?? previousA ?? 0,
            bTotal: input.mijuB ?? previousB ?? 0,
          }
      : shouldRecalculateRetainedB
        ? retainedMijuBFields(previousA!, Math.max(0, input.delivered! - previousA!), previous)
      : {}),
  };
}

function retainedMijuBFields(
  aTotal: number,
  bTotal: number,
  previous: Record<string, unknown>,
): Record<string, number> {
  return {
    aTotal,
    bTotal,
    ...(Object.hasOwn(previous, "restTotal") ? { restTotal: bTotal } : {}),
    ...(Object.hasOwn(previous, "mijuRest") ? { mijuRest: bTotal } : {}),
  };
}

function clearAutoCorrectionFlag(payload: TimelineEventPayload | undefined): TimelineEventPayload {
  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    autoCorrected: false,
  };
}
function isAutoCorrectedDeliveryStart(event: TimelineEvent): boolean {
  return (event.payload as Record<string, unknown> | undefined)?.autoCorrected === true;
}

function findZoneEvent(
  dayRecord: DayRecord,
  zoneId: string,
  type: TimelineEvent["type"],
): TimelineEvent | undefined {
  return sortTimeline(dayRecord.timeline).find((event) => event.zoneId === zoneId && event.type === type);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createAdjustmentId(dayRecord: DayRecord, now: string): string {
  const base = `adjust-${now.replace(/[^0-9]/g, "").slice(0, 14)}`;
  if (!dayRecord.adjustments.some((adjustment) => adjustment.id === base)) return base;

  let index = 2;
  while (dayRecord.adjustments.some((adjustment) => adjustment.id === `${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}
