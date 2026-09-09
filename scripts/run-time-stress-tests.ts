import assert from "node:assert/strict";
import { applyLinkedEventTime } from "../src/domain/timeLinks";
import { applyAutomaticCleanup } from "../src/domain/autoCleanup";
import { calculateDay } from "../src/domain/deliveryCalc";
import type { DayRecord, TimelineEvent, ZoneRecord } from "../src/domain/types";

const stamp = (minute: number) => new Date(Date.parse("2026-09-09T09:00:00+09:00") + minute * 60000).toISOString();
const kinds: NonNullable<ZoneRecord["kind"]>[] = ["miju", "hils", "alt", "custom"];
const values = [-1440, -61, -60, -1, 0, 1, 29, 30, 39, 40, 59, 60, 61, 119, 120, 121, 1440, 10080];
const quantities = [0, 1, 13, 100, 99999];
const event = (id: string, type: TimelineEvent["type"], n: number, zoneId?: string): TimelineEvent => ({
  id, type, at: stamp(n), zoneId, source: "manual", createdAt: stamp(n), updatedAt: stamp(n),
});
function fixture(kind: NonNullable<ZoneRecord["kind"]>, count: number, order: number): DayRecord {
  const timeline = [event("depart", "depart_jinjeop", -60), event("arrive", "arrive_cheongnyangni", 0),
    event("start", "zone_start", 0, "visit"), event("sort", "sorting_start", 0, "visit"),
    event("sorted", "sorting_end", 30, "visit"), event("delivery", "delivery_start", 30, "visit"),
    {...event("end", "zone_end", 120, "visit"), payload: {total: count, delivered: count, failed: 0, extra: 0}},
    event("close", "day_close", 120)];
  return {schemaVersion:1,id:"stress",date:"2026-09-09",status:"closed",timeline,
    zones:[{id:"visit",name:"같은 이름",kind,order}],helpers:[],adjustments:[],
    meta:{createdAt:stamp(-60),updatedAt:stamp(120),recoveryStatus:"none"}};
}
const at = (day: DayRecord, id: string) => day.timeline.find(e => e.id === id)!.at;
const countEvents = (day: DayRecord) => day.timeline.filter(e => e.type === "zone_end");
function finiteNumbers(value: unknown): void {
  if (typeof value === "number") assert(Number.isFinite(value), "non-finite calculation");
  else if (value && typeof value === "object") Object.values(value).forEach(finiteNumbers);
}
let combinations = 0;
for (const kind of kinds) for (const quantity of quantities) for (const order of [1, 2, 7]) {
  for (const minute of values) for (const source of ["sorted", "delivery"]) {
    const original = fixture(kind, quantity, order), snapshot = structuredClone(original);
    const changed = JSON.parse(JSON.stringify(applyLinkedEventTime(original, source, stamp(minute)))) as DayRecord;
    assert.deepEqual(original, snapshot);
    assert.equal(at(changed, "sorted"), stamp(minute));
    assert.equal(at(changed, "delivery"), stamp(minute));
    assert.deepEqual(countEvents(changed), countEvents(original));
    assert.equal(at(changed, "close"), stamp(120));
    assert.equal(new Set(changed.timeline.map(e => e.id)).size, original.timeline.length);
    finiteNumbers(calculateDay(changed));
    const repaired = applyLinkedEventTime(changed, source === "sorted" ? "delivery" : "sorted", stamp(30));
    assert.equal(at(repaired, "sorted"), stamp(30));
    assert.equal(at(repaired, "delivery"), stamp(30));
    assert.deepEqual(calculateDay(repaired), calculateDay(original));
    combinations++;
  }
}

// Reorder/rename and JSON round trips must not attach time math to the label.
for (const kind of kinds) for (let iteration = 0; iteration < 100; iteration++) {
  let record = fixture(kind, 100, 1);
  record = applyLinkedEventTime(record, "sorted", stamp(35));
  record.zones[0] = {...record.zones[0]!,kind:kinds[iteration % kinds.length]!,order:1 + iteration % 7,name:"중복 이름"};
  record = JSON.parse(JSON.stringify(record));
  record = applyLinkedEventTime(record, "delivery", stamp(40));
  assert.equal(at(record, "sorted"), stamp(40));
  assert.deepEqual(countEvents(record), countEvents(fixture(kind,100,1)));
  combinations++;
}

for (const kind of kinds) for (const order of [1, 2, 7]) for (const elapsed of [-1, 0, 29, 30, 39, 39.999, 40, 41, 120, 1440]) {
  const record = fixture(kind, 100, order);
  record.status = "active";
  record.timeline = record.timeline.filter(e => !["sorted","delivery","end","close"].includes(e.id));
  const snapshot = structuredClone(record);
  const result = applyAutomaticCleanup(record, stamp(elapsed));
  assert.deepEqual(record, snapshot);
  assert.equal(result.correctedZoneIds.length, kind === "hils" && elapsed >= 40 ? 1 : 0);
  assert.deepEqual(applyAutomaticCleanup(result.dayRecord, stamp(elapsed)).dayRecord, result.dayRecord);
  combinations++;
}
for (const invalid of ["", "bad", "25:99", "Infinity"]) {
  const original = fixture("hils",100,1), snapshot = structuredClone(original);
  assert.throws(() => applyLinkedEventTime(original,"delivery",invalid));
  assert.deepEqual(original,snapshot);
  assert.deepEqual(applyAutomaticCleanup(original,invalid).dayRecord,original);
  combinations++;
}
console.log(`time stress passed: ${combinations} deterministic combinations; kinds/orders/count extremes/time inversion/repair/JSON/idempotence`);
