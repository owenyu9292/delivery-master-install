import type {
  DayRecord,
  EventSource,
  LogEntry,
  TimelineEvent,
  TimelineEventPayload,
  TimelineEventType,
} from "./types";

export interface EventInput {
  id?: string;
  type: TimelineEventType;
  at: string;
  zoneId?: string;
  payload?: TimelineEventPayload;
  note?: string;
  source?: EventSource;
}

export interface TimelineValidation {
  valid: boolean;
  warnings: TimelineValidationWarning[];
}

export interface TimelineValidationWarning {
  code: string;
  message: string;
  eventIds?: string[];
  zoneId?: string;
}

export function createEvent(dayRecord: DayRecord, input: EventInput): DayRecord {
  const now = new Date().toISOString();
  const event: TimelineEvent = {
    id: input.id ?? createEventId(input.type, input.at, dayRecord.timeline),
    type: input.type,
    at: input.at,
    zoneId: input.zoneId,
    payload: input.payload,
    note: input.note,
    source: input.source ?? "manual",
    createdAt: now,
    updatedAt: now,
  };

  return withTimeline(dayRecord, [...dayRecord.timeline, event]);
}

export function updateEvent(
  dayRecord: DayRecord,
  eventId: string,
  patch: Partial<Omit<TimelineEvent, "id" | "createdAt">>,
): DayRecord {
  let found = false;
  const updatedTimeline = dayRecord.timeline.map((event) => {
    if (event.id !== eventId) {
      return event;
    }

    found = true;
    return {
      ...event,
      ...patch,
      id: event.id,
      createdAt: event.createdAt,
      updatedAt: new Date().toISOString(),
    };
  });

  if (!found) {
    return dayRecord;
  }

  return withTimeline(dayRecord, updatedTimeline);
}

export function sortTimeline(timeline: TimelineEvent[]): TimelineEvent[] {
  return [...timeline].sort((a, b) => {
    const byTime = Date.parse(a.at) - Date.parse(b.at);
    if (byTime !== 0) {
      return byTime;
    }

    return a.id.localeCompare(b.id);
  });
}

export function deriveLog(dayRecord: DayRecord): LogEntry[] {
  return sortTimeline(dayRecord.timeline).map((event) => ({
    id: `log-${event.id}`,
    eventId: event.id,
    at: event.at,
    label: getEventLabel(event),
    zoneId: event.zoneId,
    detail: getEventDetail(event),
  }));
}

export function validateTimeline(dayRecord: DayRecord): TimelineValidation {
  const warnings: TimelineValidationWarning[] = [];
  const seenIds = new Set<string>();

  for (const event of dayRecord.timeline) {
    if (seenIds.has(event.id)) {
      warnings.push({
        code: "duplicate_event_id",
        message: `Duplicate event id: ${event.id}`,
        eventIds: [event.id],
      });
    }
    seenIds.add(event.id);

    if (Number.isNaN(Date.parse(event.at))) {
      warnings.push({
        code: "invalid_event_time",
        message: `Invalid event time on ${event.id}`,
        eventIds: [event.id],
      });
    }

    if (requiresZone(event.type) && !event.zoneId) {
      warnings.push({
        code: "missing_zone_id",
        message: `${event.type} should be linked to a zone`,
        eventIds: [event.id],
      });
    }
  }

  for (const zone of dayRecord.zones) {
    const linkedIds = [
      zone.startEventId,
      zone.sortingStartEventId,
      zone.sortingEndEventId,
      zone.deliveryStartEventId,
      zone.endEventId,
    ].filter(Boolean) as string[];

    for (const eventId of linkedIds) {
      if (!seenIds.has(eventId)) {
        warnings.push({
          code: "zone_missing_linked_event",
          message: `Zone ${zone.id} links to missing event ${eventId}`,
          eventIds: [eventId],
          zoneId: zone.id,
        });
      }
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

function withTimeline(dayRecord: DayRecord, timeline: TimelineEvent[]): DayRecord {
  return {
    ...dayRecord,
    timeline: sortTimeline(timeline),
    meta: {
      ...dayRecord.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

function createEventId(
  type: TimelineEventType,
  at: string,
  existing: TimelineEvent[],
): string {
  const datePart = at.replace(/[^0-9]/g, "").slice(0, 14) || "event";
  const base = `${type}-${datePart}`;
  if (!existing.some((event) => event.id === base)) {
    return base;
  }

  let index = 2;
  while (existing.some((event) => event.id === `${base}-${index}`)) {
    index += 1;
  }

  return `${base}-${index}`;
}

function requiresZone(type: TimelineEventType): boolean {
  return [
    "zone_start",
    "sorting_start",
    "sorting_end",
    "delivery_start",
    "zone_end",
  ].includes(type);
}

function getEventLabel(event: TimelineEvent): string {
  switch (event.type) {
    case "depart_jinjeop":
      return "진접 출발";
    case "arrive_cheongnyangni":
      return "청량리 도착";
    case "zone_start":
      return "구역 시작";
    case "sorting_start":
      return "정리 시작";
    case "sorting_end":
      return "정리 완료";
    case "delivery_start":
      return "배송 시작";
    case "zone_end":
      return "구역 완료";
    case "helper_add":
      return "도우미 기록";
    case "incident":
      return "특이사항";
    case "day_close":
      return "업무 종료";
    case "manual_adjust":
      return "수동 보정";
    default:
      return event.type;
  }
}

function getEventDetail(event: TimelineEvent): string | undefined {
  const parts: string[] = [];

  if (event.zoneId) {
    parts.push(`zone=${event.zoneId}`);
  }

  if (event.payload) {
    const payloadSummary = summarizePayload(event.payload);
    if (payloadSummary) {
      parts.push(payloadSummary);
    }
  }

  if (event.note) {
    parts.push(event.note);
  }

  return parts.length > 0 ? parts.join(" / ") : undefined;
}

function summarizePayload(payload: TimelineEventPayload): string | undefined {
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);

  return entries.length > 0 ? entries.join(", ") : undefined;
}
