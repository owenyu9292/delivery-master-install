import assert from "node:assert/strict";

export async function runStatisticsChecks({ev,send,seed,fixture,read,click,tab,until,pause,shot,checks,date}) {
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
  await seed(fixture(true));
  const original=await read();
  const shift=n=>new Date(Date.parse(date+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
  const records=[];
  for(let i=0;i<400;i++){
    const d=structuredClone(original),day=shift(-i);d.date=day;d.id="stats-"+day;
    for(const e of d.timeline){e.at=e.at.replace(date,day);e.createdAt=e.createdAt.replace(date,day);e.updatedAt=e.updatedAt.replace(date,day);}
    d.meta.createdAt=d.meta.createdAt.replace(date,day);d.meta.updatedAt=d.meta.updatedAt.replace(date,day);
    d.zones[0].kind=["miju","hils","alt","custom"][i%4];d.zones[0].name="같은 이름 <긴 이름> "+"가".repeat(30);
    const end=d.timeline.find(e=>e.type==="zone_end");end.payload={total:100+i,delivered:100+i,failed:0,extra:0,...(i%4===0?{aTotal:40}:{})};
    if(i%9===0)d.timeline[0].payload={};
    if(i%13===0)d.timeline.find(e=>e.type==="delivery_start").at=d.timeline[0].at;
    if(i%19===0)d.status="active";
    records.push(d);
  }
  records[0]=original;
  const copy=structuredClone(records[1]);copy.date+="__copy_20260909000000";copy.id+="-copy";records.push(copy);
  const write=JSON.stringify(records);
  await ev(`new Promise((resolve,reject)=>{const o=indexedDB.open('delivery-master-install');o.onsuccess=()=>{const db=o.result;const tx=db.transaction('dayRecords','readwrite');for(const r of ${write})tx.objectStore('dayRecords').put(r);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=reject}})`);
  await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector(".tabbar")');await tab("stats");
  await click('[data-action="set-stats-tab"][data-stats-tab="month"]');
  await until('!!document.querySelector(".statistics-analysis")');
  const readAll=()=>ev(`new Promise(r=>{const o=indexedDB.open('delivery-master-install');o.onsuccess=()=>{const db=o.result;const q=db.transaction('dayRecords').objectStore('dayRecords').getAll();q.onsuccess=()=>{db.close();r(q.result)}}})`);
  const before=await readAll();
  assert.equal(before.length,401);
  assert(!/NaN|Infinity|undefined/.test(await ev('document.querySelector(".statistics-analysis").innerText')));
  assert.equal(await ev('document.querySelectorAll(".analysis-trend-item").length'),6);
  assert.equal(await ev('document.querySelectorAll(".analysis-ratios>div").length'),3);
  await ev('document.querySelector(".analysis-ratio").scrollIntoView({block:"start"})');await shot("12-statistics-411");
  const current=await ev('document.querySelector(".statistics-analysis").innerText');
  for(let i=0;i<18;i++)await click('[data-action="stats-month-prev"]');
  for(let i=0;i<18;i++)await click('[data-action="stats-month-next"]');
  assert.equal(await ev('document.querySelector(".statistics-analysis").innerText'),current);
  checks.push("statistics: 401 records; 18-month back/forward; same totals; 6-period trend; no NaN/Infinity");
  for(const width of [411,360]){
    await send("Emulation.setDeviceMetricsOverride",{width,height:762,deviceScaleFactor:2.63,mobile:true});
    await ev('[...document.querySelectorAll(".analysis-detail")].forEach((e,i)=>e.id="qa-detail-"+i)');
    const count=await ev('document.querySelectorAll(".analysis-detail").length');
    for(let i=0;i<count;i++)if(!await ev(`document.querySelector('#qa-detail-${i}').open`))await click(`#qa-detail-${i}>summary`);
    assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false,"stats overflow "+width);
    assert.equal(await ev('[...document.querySelectorAll(".statistics-analysis strong,.statistics-analysis summary")].some(e=>e.scrollWidth>e.clientWidth+2)'),false,"stats text clipped "+width);
  }
  await ev('[...document.querySelectorAll(".statistics-analysis *")].filter(e=>e instanceof HTMLElement).map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]).forEach(([e,size])=>e.style.fontSize=(size*1.5)+"px")');
  assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false,"150 percent stats overflow");
  await ev('document.querySelector(".analysis-ratio").scrollIntoView({block:"start"})');await shot("13-statistics-large-text-360");
  checks.push("statistics: all detail panels, 411/360 widths, 150percent text, long names, no horizontal clipping");
  await click('.analysis-quality summary');
  await click('[data-action="stats-open-date"]');
  assert(await ev('!!document.querySelector("#stats-date-input")'));
  await tab("log");await tab("work");await tab("stats");
  assert.deepEqual(await readAll(),before,"statistics navigation mutated stored data");
  checks.push("statistics: quality item opens date; tab changes and repeated navigation leave all 401 records unchanged");
  await seed(fixture(true));await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
}
