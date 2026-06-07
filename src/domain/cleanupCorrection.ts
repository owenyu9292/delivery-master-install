import { createEvent, updateEvent } from "./eventTimeline";
import type { DayRecord, TimelineEvent } from "./types";

export interface CleanupCorrectionRequest {
  zoneId: string;
  closeAt: string;
  minutes: number;
  source?: "zone_close_prompt" | "day_close_prompt" | "post_edit";
  note?: string;
}

export interface CleanupCorrectionResult {
  dayRecord: DayRecord;
  sortingStartAt: string;
  sortingEndAt: string;
  minutes: number;
  sourceEventIds: string[];
}

export function hasMissingCleanupFinish(dayRecord: DayRecord, zoneId: string): boolean {
  const zoneEvents = dayRecord.timeline.filter((event) => event.zoneId === zoneId);
  const hasSortingStart = zoneEvents.some((event) => event.type === "sorting_start");
  const hasSortingEnd = zoneEvents.some((event) => event.type === "sorting_end");

  return hasSortingStart && !hasSortingEnd;
}

export function applyMissingCleanupCorrection(
  dayRecord: DayRecord,
  request: CleanupCorrectionRequest,
): CleanupCorrectionResult {
  if (!Number.isFinite(request.minutes) || request.minutes <= 0) {
    throw new Error("cleanup correction minutes must be greater than 0");
  }

  const closeTime = Date.parse(request.closeAt);
  if (Number.isNaN(closeTime)) {
    throw new Error("cleanup correction closeAt must be a valid ISO date");
  }

  const sortingStartAt = new Date(closeTime - request.minutes * 60000).toISOString();
  const sortingEndAt = new Date(closeTime).toISOString();
  const source = request.source ?? "zone_close_prompt";
  const note = request.note ?? "Missing cleanup finish corrected from field prompt.";
  const existingStart = findLatestZoneEvent(dayRecord, request.zoneId, "sorting_start");
  const existingEnd = findLatestZoneEvent(dayRecord, request.zoneId, "sorting_end");

  let next = dayRecord;
  let sortingStartId: string;
  let sortingEndId: string;

  if (existingStart) {
    sortingStartId = existingStart.id;
    next = updateEvent(next, existingStart.id, {
      at: sortingStartAt,
      note,
    });
  } else {
    next = createEvent(next, {
      type: "sorting_start",
      at: sortingStartAt,
      zoneId: request.zoneId,
      note,
    });
    sortingStartId = next.timeline.find(
      (event) => event.type === "sorting_start" && event.zoneId === request.zoneId && event.at === sortingStartAt,
    )?.id ?? "";
  }

  if (existingEnd) {
    sortingEndId = existingEnd.id;
    next = updateEvent(next, existingEnd.id, {
      at: sortingEndAt,
      note: `cleanup ${request.minutes} minutes corrected by ${source}`,
    });
  } else {
    next = createEvent(next, {
      type: "sorting_end",
      at: sortingEndAt,
      zoneId: request.zoneId,
      note: `cleanup ${request.minutes} minutes corrected by ${source}`,
    });
    sortingEndId = next.timeline.find(
      (event) => event.type === "sorting_end" && event.zoneId === request.zoneId && event.at === sortingEndAt,
    )?.id ?? "";
  }

  next = {
    ...next,
    zones: next.zones.map((zone) =>
      zone.id === request.zoneId
        ? {
            ...zone,
            sortingStartEventId: sortingStartId || zone.sortingStartEventId,
            sortingEndEventId: sortingEndId || zone.sortingEndEventId,
          }
        : zone,
    ),
    adjustments: [
      ...next.adjustments,
      {
        id: `cleanup-correction-${Date.now()}`,
        eventId: sortingEndId || undefined,
        reason: "missing_cleanup_finish",
        note: `cleanup=${request.minutes} min, anchor=${request.closeAt}, source=${source}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  return {
    dayRecord: next,
    sortingStartAt,
    sortingEndAt,
    minutes: request.minutes,
    sourceEventIds: [sortingStartId, sortingEndId].filter(Boolean),
  };
}

function findLatestZoneEvent(
  dayRecord: DayRecord,
  zoneId: string,
  type: TimelineEvent["type"],
): TimelineEvent | undefined {
  return [...dayRecord.timeline]
    .filter((event) => event.zoneId === zoneId && event.type === type)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
}
