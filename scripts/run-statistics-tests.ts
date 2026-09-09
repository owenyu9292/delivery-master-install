import assert from "node:assert/strict";
import { buildStatsModel, validStatsDate, shiftStatsDate } from "../src/analytics/statistics";
import { renderStatistics } from "../src/ui/statisticsView";
import type { DayRecord, TimelineEvent } from "../src/domain/types";

function fixture(date="2026-09-09",quantity=100):DayRecord {
  const at=(m:number)=>new Date(Date.parse(date+"T08:00:00+09:00")+m*60000).toISOString();
  const event=(id:string,type:TimelineEvent["type"],m:number,zoneId?:string,payload?:Record<string,unknown>):TimelineEvent=>({id,type,at:at(m),zoneId,payload,source:"manual",createdAt:at(m),updatedAt:at(m)});
  return {schemaVersion:1,id:"day-"+date,date,status:"closed",zones:[{id:"visit",name:"힐스테이트",kind:"hils",order:1}],timeline:[
    event("depart","depart_jinjeop",0,undefined,{total:quantity-1}),event("arrival","arrive_cheongnyangni",60),event("start","zone_start",60,"visit"),event("sort","sorting_start",60,"visit"),event("sorted","sorting_end",90,"visit"),event("delivery","delivery_start",90,"visit"),event("end","zone_end",190,"visit",{total:quantity,delivered:quantity,failed:0,extra:0}),event("close","day_close",190)],helpers:[],adjustments:[],meta:{createdAt:at(0),updatedAt:at(190),recoveryStatus:"none"}};
}
const model=(days:DayRecord[])=>buildStatsModel(days,"month","2026-09-01","2026-09-30","2026-09-09");
let checks=0;
function test(name:string,run:()=>void){run();checks++;console.log("PASS "+name);}
test("known independent totals, duration conservation and weighted rate",()=>{
  const s=model([fixture()]).current;assert.equal(s.quantity,100);assert.equal(s.rate,60);assert.equal(s.elapsed,190);
  assert.deepEqual(s.parts,{drive:60,movement:0,sorting:30,delivery:100,handling:0,other:0,unknown:0});assert.equal(s.scan,1);
  const b=fixture("2026-09-08",200);b.timeline.find(e=>e.id==="end")!.at="2026-09-08T12:50:00+09:00";b.timeline.find(e=>e.id==="close")!.at="2026-09-08T12:50:00+09:00";
  assert.equal(model([fixture(),b]).current.rate,60);
});
test("missing expected never inflates scan difference; zero expected is known",()=>{
  const a=fixture("2026-09-08",200);a.timeline[0]!.payload={};const s=model([fixture(),a]).current;assert.equal(s.scan,1);assert.equal(s.scanDays,1);
  a.timeline[0]!.payload={total:0};assert.equal(model([a]).current.scan,200);
});
test("copies, active, future, duplicates, input order and source immutability",()=>{
  const copy=fixture();copy.date+="__copy_123";const active=fixture("2026-09-08");active.status="active";
  const newer=fixture();newer.id="newer";newer.meta.updatedAt="2026-09-09T23:00:00Z";
  const records=[fixture(),copy,active,fixture("2026-09-10"),newer],original=JSON.stringify(records);
  assert.equal(model(records).current.quantity,100);assert.equal(model(records).pending,1);
  assert.deepEqual(model(records).current,model([...records].reverse()).current);assert.equal(JSON.stringify(records),original);
});
test("time reversal, missing delivery, one-minute extremes and huge counts",()=>{
  for(const time of ["bad", "2026-09-09T07:00:00+09:00", "2026-09-09T09:30:01+09:00"]){const d=fixture();d.timeline.find(e=>e.id==="end")!.at=time;const m=model([d]);assert.equal(m.current.quantity,100);assert.equal(m.current.rate,undefined);}
  const d=fixture();d.timeline=d.timeline.filter(e=>e.id!=="delivery");assert.equal(model([d]).current.rate,60);assert.equal(model([d]).current.autoDays,1);
  const huge=model([fixture("2026-09-09",99999)]);assert.equal(huge.current.quantity,99999);assert.equal(huge.current.rate,undefined);
});
test("paid contribution is subset, free excluded only from efficiency",()=>{
  for(const kind of ["paid_received","free_received"]){const d=fixture();d.timeline.push({...d.timeline[0]!,id:"helper",type:"helper_add",payload:{helperId:"h",helperKind:kind,sourceZoneId:"visit",quantity:50}});const s=model([d]).current;assert.equal(s.quantity,100);assert.equal(s.rate,kind==="paid_received"?60:30);assert.equal(s.separate,0);}
});
test("standalone helper counted once, ratio denominator remains zones",()=>{
  const d=fixture();d.timeline.push({...d.timeline[0]!,id:"helper",type:"helper_add",payload:{helperId:"h",helperKind:"free_received",quantity:50}});const s=model([d]).current;assert.equal(s.quantity,150);assert.equal(s.separate,50);assert.equal(s.rate,60);assert.equal(s.buckets.reduce((a,b)=>a+b.quantity,0),100);
});
test("Miju A detail, names do not alter category, cached counts ignored",()=>{
  const d=fixture();d.zones[0]!.name="<img onerror=alert(1)>";d.zones[0]!.kind="miju";
  d.timeline.find(e=>e.id==="end")!.payload={total:100,delivered:100,aTotal:20};
  const m=model([d]);assert.equal(m.miju.a,20);assert.equal(m.miju.b,80);assert.equal(m.current.buckets[0]!.percent,100);assert(!renderStatistics(m).includes("<img"));
});
test("month partial comparison and leap days",()=>{
  const m=buildStatsModel([fixture("2026-08-09"),fixture("2026-08-10")],"month","2026-09-01","2026-09-30","2026-09-09");assert.equal(m.previous.quantity,100);assert.equal(m.previousEnd,"2026-08-09");
  assert(validStatsDate("2024-02-29"));assert(!validStatsDate("2026-02-29"));assert(!validStatsDate("2026-02-31"));assert.equal(shiftStatsDate("2024-03-01",-1),"2024-02-29");
  const feb=buildStatsModel([],"month","2024-03-01","2024-03-31","2024-03-31");assert.equal(feb.previousEnd,"2024-02-29");
});
test("empty and zero days do not render NaN/Infinity; auto inferred visible",()=>{
  assert(!/NaN|Infinity/.test(renderStatistics(model([]))));
  const d=fixture("2026-09-09",0);d.timeline[0]!.payload={total:0};d.timeline.find(e=>e.id==="sorted")!.payload={autoCleanup:true};const m=model([d]);assert.equal(m.current.quantity,0);assert.equal(m.current.autoDays,1);assert(!/NaN|Infinity/.test(renderStatistics(m)));
});
test("duplicate events and malformed shape cannot pollute totals",()=>{
  const d=fixture();d.timeline.push({...d.timeline.find(e=>e.id==="end")!,id:"double"});assert.equal(model([d]).current.days,0);
  const bad={...fixture(),timeline:null} as unknown as DayRecord;assert.equal(model([bad]).current.days,0);
});
test("negative, fractional, nonfinite and string quantity never yields fake efficiency",()=>{
  for(const n of [-1,1.5,NaN,Infinity,"1e9",Number.MAX_SAFE_INTEGER+1]){const d=fixture();d.timeline.find(e=>e.id==="end")!.payload={delivered:n,total:n};const m=model([d]);assert.equal(m.current.rate,undefined);assert(!/NaN|Infinity/.test(renderStatistics(m)));}
});
test("600 mutation combinations preserve source and numeric finiteness",()=>{
  for(let i=0;i<600;i++){
    const d=fixture("2026-09-09",i%13===0?99999:i%500);if(i%7===0)d.timeline[0]!.payload={};if(i%11===0)d.timeline.find(e=>e.id==="delivery")!.at=d.timeline[0]!.at;if(i%17===0)d.status="active";
    d.zones[0]!.kind=(["hils","miju","alt","custom"] as const)[i%4];
    const before=JSON.stringify(d),m=model([d]);assert.equal(JSON.stringify(d),before);assert(!/NaN|Infinity/.test(renderStatistics(m)));assert(m.current.buckets.every(b=>b.percent>=0&&b.percent<=100));
  }
});
test("bad references, missing counts, overrun helper and unsafe sums",()=>{
  const d=fixture();d.zones[0]!.endEventId="arrival";assert.equal(model([d]).current.days,0);
  const missing=fixture();missing.timeline.find(e=>e.id==="end")!.payload={};assert.equal(model([missing]).current.days,0);
  const h=fixture();h.timeline.push({...h.timeline[0]!,id:"helper",type:"helper_add",payload:{helperKind:"paid_received",sourceZoneId:"visit",quantity:101}});assert.equal(model([h]).current.quantity,100);assert.equal(model([h]).current.rate,undefined);
  assert.equal(model([fixture("2026-09-09",Number.MAX_SAFE_INTEGER)]).current.days,0);
});
test("scoped handling conservation, conflicting incident and invalid clock exclusion",()=>{
  const d=fixture();d.timeline.push({...d.timeline[0]!,id:"handling",type:"incident",zoneId:"visit",payload:{kind:"handling_time",minutes:30,affectsEfficiency:true}});
  const s=model([d]).current;assert.equal(s.parts.handling,30);assert.equal(s.parts.delivery,70);assert.equal(s.elapsed,190);assert.equal(s.rate,100*60/70);
  d.timeline.find(e=>e.id==="handling")!.payload={kind:"handling_time",minutes:999,affectsEfficiency:true};assert.equal(model([d]).current.timeDays,0);
  d.timeline.find(e=>e.id==="close")!.at="2026-09-09T07:00:00+09:00";assert.equal(model([d]).current.clockDays,0);
});
test("calendar edges, precision rounding and known expected positive/negative cancellation",()=>{
  assert.throws(()=>buildStatsModel([],"month","2026-10-01","2026-10-31","2026-09-09"));
  const week=buildStatsModel([],"week","2026-09-06","2026-09-12","2026-09-09");assert.equal(week.previousEnd,"2026-09-02");
  const a=fixture(),b=fixture("2026-09-08");b.timeline[0]!.payload={total:101};const m=model([a,b]);assert.equal(m.current.scan,0);assert.equal(m.current.scanAbsolute,2);
  m.current.startClock=539.8;m.current.parts.drive=59.8;const html=renderStatistics(m);assert(html.includes("09:00"));assert(!html.includes("0시간 60분"));
});
console.log(`Statistics: ${checks} groups + 600 mutation combinations passed`);
