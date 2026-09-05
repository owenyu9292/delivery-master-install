import { createEvent, updateEvent } from "./eventTimeline";
import type { DayRecord, TimelineEvent } from "./types";

export const HANDLING_TITLE = "반품·선집화·상차";
export const DEFAULT_HANDLING_MINUTES = 30;

export function isHandlingEvent(event: TimelineEvent): boolean {
  return event.type === "incident" && (event.payload as Record<string, unknown> | undefined)?.kind === "handling_time";
}

export function findHandlingEvent(day: DayRecord, zoneId: string): TimelineEvent | undefined {
  return day.timeline.find((event) => event.zoneId === zoneId && isHandlingEvent(event));
}

export function readHandlingMinutes(event?: TimelineEvent): number {
  const value = (event?.payload as Record<string, unknown> | undefined)?.minutes;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function setHandlingMinutes(day: DayRecord, input: { zoneId: string; minutes: number; at?: string }): DayRecord {
  if (!Number.isInteger(input.minutes) || input.minutes < 0 || input.minutes > 999) {
    throw new Error("작업 시간은 0~999분의 정수로 입력하세요.");
  }
  if (!day.zones.some((zone) => zone.id === input.zoneId)
      || !day.timeline.some((event) => event.zoneId === input.zoneId && event.type === "zone_start")) {
    throw new Error("시작한 구역에만 작업 시간을 기록할 수 있습니다.");
  }
  const previous = findHandlingEvent(day, input.zoneId);
  const at = previous?.at ?? input.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) throw new Error("작업 기록 시각을 확인하세요.");
  const payload = {
    ...previous?.payload,
    kind: "handling_time",
    title: HANDLING_TITLE,
    minutes: input.minutes,
    affectsEfficiency: true,
    scope: `zone:${input.zoneId}`,
  };
  // One editable incident per zone: repeated taps replace minutes, never add them.
  return previous
    ? updateEvent(day, previous.id, { payload })
    : createEvent(day, { type: "incident", at, zoneId: input.zoneId, payload });
}
