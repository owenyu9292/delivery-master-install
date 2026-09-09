import { calculateDay } from "../domain/deliveryCalc";
import { getZoneKind, type ZoneKind } from "../domain/zoneIdentity";
import { validateTimeAxis } from "../domain/timeAxisValidation";
import { assertDayRecord } from "../storage/recordValidation";
import type { DayRecord, TimelineEvent } from "../domain/types";

export type StatsMode = "week" | "month";
export type TimeKey = "drive" | "movement" | "sorting" | "delivery" | "handling" | "other" | "unknown";
export type HelperMode = "solo" | "free" | "paid" | "mixed";
export interface StatsIssue { date: string; label: string; code: string; }
export interface StatsVisit { kind: ZoneKind; name: string; quantity: number; minutes?: number; numerator: number; a?: number; b?: number; }
export interface StatsDay {
  date: string; quantity: number; expected?: number; scan?: number; failed: number; extra: number;
  numerator: number; minutes?: number; rate?: number; elapsed?: number; parts?: Record<TimeKey, number>;
  startClock?: number; endClock?: number; auto: boolean; helperMode: HelperMode;
  free: number; paid: number; separate: number; helperUncounted: number; visits: StatsVisit[];
}
export interface StatsSummary {
  days: number; quantity: number; dailyAverage?: number; rate?: number; rateDays: number;
  failed: number; extra: number; scan?: number; scanDays: number; scanAbsolute: number;
  autoDays: number; elapsed?: number; timeDays: number; parts: Record<TimeKey, number>;
  startClock?: number; endClock?: number; clockDays: number;
  free: number; paid: number; separate: number; helperUncounted: number;
  buckets: { key: string; label: string; quantity: number; percent: number }[];
  visits: { kind: ZoneKind; quantity: number; visits: number; rate?: number; validVisits: number }[];
}
export interface StatsModel {
  start: string; end: string; previousStart: string; previousEnd: string;
  current: StatsSummary; previous: StatsSummary; days: StatsDay[]; issues: StatsIssue[]; pending: number;
  trend: { start: string; end: string; label: string; stats: StatsSummary }[];
  bands: { label: string; stats: StatsSummary }[];
  weekdays: { label: string; stats: StatsSummary }[];
  helpers: { label: string; stats: StatsSummary }[];
  miju: { a: number; b: number; samples: number; missing: number };
}
const payload = (e?: TimelineEvent) => (e?.payload ?? {}) as Record<string, unknown>;
const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const minutes = (a?: string, b?: string): number | undefined => {
  const n = (Date.parse(b ?? "") - Date.parse(a ?? "")) / 60000;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const emptyParts = (): Record<TimeKey, number> => ({drive:0,movement:0,sorting:0,delivery:0,handling:0,other:0,unknown:0});
export function validStatsDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date+"T00:00:00Z")) && new Date(date+"T00:00:00Z").toISOString().slice(0,10) === date;
}
export function shiftStatsDate(date: string, amount: number): string {
  return new Date(Date.parse(date+"T00:00:00Z")+amount*86400000).toISOString().slice(0,10);
}
function priorRange(start: string, end: string, mode: StatsMode): {start:string;end:string} {
  if(mode==="week")return {start:shiftStatsDate(start,-7),end:shiftStatsDate(end,-7)};
  const s=new Date(start+"T00:00:00Z");s.setUTCMonth(s.getUTCMonth()-1,1);
  const e=new Date(s);e.setUTCMonth(e.getUTCMonth()+1,0);
  return {start:s.toISOString().slice(0,10),end:e.toISOString().slice(0,10)};
}
function sameElapsedEnd(start: string,end: string,previous:{start:string;end:string},partial:boolean): string {
  if(!partial)return previous.end;
  const length=Math.round((Date.parse(end)-Date.parse(start))/86400000);
  return [shiftStatsDate(previous.start,length),previous.end].sort()[0]!;
}
function inspect(history: readonly DayRecord[],today: string): {days:StatsDay[];issues:StatsIssue[];pending:string[]} {
  const issues:StatsIssue[]=[],byDate=new Map<string,DayRecord>(),pending:string[]=[];
  for(const record of history){
    const date=typeof record?.date==="string"?record.date:"자료";
    if(date.includes("__copy_")){issues.push({date:date.slice(0,10),label:"백업 복사본 제외",code:"copy"});continue;}
    if(!validStatsDate(date)){issues.push({date,label:"잘못된 날짜 제외",code:"date"});continue;}
    if(date>today){issues.push({date,label:"미래 기록 제외",code:"future"});continue;}
    try{assertDayRecord(record);}catch{issues.push({date,label:"손상된 기록 제외 · 원본 보존",code:"invalid"});continue;}
    const previous=byDate.get(date);
    if(previous){
      issues.push({date,label:"같은 날짜 중복 · 최신 기록 1건 사용",code:"duplicate"});
      const a=Date.parse(record.meta.updatedAt)||0,b=Date.parse(previous.meta.updatedAt)||0;
      if(a<b || a===b && record.id.localeCompare(previous.id)<=0)continue;
    }
    byDate.set(date,record);
  }
  const days:StatsDay[]=[];
  for(const record of [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))){
    const date=record.date,add=(code:string,label:string)=>issues.push({date,code,label});
    if(record.status!=="closed" || !record.timeline.some(e=>e.type==="day_close")){
      if(record.timeline.some(e=>e.type==="depart_jinjeop"||e.type==="zone_start"))pending.push(date);
      continue;
    }
    if(!record.timeline.some(e=>e.type==="depart_jinjeop"||e.type==="zone_start"||e.type==="helper_add"))continue;
    const stages=new Set<string>();let ambiguous=false;
    for(const event of record.timeline){
      if(["incident","manual_adjust","helper_add"].includes(event.type))continue;
      const key=(event.zoneId??"day")+":"+event.type;
      if(stages.has(key))ambiguous=true;stages.add(key);
    }
    if(ambiguous){add("duplicate_stage","시작·완료 중복 · 집계 제외");continue;}
    const fields = {startEventId:"zone_start",sortingStartEventId:"sorting_start",sortingEndEventId:"sorting_end",deliveryStartEventId:"delivery_start",endEventId:"zone_end"} as const;
    const invalidReference = record.zones.some(z => Object.entries(fields).some(([field,type]) => {
      const id=z[field as keyof typeof fields];
      return id !== undefined && !record.timeline.some(e=>e.id===id&&e.zoneId===z.id&&e.type===type);
    }));
    const orphan=record.timeline.some(e=>["zone_start","zone_end","sorting_start","sorting_end","delivery_start"].includes(e.type)&&!record.zones.some(z=>z.id===e.zoneId));
    if(invalidReference||orphan){add("reference","구역·기록 연결 손상 · 집계 제외");continue;}
    const invalidCount=record.timeline.some(e=>{
      if(e.type==="zone_end"&&payload(e).delivered===undefined&&payload(e).total===undefined)return true;
      const keys=e.type==="zone_end"?["total","delivered","failed","extra","aTotal","bTotal","building1Total","building2Total","building3Total","restTotal"]:e.type==="helper_add"?["quantity"]:[];
      return keys.some(key=>payload(e)[key]!==undefined&&(!Number.isSafeInteger(payload(e)[key])||Number(payload(e)[key])<0));
    });
    if(invalidCount){add("quantity","원본 수량 형식 확인 · 집계 제외");continue;}
    let calculation;
    try{calculation=calculateDay(record);}catch{add("calculation","계산할 수 없는 자료 · 집계 제외");continue;}
    const totals=calculation.totals;
    if(![totals.deliveredCount,totals.efficiencyCount??totals.deliveredCount,totals.failedCount,totals.extraCount].every(nonnegative)
      || !Number.isSafeInteger(totals.deliveredCount) || totals.deliveredCount > Number.MAX_SAFE_INTEGER / 366){
      add("quantity","유효하지 않은 수량 · 집계 제외");continue;
    }
    const quantity=totals.deliveredCount;
    const depart=record.timeline.find(e=>e.type==="depart_jinjeop"),arrive=record.timeline.find(e=>e.type==="arrive_cheongnyangni"),close=record.timeline.find(e=>e.type==="day_close");
    const elapsed=minutes(depart?.at,close?.at);
    const expectedRaw=payload(depart).total;
    const expected=nonnegative(expectedRaw)&&Number.isSafeInteger(expectedRaw)?expectedRaw:undefined;
    if(expected===undefined)add("expected","예상 수량 없음 · 스캔차 제외");
    const inferred=record.zones.some(z=>record.timeline.some(e=>e.zoneId===z.id&&e.type==="zone_end")&&!record.timeline.some(e=>e.zoneId===z.id&&e.type==="delivery_start"));
    const auto=inferred||record.timeline.some(e=>payload(e).autoCleanup===true||payload(e).autoCorrected===true);
    if(auto)add("auto","자동 보정 시간 포함");
    let reliable=record.timeline.every(e=>Number.isFinite(Date.parse(e.at))) && validateTimeAxis(record).length===0;
    if(!reliable)add("time","시간 순서 확인 · 효율 제외");
    if(new Set(record.zones.map(z=>z.order)).size!==record.zones.length){reliable=false;add("order","구역 순번 중복 · 효율 제외");}
    const helperOverrun=record.zones.some(z=>{
      const contributions=record.timeline.filter(e=>e.type==="helper_add"&&payload(e).sourceZoneId===z.id&&payload(e).unpaid!==true);
      const count=calculation.zones.find(c=>c.zoneId===z.id)?.counts.delivered??0;
      return contributions.reduce((sum,e)=>sum+(Number(payload(e).quantity)||0),0)>count;
    });
    if(helperOverrun){reliable=false;add("helper","도우미 수량이 소속 구역 초과 · 효율 제외");}
    if(quantity>1200 || calculation.zones.some(z=>z.counts.delivered>800)){
      reliable=false;add("large_quantity","과대 수량 확인 · 수량은 포함, 효율 제외");
    }
    if(elapsed===undefined||elapsed>1440){reliable=false;add("duration","전체 업무 시간 누락·범위 확인");}
    const visits:StatsVisit[]=[];
    for(const z of record.zones){
      const end=record.timeline.find(e=>e.zoneId===z.id&&e.type==="zone_end");
      if(!end){if(record.timeline.some(e=>e.zoneId===z.id&&e.type==="zone_start")){reliable=false;add("unfinished","시작한 구역 미완료");}continue;}
      const calc=calculation.zones.find(c=>c.zoneId===z.id)!;
      const p=payload(end),a=nonnegative(p.aTotal)?p.aTotal:
        [p.building1Total,p.building2Total,p.building3Total].every(nonnegative)?Number(p.building1Total)+Number(p.building2Total)+Number(p.building3Total):undefined;
      const validA=a!==undefined&&a<=calc.counts.delivered;
      if(getZoneKind(z)==="miju"&&a!==undefined&&!validA)add("miju","미주 A 수량이 전체 초과 · 상세 제외");
      visits.push({kind:getZoneKind(z),name:z.name,quantity:calc.counts.delivered,minutes:calc.efficiencyPerHour===undefined?undefined:calc.deliveryMinutes,
        numerator:calc.efficiencyCount??calc.counts.delivered,...(getZoneKind(z)==="miju"&&validA?{a,b:calc.counts.delivered-a!}:{})});
    }
    let parts:Record<TimeKey,number>|undefined;
    if(reliable && elapsed!==undefined){
      const p=emptyParts();p.drive=minutes(depart?.at,arrive?.at)??0;
      p.delivery=totals.deliveryMinutes??0;
      const ordered=[...record.zones].sort((a,b)=>a.order-b.order);
      let previousEnd:string|undefined;
      for(const z of ordered){
        const get=(t:TimelineEvent["type"])=>record.timeline.find(e=>e.zoneId===z.id&&e.type===t)?.at;
        const start=get("zone_start"),end=get("zone_end");if(!start||!end)continue;
        p.sorting+=minutes(get("sorting_start"),get("sorting_end"))??0;
        p.movement+=(minutes(previousEnd,start)??0)+(minutes(start,get("sorting_start"))??0);
        previousEnd=end;
      }
      let unscoped=0;
      for(const event of record.timeline.filter(e=>e.type==="incident")){
        const data=payload(event),n=data.minutes;
        if(!nonnegative(n)||data.affectsEfficiency===false)continue;
        if(!event.zoneId){unscoped+=n;continue;}
        if(data.kind==="handling_time")p.handling+=n;else p.other+=n;
      }
      const known=Object.values(p).reduce((a,b)=>a+b,0);
      if(!arrive || known+unscoped>elapsed+0.01){add("overlap","시간 구성 중복·누락 확인");}
      else {p.other+=unscoped;p.unknown=Math.max(0,elapsed-known-unscoped);parts=p;}
    }
    if(totals.efficiencyPerHour===undefined||!nonnegative(totals.deliveryMinutes)||totals.deliveryMinutes<1){
      reliable=false;add("efficiency","배송 시간 미확정 · 효율 제외");
    }
    if(totals.efficiencyPerHour!==undefined&&totals.efficiencyPerHour>600){
      reliable=false;add("rate","시간당 600개 초과 확인 · 효율 제외");
    }
    if(!reliable)for(const visit of visits)visit.minutes=undefined;
    const helperEvents=record.timeline.filter(e=>e.type==="helper_add"&&payload(e).unpaid!==true);
    const free=helperEvents.some(e=>payload(e).helperKind==="free_received"),paid=helperEvents.some(e=>payload(e).helperKind==="paid_received");
    const clock=(iso?:string)=>{const n=Date.parse(iso??"");if(!Number.isFinite(n))return undefined;const d=new Date(n+9*3600000);return d.getUTCHours()*60+d.getUTCMinutes();};
    const startClock=reliable?clock(depart?.at):undefined;
    const endClock=startClock!==undefined&&elapsed!==undefined&&elapsed<=1440?startClock+elapsed:undefined;
    days.push({date,quantity,expected,scan:expected===undefined?undefined:quantity-expected,failed:totals.failedCount,extra:totals.extraCount,
      numerator:totals.efficiencyCount??quantity,minutes:reliable?totals.deliveryMinutes:undefined,rate:reliable?totals.efficiencyPerHour:undefined,
      elapsed:elapsed!==undefined&&elapsed<=1440?elapsed:undefined,parts,startClock:endClock===undefined?undefined:startClock,endClock,auto,
      helperMode:free&&paid?"mixed":paid?"paid":free?"free":"solo",
      free:(totals.helperFreeCount??0)+(totals.helperZoneFreeCount??0),paid:(totals.helperPaidCount??0)+(totals.helperZonePaidCount??0),
      separate:(totals.helperFreeCount??0)+(totals.helperPaidCount??0),helperUncounted:helperEvents.filter(e=>["free_received","paid_received"].includes(String(payload(e).helperKind))&&!nonnegative(payload(e).quantity)).length,visits});
  }
  return {days,issues,pending};
}
export function summarizeStats(days:readonly StatsDay[]):StatsSummary {
  const total=(fn:(d:StatsDay)=>number)=>days.reduce((sum,d)=>sum+fn(d),0);
  const known=days.filter(d=>d.rate!==undefined&&d.minutes!==undefined),duration=known.reduce((sum,d)=>sum+d.minutes!,0);
  const scans=days.filter(d=>d.scan!==undefined),timeDays=days.filter(d=>d.parts),clocks=days.filter(d=>d.startClock!==undefined&&d.endClock!==undefined);
  const parts=emptyParts();for(const d of timeDays)for(const key of Object.keys(parts) as TimeKey[])parts[key]+=d.parts![key];
  const counts={miju:0,hils:0,alternate:0};for(const d of days)for(const v of d.visits)counts[v.kind==="miju"?"miju":v.kind==="hils"?"hils":"alternate"]+=v.quantity;
  const zoneTotal=Object.values(counts).reduce((a,b)=>a+b,0),labels={miju:"미주",hils:"힐스",alternate:"대체·추가"};
  return {days:days.length,quantity:total(d=>d.quantity),dailyAverage:days.length?total(d=>d.quantity)/days.length:undefined,
    rate:duration>=1?known.reduce((sum,d)=>sum+d.numerator,0)*60/duration:undefined,rateDays:known.length,
    failed:total(d=>d.failed),extra:total(d=>d.extra),scan:scans.length?scans.reduce((sum,d)=>sum+d.scan!,0):undefined,scanDays:scans.length,
    scanAbsolute:scans.reduce((sum,d)=>sum+Math.abs(d.scan!),0),autoDays:days.filter(d=>d.auto).length,
    elapsed:timeDays.length?Object.values(parts).reduce((a,b)=>a+b,0):undefined,timeDays:timeDays.length,parts,
    startClock:clocks.length?clocks.reduce((s,d)=>s+d.startClock!,0)/clocks.length:undefined,
    endClock:clocks.length?clocks.reduce((s,d)=>s+d.endClock!,0)/clocks.length:undefined,clockDays:clocks.length,
    free:total(d=>d.free),paid:total(d=>d.paid),separate:total(d=>d.separate),helperUncounted:total(d=>d.helperUncounted),
    buckets:(Object.keys(counts) as (keyof typeof counts)[]).map(key=>({key,label:labels[key],quantity:counts[key],percent:zoneTotal?counts[key]*100/zoneTotal:0})),
    visits:(["miju","hils","alt","custom"] as ZoneKind[]).map(kind=>{
      const visits=days.flatMap(d=>d.visits).filter(v=>v.kind===kind),valid=visits.filter(v=>v.minutes!==undefined&&v.minutes>=1),mins=valid.reduce((s,v)=>s+v.minutes!,0);
      return {kind,quantity:visits.reduce((s,v)=>s+v.quantity,0),visits:visits.length,validVisits:valid.length,rate:mins>=1?valid.reduce((s,v)=>s+v.numerator,0)*60/mins:undefined};
    })};
}
export function buildStatsModel(history:readonly DayRecord[],mode:StatsMode,start:string,end:string,today:string):StatsModel {
  if(![start,end,today].every(validStatsDate)||start>end||start>today)throw new Error("통계 기간을 확인하세요.");
  const prepared=inspect(history,today),actualEnd=end>today?today:end;
  const range=priorRange(start,end,mode),previousEnd=sameElapsedEnd(start,actualEnd,range,actualEnd<end);
  const inRange=(a:string,b:string)=>prepared.days.filter(d=>d.date>=a&&d.date<=b);
  const days=inRange(start,actualEnd),current=summarizeStats(days),previous=summarizeStats(inRange(range.start,previousEnd));
  const trend:StatsModel["trend"]=[];
  let trendRange={start,end};
  for(let i=0;i<6;i++){
    const cutoff=trendRange.end>today?today:trendRange.end;
    trend.unshift({start:trendRange.start,end:cutoff,label:mode==="month"?trendRange.start.slice(2,7):trendRange.start.slice(5).replace("-","/"),stats:summarizeStats(inRange(trendRange.start,cutoff))});
    trendRange=priorRange(trendRange.start,trendRange.end,mode);
  }
  const miju=days.flatMap(d=>d.visits).filter(v=>v.kind==="miju"),known=miju.filter(v=>v.a!==undefined);
  return {start,end:actualEnd,previousStart:range.start,previousEnd,current,previous,days,trend,
    pending:prepared.pending.filter(d=>d>=start&&d<=actualEnd).length,
    issues:prepared.issues.filter(i=>!validStatsDate(i.date)||i.date>=start&&i.date<=end),
    bands:[{label:"0~99개",stats:summarizeStats(days.filter(d=>d.quantity<100))},{label:"100~299개",stats:summarizeStats(days.filter(d=>d.quantity>=100&&d.quantity<300))},{label:"300~499개",stats:summarizeStats(days.filter(d=>d.quantity>=300&&d.quantity<500))},{label:"500개 이상",stats:summarizeStats(days.filter(d=>d.quantity>=500))}],
    weekdays:["일","월","화","수","목","금","토"].map((label,i)=>({label,stats:summarizeStats(days.filter(d=>new Date(d.date+"T00:00:00Z").getUTCDay()===i))})),
    helpers:([{key:"solo",label:"혼자"},{key:"free",label:"무료 도움"},{key:"paid",label:"유료 도움"},{key:"mixed",label:"무료+유료"}] as const).map(g=>({label:g.label,stats:summarizeStats(days.filter(d=>d.helperMode===g.key))})),
    miju:{a:known.reduce((s,v)=>s+v.a!,0),b:known.reduce((s,v)=>s+v.b!,0),samples:known.length,missing:miju.length-known.length}};
}
