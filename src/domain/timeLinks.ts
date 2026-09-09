import { sortTimeline } from "./eventTimeline";
import type { DayRecord, TimelineEvent } from "./types";
const data = (e: TimelineEvent): Record<string, unknown> => (e.payload ?? {}) as Record<string, unknown>;

// Only shared workflow boundaries link. Elapsed work is never shifted as a block.
export function linkTimePatches(day: DayRecord, patches: Map<string, Partial<TimelineEvent>>): Map<string, Partial<TimelineEvent>> {
  const result = new Map(patches);
  const events = new Map(day.timeline.map(e => [e.id, e]));
  const edges = new Map<string, Set<string>>();
  const connect = (a?: TimelineEvent, b?: TimelineEvent) => {
    if (!a || !b || a.id === b.id) return;
    for (const [left, right] of [[a, b], [b, a]]) {
      if (!edges.has(left!.id)) edges.set(left!.id, new Set());
      edges.get(left!.id)!.add(right!.id);
    }
  };
  const same = (a?: TimelineEvent, b?: TimelineEvent) => !!a && !!b && Number.isFinite(Date.parse(a.at)) && Date.parse(a.at) === Date.parse(b.at);
  const zones = [...day.zones].sort((a, b) => a.order - b.order);
  const zoneEvent = (id: string, type: TimelineEvent["type"]) => day.timeline.find(e => e.zoneId === id && e.type === type);
  const started = zones.filter(z => zoneEvent(z.id, "zone_start"));
  for (const z of zones) {
    const start = zoneEvent(z.id, "zone_start"), sorting = zoneEvent(z.id, "sorting_start");
    const sorted = zoneEvent(z.id, "sorting_end"), delivery = zoneEvent(z.id, "delivery_start");
    connect(sorted, delivery);
    if (same(start, sorting)) connect(start, sorting);
    if (!sorting && !sorted && start && delivery) {
      const gap = Date.parse(delivery.at) - Date.parse(start.at);
      if (gap >= 0 && gap <= 120000 && (data(delivery).autoCorrected !== true || gap === 0)) connect(start, delivery);
    }
  }
  const arrive = day.timeline.find(e => e.type === "arrive_cheongnyangni");
  const close = day.timeline.find(e => e.type === "day_close");
  const firstStart = started[0] && zoneEvent(started[0].id, "zone_start");
  if (same(arrive, firstStart)) connect(arrive, firstStart);
  for (let i = 1; i < started.length; i++) {
    const end = zoneEvent(started[i - 1]!.id, "zone_end"), start = zoneEvent(started[i]!.id, "zone_start");
    if (same(end, start)) connect(end, start);
  }
  const lastEnd = started.at(-1) && zoneEvent(started.at(-1)!.id, "zone_end");
  if (same(lastEnd, close)) connect(lastEnd, close);

  // Explicit links preserve the relationship after repeated edits / JSON restore.
  for (const e of day.timeline) {
    const ids = data(e).linkedTimeEventIds;
    if (Array.isArray(ids)) for (const id of ids) {
      const peer = typeof id === "string" ? events.get(id) : undefined;
      const back = peer && data(peer).linkedTimeEventIds;
      if (peer && Array.isArray(back) && back.includes(e.id) && permittedPair(day, e, peer)) connect(e, peer);
    }
  }
  const seeds = new Map<string, string>();
  for (const [id, patch] of patches) {
    if (patch.at !== undefined && events.has(id)) {
      if (!Number.isFinite(Date.parse(patch.at))) throw new Error("올바른 시각을 입력하세요.");
      if (Date.parse(events.get(id)!.at) !== Date.parse(patch.at)) seeds.set(id, patch.at);
    }
  }
  // A newly inserted sorting finish can already have the requested timestamp.
  for (const [id, patch] of patches) {
    const e = events.get(id);
    if (e?.type === "sorting_end" && patch.at && !seeds.has(id)) {
      const delivery = e.zoneId && zoneEvent(e.zoneId, "delivery_start");
      if (delivery && data(delivery).autoCorrected === true && Date.parse(delivery.at) !== Date.parse(patch.at) && !seeds.has(delivery.id)) seeds.set(id, patch.at);
    }
  }
  const groupFor = (id: string): Set<string> => {
    const group = new Set<string>(), queue = [id];
    while (queue.length) {
      const key = queue.pop()!;
      if (group.has(key)) continue;
      group.add(key);
      queue.push(...edges.get(key) ?? []);
    }
    return group;
  };
  const inferred = new Set<string>();
  for (const z of zones) {
    const start = zoneEvent(z.id, "sorting_start"), end = zoneEvent(z.id, "sorting_end");
    if (!start || !end || data(end).autoCleanup !== true) continue;
    const boundary = groupFor(end.id);
    if ([...boundary].some(id => seeds.has(id))) continue;
    const startSource = [...groupFor(start.id)].find(id => seeds.has(id));
    if (startSource) {
      seeds.set(end.id, new Date(Date.parse(seeds.get(startSource)!) + 30 * 60000).toISOString());
      boundary.forEach(id => inferred.add(id));
    }
  }
  const visited = new Set<string>();
  for (const [id, at] of seeds) {
    if (visited.has(id)) continue;
    const group = groupFor(id);
    const values = [...group].flatMap(key => seeds.has(key) ? [Date.parse(seeds.get(key)!)] : []);
    if (new Set(values).size > 1) throw new Error("연결된 시각을 서로 다르게 입력했습니다. 정리 완료와 배송 시작 등 같은 경계는 한 시각으로 맞춰주세요.");
    for (const key of group) {
      visited.add(key);
      const e = events.get(key)!;
      const patch = result.get(key) ?? {};
      result.set(key, {
        ...patch, at,
        payload: {
          ...e.payload, ...patch.payload,
          ...(group.size > 1 ? { linkedTimeEventIds: [...group].filter(peer => peer !== key) } : {}),
          ...(data(e).autoCleanup === true && !inferred.has(key) ? { autoCleanup: false } : {}),
          ...(e.type === "delivery_start" && data(e).autoCorrected === true && !inferred.has(key) ? { autoCorrected: false } : {}),
        },
      });
    }
  }
  return result;
}

