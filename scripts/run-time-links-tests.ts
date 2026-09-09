import assert from "node:assert/strict";
import { applyLinkedEventTime } from "../src/domain/timeLinks";
import { applyCompletedZoneEdit } from "../src/domain/zoneEdit";
import { calculateDay } from "../src/domain/deliveryCalc";
import { validateTimeAxis } from "../src/domain/timeAxisValidation";
import type { DayRecord, TimelineEvent } from "../src/domain/types";

const at = (n: number) => new Date(Date.parse("2026-09-09T09:00:00+09:00") + n * 60000).toISOString();
const ev = (id: string, type: TimelineEvent["type"], n: number, zoneId?: string): TimelineEvent => ({
  id, type, at: at(n), zoneId, source: "manual", createdAt: at(n), updatedAt: at(n),
  ...(type === "zone_end" ? { payload: { total: 100, delivered: 100, failed: 0, extra: 0 } } : {}),
});
const base = (): DayRecord => ({
  schemaVersion: 1, id: "links", date: "2026-09-09", status: "closed",
  zones: [{id:"a",name:"대체",kind:"alt",order:1},{id:"b",name:"힐스",kind:"hils",order:2}],
  timeline: [ev("depart","depart_jinjeop",-60),ev("arrive","arrive_cheongnyangni",0),
    ev("a-start","zone_start",0,"a"),ev("a-delivery","delivery_start",0,"a"),ev("a-end","zone_end",60,"a"),
    ev("b-start","zone_start",60,"b"),ev("b-sort","sorting_start",75,"b"),ev("b-sorted","sorting_end",105,"b"),
    ev("b-delivery","delivery_start",105,"b"),ev("b-end","zone_end",180,"b"),ev("close","day_close",180)],
  helpers:[],adjustments:[],meta:{createdAt:at(-60),updatedAt:at(180),recoveryStatus:"none"},
});
const time = (day:DayRecord,id:string) => day.timeline.find(e=>e.id===id)!.at;
const counts = (day:DayRecord) => day.timeline.filter(e=>e.type==="zone_end").map(e=>e.payload);
let checks = 0;
for(const source of ["b-sorted","b-delivery"]){
  const original=base(), next=applyLinkedEventTime(original,source,at(115));
  assert.equal(time(next,"b-sorted"),at(115));assert.equal(time(next,"b-delivery"),at(115));
  assert.equal(time(next,"b-end"),at(180));assert.deepEqual(counts(next),counts(original));
  assert.equal(time(original,source),at(105));assert.equal(validateTimeAxis(next).length,0);checks++;
}
for(const source of ["arrive","a-start","a-delivery"]){
  const next=applyLinkedEventTime(base(),source,at(5));
  for(const id of ["arrive","a-start","a-delivery"])assert.equal(time(next,id),at(5));
  assert.equal(time(next,"depart"),at(-60));assert.equal(time(next,"a-end"),at(60));checks++;
}
for(const source of ["a-end","b-start"]){
  const next=applyLinkedEventTime(base(),source,at(65));
  assert.equal(time(next,"a-end"),at(65));assert.equal(time(next,"b-start"),at(65));
  assert.equal(time(next,"b-sort"),at(75));assert.equal(time(next,"b-end"),at(180));checks++;
}
for(const source of ["b-end","close"]){
  const next=applyLinkedEventTime(base(),source,at(190));
  assert.equal(time(next,"b-end"),at(190));assert.equal(time(next,"close"),at(190));
  assert.equal(time(next,"b-delivery"),at(105));checks++;
}
const gaps=base();gaps.timeline=gaps.timeline.map(e=>e.id==="b-start"?{...e,at:at(63)}:e.id==="close"?{...e,at:at(185)}:e);
assert.equal(time(applyLinkedEventTime(gaps,"a-end",at(61)),"b-start"),at(63));
assert.equal(time(applyLinkedEventTime(gaps,"b-end",at(181)),"close"),at(185));checks++;
const staleForm=applyCompletedZoneEdit(base(),{zoneId:"b",sortingEndAt:at(115),deliveryStartAt:at(105),startAt:at(60),endAt:at(180)});
assert.equal(time(staleForm,"b-delivery"),at(115));assert.equal(validateTimeAxis(staleForm).length,0);checks++;
assert.throws(()=>applyCompletedZoneEdit(base(),{zoneId:"b",sortingEndAt:at(115),deliveryStartAt:at(110)}),/연결된 시각/);checks++;
let repeated=base();
for(let i=0;i<100;i++){
  const minute=100+(i*17)%40;
  repeated=JSON.parse(JSON.stringify(applyLinkedEventTime(repeated,i%2?"b-sorted":"b-delivery",at(minute))));
  assert.equal(time(repeated,"b-delivery"),at(minute));assert.equal(time(repeated,"b-sorted"),at(minute));
  assert.equal(time(repeated,"b-end"),at(180));assert.deepEqual(counts(repeated),counts(base()));
}checks++;
const auto=base();auto.timeline=auto.timeline.map(e=>["b-sorted","b-delivery"].includes(e.id)?{...e,payload:{autoCleanup:true,autoCorrected:true}}:e);
const shifted=applyLinkedEventTime(auto,"b-sort",at(80));
assert.equal(time(shifted,"b-sorted"),at(110));assert.equal(time(shifted,"b-delivery"),at(110));
const overridden=applyLinkedEventTime(shifted,"b-sorted",at(120));
const movedAgain=applyLinkedEventTime(overridden,"b-sort",at(85));
assert.equal(time(movedAgain,"b-sorted"),at(120));assert.equal(time(movedAgain,"b-delivery"),at(120));checks++;
const invalid=applyLinkedEventTime(base(),"b-sorted",at(190));
assert.equal(time(invalid,"b-delivery"),at(190));assert.equal(time(invalid,"b-end"),at(180));
assert.ok(validateTimeAxis(invalid).length);assert.equal(calculateDay(invalid).zones.find(z=>z.zoneId==="b")?.efficiencyPerHour,undefined);
const repaired=applyLinkedEventTime(invalid,"b-sorted",at(115));
assert.equal(validateTimeAxis(repaired).length,0);checks++;
const forged=base();forged.timeline=forged.timeline.map(e=>e.id==="depart"?{...e,payload:{linkedTimeEventIds:["b-end"]}}:e.id==="b-end"?{...e,payload:{...e.payload,linkedTimeEventIds:["depart"]}}:e);
assert.equal(time(applyLinkedEventTime(forged,"depart",at(-50)),"b-end"),at(180));checks++;
assert.throws(()=>applyLinkedEventTime(base(),"b-start","bad"),/시각/);checks++;
console.log("linked time tests passed: "+checks+" groups, including 100 repeat edit/JSON round trips");
