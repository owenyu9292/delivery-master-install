import assert from "node:assert/strict";
import { captureHelperZone, restoreConvertedHelperZone } from "../src/domain/helperZoneSnapshot";
import { calculateDay } from "../src/domain/deliveryCalc";
import { assertDayRecord } from "../src/storage/recordValidation";
import type { DayRecord, HelperRecord, TimelineEvent } from "../src/domain/types";

const at=(minute:number)=>new Date(Date.parse("2026-09-09T09:00:00+09:00")+minute*60000).toISOString();
const ev=(id:string,type:TimelineEvent["type"],minute:number,zoneId?:string,payload?:Record<string,unknown>):TimelineEvent=>({id,type,at:at(minute),zoneId,payload,source:"manual",createdAt:at(minute),updatedAt:at(minute)});
const original:DayRecord={schemaVersion:1,id:"restore",date:"2026-09-09",status:"closed",
  zones:[{id:"visit",name:"원본",kind:"hils",order:1}],
  timeline:[ev("depart","depart_jinjeop",-60),ev("arrival","arrive_cheongnyangni",0),ev("start","zone_start",0,"visit"),ev("sort","sorting_start",0,"visit"),ev("sorted","sorting_end",30,"visit"),ev("delivery","delivery_start",30,"visit"),ev("end","zone_end",120,"visit",{total:100,delivered:100,failed:0,extra:0}),ev("close","day_close",120)],
  helpers:[],adjustments:[],meta:{createdAt:at(-60),updatedAt:at(120),recoveryStatus:"none"}};
function convert(day:DayRecord,kind:"free_received"|"paid_received"){
  const snapshot=captureHelperZone(day,day.zones[0]!);
  const event=ev("helper-event","helper_add",120,undefined,{helperId:"helper",helperKind:kind,quantity:100,sourceZoneId:"visit",sourceZoneSnapshot:snapshot});
  const helper:HelperRecord={id:"helper",name:kind,kind,quantity:100,linkedEventIds:[event.id,...snapshot.timeline.map(e=>e.id)]};
  const ids=new Set(snapshot.timeline.map(e=>e.id));
  const helpers=new Set(snapshot.helpers.map(h=>h.id));
  const converted={...day,zones:[],timeline:[...day.timeline.filter(e=>!ids.has(e.id)),event],helpers:[...day.helpers.filter(h=>!helpers.has(h.id)),helper]};
  return {day:JSON.parse(JSON.stringify(converted)) as DayRecord,helper,event};
}
let checks=0;
for(const kind of ["free_received","paid_received"] as const){
  for(const target of ["alt","hils","miju"] as const){
    const source=structuredClone(original);
    source.timeline.push(ev("contribution","helper_add",60,undefined,{helperId:"companion",helperKind:"paid_received",quantity:50,sourceZoneId:"visit"}));
    source.helpers.push({id:"companion",name:"동행",kind:"paid_received",quantity:50,linkedEventIds:["contribution"]});
    const frozen=structuredClone(source);
    const converted=convert(source,kind);
    assertDayRecord(converted.day);
    assert.deepEqual(source,frozen);
    assert.equal(calculateDay(converted.day).totals.deliveredCount,100);
    assert.equal(calculateDay(converted.day).totals.efficiencyCount,kind==="paid_received"?100:0);
    assert.equal(converted.day.helpers.length,1);
    const restored=restoreConvertedHelperZone(converted.day,converted.helper,converted.event,target,100)!;
    assertDayRecord(restored);
    assert.equal(restored.zones[0]!.id,"visit");assert.equal(restored.zones[0]!.kind,target);
    assert.equal(restored.helpers[0]!.id,"companion");
    for(const event of original.timeline)assert.equal(restored.timeline.find(e=>e.id===event.id)?.at,event.at);
    assert.equal(calculateDay(restored).totals.deliveredCount,100);
    const repeated=convert(restored,kind);
    assert.equal(calculateDay(repeated.day).totals.deliveredCount,100);
    checks++;
  }
}
const converted=convert(original,"paid_received");
const modified=restoreConvertedHelperZone(converted.day,converted.helper,{...converted.event,at:at(125)},"hils",88)!;
assert.equal(modified.timeline.find(e=>e.id==="end")?.at,at(125));
assert.equal(modified.timeline.find(e=>e.id==="close")?.at,at(125));
assert.equal(calculateDay(modified).totals.deliveredCount,88);checks++;
const duplicate={...converted.day,zones:[...original.zones]};
assert.throws(()=>restoreConvertedHelperZone(duplicate,converted.helper,converted.event,"alt",100),/이미/);checks++;
assert.throws(()=>restoreConvertedHelperZone(converted.day,converted.helper,{...converted.event,payload:{sourceZoneSnapshot:{zone:{},timeline:[]}}},"alt",100),/원본/);checks++;
assert.equal(restoreConvertedHelperZone(converted.day,converted.helper,{...converted.event,payload:{}},"alt",100),undefined);checks++;
// Older converted backups retain sourceZoneId but no surviving source zone.
const legacy={...converted.day,timeline:converted.day.timeline.map(e=>e.type==="helper_add"?{...e,payload:{helperKind:"paid_received",quantity:100,sourceZoneId:"gone"}}:e)};
assert.equal(calculateDay(legacy).totals.deliveredCount,100);checks++;
console.log(`helper original restore passed: ${checks} groups; paid/free/count100/companion50/JSON/repeat/times/collisions/legacy`);
