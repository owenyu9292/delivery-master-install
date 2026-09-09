import assert from "node:assert/strict";

export async function runTimeChecks({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks,date,clock}) {
  let clockScript;
  const bootClock = async (hour, minute) => {
    if (clockScript) await send("Page.removeScriptToEvaluateOnNewDocument",{identifier:clockScript});
    const iso=date+"T"+String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0")+":00+09:00";
    clockScript=(await send("Page.addScriptToEvaluateOnNewDocument",{source:`(()=>{const Native=Date;window.__NativeDate=Native;window.__now=new Native(${JSON.stringify(iso)}).getTime();window.Date=class extends Native{constructor(...a){super(...(a.length?a:[window.__now]))}static now(){return window.__now}}})()`})).identifier;
  };
  const missing = (closed=false) => {
    const day=fixture(closed);
    day.timeline=day.timeline.filter(e=>!["sorted","delivery"].includes(e.id));
    delete day.zones[0].sortingEndEventId;delete day.zones[0].deliveryStartEventId;
    return day;
  };
  const time=(day,type)=>day.timeline.find(e=>e.type===type)?.at;
  const iso=t=>new Date(date+"T"+t+":00+09:00").toISOString();
  const edit = async(id,hour,minute)=>{
    await tab("log");
    await click('[data-action="open-log-edit"][data-event="'+id+'"]');
    await input("#log-edit-"+id+"-time-hour",hour);
    await input("#log-edit-"+id+"-time-minute",minute);
    await click('[data-action="save-log-edit"][data-event="'+id+'"]');
    await until('!document.querySelector('+JSON.stringify("#log-edit-"+id+"-time-minute")+')');
  };
  try {
    await bootClock(9,39);await seed(missing());
    assert(await ev('!!document.querySelector("[data-action=sorting-end]")'));
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,0);
    await clock(9,40);await ev('window.dispatchEvent(new Event("focus"))');
    await until('!!document.querySelector("#hils-count")');
    let day=await read();
    assert.equal(time(day,"sorting_end"),iso("09:30"));assert.equal(time(day,"delivery_start"),iso("09:30"));
    assert.equal(await ev('!!document.querySelector("[data-action=sorting-end]")'),false);
    assert.match(await ev("document.body.innerText"),/정리 30분 · 자동 적용/);
    await shot("12-auto-cleanup-delivery");
    assert.match(await ev('document.querySelector(".work-status").innerText'),/09:30/);
    await tab("log");
    assert(await ev('document.body.innerText.indexOf("정리 완료") < document.body.innerText.indexOf("배송 시작 자동 보정")'));
    await tab("work");
    const autoEnd=day.timeline.find(e=>e.type==="sorting_end").id, autoDelivery=day.timeline.find(e=>e.type==="delivery_start").id;
    await clock(11,0);await ev('window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus"))');await pause(250);
    assert.equal(time(await read(),"delivery_start"),iso("09:30"));
    await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector("#hils-count")');
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,1);
    checks.push("39min keeps sorting;40min sets09:30 finish+delivery;late11:00 resume/reload no extra finish button or duplicates");

    await edit(autoEnd,"09","45");
    day=await read();assert.equal(time(day,"sorting_end"),iso("09:45"));assert.equal(time(day,"delivery_start"),iso("09:45"));
    await edit(autoDelivery,"09","50");
    day=await read();assert.equal(time(day,"sorting_end"),iso("09:50"));assert.equal(time(day,"delivery_start"),iso("09:50"));
    await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector(".tabbar")');
    assert.equal(time(await read(),"sorting_end"),iso("09:50"));
    await tab("work");await clock(11,0);await input("#hils-count","100");await click('[data-action="zone-end"]');
    day=await read();assert.equal(day.timeline.find(e=>e.type==="zone_end").payload.delivered,100);
    await edit(autoEnd,"09","30");
    await tab("report");assert.match(await ev('document.querySelector(".report").innerText'),/실제 배송 소요\s+1시간 30분/);
    await shot("13-linked-corrected-report");
    checks.push("automatic boundary manual09:45->delivery09:50->reload->completion100->correct09:30; report90min, original start+completion unchanged");

    await bootClock(9,39);await seed(missing());
    const before=await read();
    await ev('window.__save=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__deliverySafety.runtime.store.saveDay=async()=>{throw Error("TEST_AUTO_SAVE_FAILED")}');
    await clock(11,0);await ev('window.dispatchEvent(new Event("focus"))');await pause(250);
    assert.deepEqual(await read(),before);assert(await ev('!!document.querySelector("[data-action=sorting-end]")'));
    await ev('window.__deliverySafety.runtime.store.saveDay=window.__save;window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus"))');
    await until('!!document.querySelector("#hils-count")');
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,1);
    checks.push("automatic write failure preserves original and sorting UI;retry simultaneous resume saves paired events once");

    await bootClock(11,0);await seed(missing());
    assert.equal(time(await read(),"sorting_end"),iso("09:30"));
    assert(await ev('!!document.querySelector("#hils-count")'));
    await seed(missing(true));
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,0);
    checks.push("cold reopen late creates anchored09:30;completed historical missing finish not silently changed");

    await seed(fixture(true));await edit("sorted","09","40");
    day=await read();assert.equal(time(day,"delivery_start"),iso("09:40"));
    const beforeEdit=await read();
    await tab("log");await click('[data-action="open-log-edit"][data-event="delivery"]');
    await input("#log-edit-delivery-time-hour","09");await input("#log-edit-delivery-time-minute","45");
    await ev('window.__save=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__deliverySafety.runtime.store.saveDay=async()=>{throw Error("TEST_LINK_SAVE_FAILED")}');
    await click('[data-action="save-log-edit"][data-event="delivery"]');
    assert.deepEqual(await read(),beforeEdit);
    assert.equal(await ev('document.querySelector("#log-edit-delivery-time-minute").value'),"45");
    await ev('window.__deliverySafety.runtime.store.saveDay=window.__save');
    await click('[data-action="save-log-edit"][data-event="delivery"]');
    assert.equal(time(await read(),"sorting_end"),iso("09:45"));
    await edit("sorted","11","30");
    await tab("report");assert.match(await ev('document.querySelector(".report").innerText'),/실제 효율\s+미확정/);
    assert.equal(time(await read(),"zone_end"),date+"T11:00:00+09:00");
    await edit("delivery","09","50");
    day=await read();assert.equal(time(day,"sorting_end"),iso("09:50"));assert.equal(day.timeline.find(e=>e.type==="zone_end").payload.delivered,100);
    checks.push("completed manual sort/delivery bidirectional; paired save failure atomic; genuine end conflict unknown efficiency then recover; count100 preserved");

    await tab("work");
    await ev('const e=document.querySelector("#edit-hils-sorting-end");for(let p=e?.parentElement;p;p=p.parentElement)if(p.tagName==="DETAILS")p.open=true;e.value="10:00";e.dispatchEvent(new Event("input",{bubbles:true}))');
    await click('[data-action="save-zone-edit"][data-zone="hils"]');
    assert.equal(time(await read(),"sorting_end"),iso("10:00"));assert.equal(time(await read(),"delivery_start"),iso("10:00"));
    checks.push("completed zone form validates linked candidate, not stale09:50 delivery value; accepts sorting10:00 and updates both");
    await seed(fixture(true));await edit("arrive","09","05");
    day=await read();assert.equal(time(day,"zone_start"),iso("09:05"));assert.equal(time(day,"sorting_start"),iso("09:05"));
    assert.equal(time(day,"sorting_end"),date+"T09:20:00+09:00");assert.equal(time(day,"zone_end"),date+"T11:00:00+09:00");
    await edit("end","11","10");
    day=await read();assert.equal(time(day,"day_close"),iso("11:10"));
    await edit("close","11","15");assert.equal(time(await read(),"zone_end"),iso("11:15"));
    checks.push("arrival->first zone+sorting boundary; final zone end<->day close both directions; independent work intervals stay fixed");
    const overnight=fixture(true);
    const tomorrow=new Date(new Date(date+"T12:00:00+09:00").getTime()+86400000).toISOString().slice(0,10);
    overnight.timeline=overnight.timeline.map(e=>["end","close"].includes(e.id)?{...e,at:tomorrow+"T00:10:00+09:00"}:e);
    await seed(overnight);await edit("end","00","20");
    day=await read();assert.equal(time(day,"zone_end"),new Date(tomorrow+"T00:20:00+09:00").toISOString());
    assert.equal(time(day,"day_close"),time(day,"zone_end"));
    checks.push("after-midnight time edit retains next calendar date and linked close; does not jump back to work date");

    await bootClock(9,39);await seed(missing());
    await tab("log");await click('[data-action="open-log-edit"][data-event="sort"]');
    await input("#log-edit-sort-time-hour","09");await input("#log-edit-sort-time-minute","10");
    await clock(9,40);await ev('window.dispatchEvent(new Event("focus"))');await pause(250);
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,0);
    assert.equal(await ev('document.querySelector("#log-edit-sort-time-minute").value'),"10");
    await click('[data-action="save-log-edit"][data-event="sort"]');
    await until('!document.querySelector("#log-edit-sort-time-minute")');
    await clock(9,49);await ev('window.dispatchEvent(new Event("focus"))');await pause(200);
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,0);
    await clock(9,50);await ev('window.dispatchEvent(new Event("focus"))');await pause(250);
    assert.equal(time(await read(),"sorting_end"),iso("09:40"));
    checks.push("editing sorting start at40min blocks automatic overwrite; save09:10 restarts threshold;49none/50creates09:40");

    await bootClock(9,39);await seed(missing());
    await click('[data-action="sorting-end"]');
    assert.equal(time(await read(),"sorting_end"),iso("09:39"));
    await clock(11,0);await ev('window.dispatchEvent(new Event("focus"))');await pause(200);
    assert.equal(time(await read(),"sorting_end"),iso("09:39"));
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,1);
    checks.push("manual finish39min remains39 after late resume; automatic rule never overwrites manual record");

    await bootClock(9,39);await seed(missing());
    await clock(11,0);await click('[data-action="sorting-end"]');
    await until('!!document.querySelector("#hils-count")');
    assert.equal(time(await read(),"sorting_end"),iso("09:30"));
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,1);
    checks.push("stale sorting-finish button clicked after threshold creates09:30 not late11:00 and advances workflow");

    await bootClock(9,39);await seed(missing());
    const beforePending=await read();
    await ev('window.__save=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__writes=0;window.__deliverySafety.runtime.store.saveDay=async(d)=>{window.__writes++;await new Promise(r=>window.__releaseWrite=r);return window.__save(d)}');
    await clock(9,40);await ev('window.dispatchEvent(new Event("focus"))');
    await until('typeof window.__releaseWrite==="function"');
    await click('[data-action="sorting-end"]');
    await ev('window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("focus"))');
    assert.equal(await ev('window.__writes'),1);assert.deepEqual(await read(),beforePending);
    await ev('window.__releaseWrite()');await until('!!document.querySelector("#hils-count")');
    assert.equal(await ev('window.__writes'),1);
    assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,1);
    await ev('window.__deliverySafety.runtime.store.saveDay=window.__save');
    checks.push("slow automatic save + stale finish tap + simultaneous focus callbacks serialize to one atomic write");

    for(const kind of ["miju","alt","custom"]){
      const other=missing();other.zones[0].kind=kind;
      await bootClock(11,0);await seed(other);
      assert.equal((await read()).timeline.filter(e=>e.type==="sorting_end").length,0);
      assert(await ev('!!document.querySelector("[data-action=sorting-end]")'));
    }
    checks.push("hils-labelled records with explicit miju/alt/custom kind never receive automatic hils30 correction");
  } finally {
    if(clockScript)await send("Page.removeScriptToEvaluateOnNewDocument",{identifier:clockScript});
  }
}
