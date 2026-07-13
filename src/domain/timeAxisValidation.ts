import type { DayRecord, TimelineEvent, ZoneRecord } from "./types";

export interface TimeAxisIssue {
  code: string;
  message: string;
  eventIds?: string[];
  zoneId?: string;
}

// A direct-delivery tap happens immediately after the zone starts. Two minutes
// leaves room for the UI tap while rejecting an accidental later time edit.
const DIRECT_DELIVERY_GRACE_MINUTES = 2;

export function validateTimeAxis(dayRecord: DayRecord): TimeAxisIssue[] {
  const issues: TimeAxisIssue[] = [];
  const depart = findDayEvent(dayRecord, "depart_jinjeop");
  const arrive = findDayEvent(dayRecord, "arrive_cheongnyangni");
  const dayClose = findDayEvent(dayRecord, "day_close");

  if (depart && arrive && isAfter(depart.at, arrive.at)) {
    issues.push(issue("depart_after_arrive", "진접 출발은 청량리 도착보다 늦을 수 없습니다.", [depart, arrive]));
  }

  let previousEndedZone: ZoneRecord | undefined;
  for (const zone of orderedZones(dayRecord)) {
    const start = findZoneEvent(dayRecord, zone, "zone_start");
    const sortingStart = findZoneEvent(dayRecord, zone, "sorting_start");
    const sortingEnd = findZoneEvent(dayRecord, zone, "sorting_end");
    const deliveryStart = findZoneEvent(dayRecord, zone, "delivery_start");
    const end = findZoneEvent(dayRecord, zone, "zone_end");

    if (start && arrive && isBefore(start.at, arrive.at)) {
      issues.push(issue("zone_before_arrive", `${zone.name} 시작은 청량리 도착보다 빠를 수 없습니다.`, [start, arrive], zone.id));
    }
    if (start && previousEndedZone) {
      const previousEnd = findZoneEvent(dayRecord, previousEndedZone, "zone_end");
      if (previousEnd && isBefore(start.at, previousEnd.at)) {
        issues.push(issue("zone_overlaps_previous", `${zone.name} 시작은 이전 구역 완료보다 빠를 수 없습니다.`, [previousEnd, start], zone.id));
      }
    }
    if (start && end && isAfter(start.at, end.at)) {
      issues.push(issue("zone_start_after_end", `${zone.name} 시작은 완료보다 늦을 수 없습니다.`, [start, end], zone.id));
    }
    if (end && dayClose && isAfter(end.at, dayClose.at)) {
      issues.push(issue("zone_end_after_day_close", `${zone.name} 완료는 업무 종료보다 늦을 수 없습니다.`, [end, dayClose], zone.id));
    }

    if (sortingStart && !sortingEnd && deliveryStart) {
      issues.push(issue("delivery_before_sorting_end", `${zone.name}은 정리 완료 전에 배송을 시작할 수 없습니다.`, [sortingStart, deliveryStart], zone.id));
    }
    if (sortingEnd && !sortingStart) {
      issues.push(issue("sorting_end_without_start", `${zone.name} 정리 완료에는 정리 시작 기록이 필요합니다.`, [sortingEnd], zone.id));
    }
    if (sortingStart && sortingEnd && isAfter(sortingStart.at, sortingEnd.at)) {
      issues.push(issue("sorting_start_after_end", `${zone.name} 정리 시작은 정리 완료보다 늦을 수 없습니다.`, [sortingStart, sortingEnd], zone.id));
    }
    if (start && sortingStart && isBefore(sortingStart.at, start.at)) {
      issues.push(issue("sorting_before_zone_start", `${zone.name} 정리 시작은 구역 시작보다 빠를 수 없습니다.`, [start, sortingStart], zone.id));
    }
    if (end && sortingEnd && isAfter(sortingEnd.at, end.at)) {
      issues.push(issue("sorting_after_zone_end", `${zone.name} 정리 완료는 구역 완료보다 늦을 수 없습니다.`, [sortingEnd, end], zone.id));
    }

    if (deliveryStart && start && isBefore(deliveryStart.at, start.at)) {
      issues.push(issue("delivery_before_zone_start", `${zone.name} 배송 시작은 구역 시작보다 빠를 수 없습니다.`, [start, deliveryStart], zone.id));
    }
    if (deliveryStart && end && isAfter(deliveryStart.at, end.at)) {
      issues.push(issue("delivery_after_zone_end", `${zone.name} 배송 시작은 구역 완료보다 늦을 수 없습니다.`, [deliveryStart, end], zone.id));
    }
    if (deliveryStart && sortingEnd && isBefore(deliveryStart.at, sortingEnd.at)) {
      issues.push(issue("delivery_before_sorting_end", `${zone.name} 배송 시작은 정리 완료보다 빠를 수 없습니다.`, [sortingEnd, deliveryStart], zone.id));
    }
    if (deliveryStart && start && !sortingStart && !sortingEnd) {
      const delayMinutes = diffMinutes(start.at, deliveryStart.at);
      if (delayMinutes !== undefined && delayMinutes > DIRECT_DELIVERY_GRACE_MINUTES) {
        issues.push(issue(
          "direct_delivery_delayed",
          `${zone.name} 바로 배송 시작은 구역 시작 후 ${DIRECT_DELIVERY_GRACE_MINUTES}분 안에 기록해야 합니다. 실제 지연이면 정리 시작/완료 흐름으로 기록하세요.`,
          [start, deliveryStart],
          zone.id,
        ));
      }
    }

    if (end) previousEndedZone = zone;
  }

  return issues;
}

function orderedZones(dayRecord: DayRecord): ZoneRecord[] {
  return [...dayRecord.zones].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function findDayEvent(dayRecord: DayRecord, type: TimelineEvent["type"]): TimelineEvent | undefined {
  return dayRecord.timeline.find((event) => event.type === type);
}

function findZoneEvent(dayRecord: DayRecord, zone: ZoneRecord, type: TimelineEvent["type"]): TimelineEvent | undefined {
  const byId = eventIdFor(zone, type);
  if (byId) return dayRecord.timeline.find((event) => event.id === byId);
  return dayRecord.timeline
    .filter((event) => event.zoneId === zone.id && event.type === type)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0];
}

function eventIdFor(zone: ZoneRecord, type: TimelineEvent["type"]): string | undefined {
  if (type === "zone_start") return zone.startEventId;
  if (type === "sorting_start") return zone.sortingStartEventId;
  if (type === "sorting_end") return zone.sortingEndEventId;
  if (type === "delivery_start") return zone.deliveryStartEventId;
  if (type === "zone_end") return zone.endEventId;
  return undefined;
}

function issue(code: string, message: string, events: TimelineEvent[], zoneId?: string): TimeAxisIssue {
  return { code, message, eventIds: events.map((event) => event.id), zoneId };
}

function isAfter(left: string, right: string): boolean {
  return Date.parse(left) > Date.parse(right);
}

function isBefore(left: string, right: string): boolean {
  return Date.parse(left) < Date.parse(right);
}

function diffMinutes(start: string, end: string): number | undefined {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;
  return (endMs - startMs) / 60_000;
}
