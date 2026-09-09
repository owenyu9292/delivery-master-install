import { applyCompletedZoneEdit } from "./zoneEdit";
import type { DayRecord, HelperRecord, TimelineEvent, ZoneRecord } from "./types";
import type { ZoneKind } from "./zoneIdentity";

export interface HelperZoneSnapshot { zone: ZoneRecord; timeline: TimelineEvent[]; helpers: HelperRecord[]; }

export function captureHelperZone(day: DayRecord, zone: ZoneRecord): HelperZoneSnapshot {
  const timeline = day.timeline.filter(e => e.zoneId === zone.id ||
    (e.type === "helper_add" && (e.payload as Record<string, unknown> | undefined)?.sourceZoneId === zone.id));
  const ids = new Set(timeline.map(e => e.id));
  return structuredClone({zone,timeline,helpers:day.helpers.filter(h => h.linkedEventIds.some(id => ids.has(id)))});
}

export function restoreConvertedHelperZone(day: DayRecord, helper: HelperRecord, event: TimelineEvent, target: ZoneKind, quantity: number): DayRecord | undefined {
  const raw = (event.payload as Record<string, unknown> | undefined)?.sourceZoneSnapshot;
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") throw new Error("보관된 구역 원본 형식이 잘못됐습니다. 원본은 유지됩니다.");
  const snapshot = structuredClone(raw) as HelperZoneSnapshot;
  if (!snapshot.zone || typeof snapshot.zone.id !== "string" || !Array.isArray(snapshot.timeline) || !Array.isArray(snapshot.helpers)
      || snapshot.timeline.some(e => !e || typeof e.id !== "string" || !Number.isFinite(Date.parse(e.at)))
      || !snapshot.timeline.some(e => e.zoneId === snapshot.zone.id && e.type === "zone_end")) {
    throw new Error("보관된 구역 원본이 불완전합니다. 원본은 유지됩니다.");
  }
  if (day.zones.some(z => z.id === snapshot.zone.id) || snapshot.timeline.some(e => day.timeline.some(existing => existing.id === e.id))
      || snapshot.helpers.some(h => day.helpers.some(existing => existing.id === h.id))) {
    throw new Error("복구할 원본과 같은 기록이 이미 있습니다. 중복 저장하지 않았습니다.");
  }
  const names: Record<ZoneKind,string> = {miju:"미주",hils:"힐스테이트",alt:"대체배송",custom:"추가구역"};
  const remaining = day.timeline.filter(e => e.id !== event.id);
  const restored: DayRecord = {
    ...day,
    zones:[...day.zones,{...snapshot.zone,kind:target,name:target === snapshot.zone.kind ? snapshot.zone.name : names[target]}],
    timeline:[...remaining,...snapshot.timeline],
    helpers:[...day.helpers.filter(h => h.id !== helper.id),...snapshot.helpers],
  };
  return applyCompletedZoneEdit(restored,{zoneId:snapshot.zone.id,delivered:quantity,endAt:event.at,reason:"helper_original_zone_restore"});
}