function permittedPair(day: DayRecord, a: TimelineEvent, b: TimelineEvent): boolean {
  const pair = [a.type, b.type].sort().join(":");
  if (a.zoneId && a.zoneId === b.zoneId) {
    return ["delivery_start:sorting_end", "sorting_start:zone_start"].includes(pair) ||
      pair === "delivery_start:zone_start" && !day.timeline.some(e => e.zoneId === a.zoneId && e.type === "sorting_start");
  }
  const zones = [...day.zones].filter(z => day.timeline.some(e => e.zoneId === z.id && e.type === "zone_start")).sort((x, y) => x.order - y.order);
  if (pair === "arrive_cheongnyangni:zone_start") return (a.type === "zone_start" ? a : b).zoneId === zones[0]?.id;
  if (pair === "day_close:zone_end") return (a.type === "zone_end" ? a : b).zoneId === zones.at(-1)?.id;
  if (pair === "zone_end:zone_start") {
    const end = a.type === "zone_end" ? a : b, start = a.type === "zone_start" ? a : b;
    const index = zones.findIndex(z => z.id === end.zoneId);
    return index >= 0 && zones[index + 1]?.id === start.zoneId;
  }
  return false;
}

export function applyLinkedEventTime(day: DayRecord, eventId: string, at: string): DayRecord {
  const patches = linkTimePatches(day, new Map([[eventId, { at }]]));
  const now = new Date().toISOString();
  return {
    ...day,
    timeline: sortTimeline(day.timeline.map(e => patches.has(e.id) ? { ...e, ...patches.get(e.id), updatedAt: now } : e)),
    meta: { ...day.meta, updatedAt: now },
  };
}
