import assert from "node:assert/strict";

export async function runBasicAudit({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks}) {
  await seed(fixture(true));
  const baseline=await read();
  await tab("log");await click('[data-action="open-log-edit"][data-event="end"]');
  for(const value of ["-1","1.5","1e2","a12","123456"]) {
    await input("#log-edit-end-delivered",value);
    await click('[data-action="save-log-edit"]');
    assert.deepEqual(await read(),baseline,"invalid quantity changed stored day: "+value);
    assert.equal(await ev('document.querySelector("#log-edit-end-delivered").value'),value);
  }
  await input("#log-edit-end-delivered","100");await click('[data-action="save-log-edit"]');
  await until('!document.querySelector(".timeline-inline-editor")');
  checks.push("raw negative/decimal/exponent/text log quantities retained and rejected; corrected input saves without record loss");

  await seed(fixture(true));await tab("log");
  await click('[data-action="open-log-edit"][data-event="start"]');
  const beforeTime=await read();
  for(const [part,value] of [["hour","-1"],["hour","a1"],["hour","24"],["hour","123"],["minute","60"],["minute",".5"]]) {
    await input("#log-edit-start-time-hour","09");await input("#log-edit-start-time-minute","00");
    await input("#log-edit-start-time-"+part,value);
    await click('[data-action="save-log-edit"]');
    assert.deepEqual(await read(),beforeTime,"invalid time changed record: "+part+value);
    assert.equal(await ev('document.querySelector("#log-edit-start-time-'+part+'").value'),value);
  }
  await input("#log-edit-start-time-hour","09");await input("#log-edit-start-time-minute","05");
  await click('[data-action="save-log-edit"]');await until('!document.querySelector(".timeline-inline-editor")');
  assert.match((await read()).timeline.find(e=>e.id==="start").at,/T00:05|T09:05/);
  checks.push("invalid signed/text/range time tokens cannot silently change time; immediate valid retry succeeds");

  await seed(fixture());await input("#hils-count","87");
  const draftBefore=await read();
  for(let i=0;i<6;i++) {
    await tab(["log","stats","backup","report"][i%4]);await tab("work");
    assert.equal(await ev('document.querySelector("#hils-count").value'),"87");
  }
  await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector("#hils-count")');
  assert.equal(await ev('document.querySelector("#hils-count").value'),"87");
  assert.deepEqual(await read(),draftBefore);
  checks.push("unsaved quantity survives six tab round trips and reload with saved day unchanged");

  await tab("log");await click('[data-action="open-log-edit"][data-event="start"]');
  await input("#log-edit-start-time-hour","10");
  const beforeDraft=await read();
  await tab("work");await tab("log");
  if(!await ev('!!document.querySelector("#log-edit-start-time-hour")'))await click('[data-action="open-log-edit"][data-event="start"]');
  assert.equal(await ev('document.querySelector("#log-edit-start-time-hour").value'),"10");
  await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector(".tabbar")');
  await tab("log");await click('[data-action="open-log-edit"][data-event="start"]');
  assert.equal(await ev('document.querySelector("#log-edit-start-time-hour").value'),"10");
  assert.deepEqual(await read(),beforeDraft);
  checks.push("unsaved log-time edit survives tabs and reopening after reload; no implicit data write");

  // Exercise keyboard Next/Tab focus rather than manually focusing every field.
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:320,deviceScaleFactor:2.63,mobile:true});
  await click("#log-edit-start-time-hour");
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
  await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});await pause(200);
  assert.equal(await ev('document.activeElement.id'),"log-edit-start-time-minute");
  const focus=await ev('(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),n=document.querySelector(".tabbar").getBoundingClientRect();return {top:r.top,bottom:r.bottom,nav:n.top,hit:e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)}})()');
  assert(focus.top>=0&&focus.bottom<=focus.nav&&focus.hit,JSON.stringify(focus));
  await shot("21-basic-next-input");
  assert.deepEqual(await read(),beforeDraft);
  checks.push("keyboard Next focus moves to minute and remains tappable above navigation at 411x320");

  await seed(fixture());await input("#hils-count","87");
  const resizeBefore=await read();
  for(let i=0;i<12;i++) {
    const [width,height]=i%3===0?[762,411]:i%3===1?[411,320]:[411,870];
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:2.63,mobile:true});await pause(100);
    await ev('window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"))');
    assert.equal(await ev('document.querySelector("#hils-count").value'),"87");
    assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false);
  }
  assert.deepEqual(await read(),resizeBefore);
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
  checks.push("12 rotate/resize/resume event cycles retain quantity draft, no horizontal overflow or stored writes");
  await seed(fixture(true));await tab("log");await click('[data-action="open-log-edit"][data-event="end"]');
  await input("#log-edit-end-delivered","101");
  const pendingBefore=await read();
  await ev('document.querySelectorAll(".toast").forEach(e=>e.remove());window.__auditRealSave=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__deliverySafety.runtime.store.saveDay=()=>new Promise((resolve,reject)=>{window.__auditFailSave=()=>reject(new Error("AUDIT_DISK_FAILURE"))})');
  await ev('document.querySelector("[data-action=save-log-edit]").click()');await pause(300);
  assert.equal(await ev('[...document.querySelectorAll(".toast")].some(e=>e.textContent.includes("저장했습니다"))'),false,"success notice before disk commit");
  assert.deepEqual(await read(),pendingBefore);
  await ev('window.__auditFailSave()');await until('!!document.querySelector(".warning[role=alert]")');
  assert.deepEqual(await read(),pendingBefore);
  assert.equal(await ev('document.querySelector("#log-edit-end-delivered").value'),"101");
  await ev('window.__deliverySafety.runtime.store.saveDay=window.__auditRealSave');
  await click('[data-action="save-log-edit"]');await until('!document.querySelector(".timeline-inline-editor")');
  assert.equal((await read()).timeline.find(e=>e.id==="end").payload.delivered,101);
  checks.push("no success before delayed disk commit; injected failure preserves original+edit; valid retry saves101");
  const miju=fixture(false,"miju");miju.zones[0].name="미주";miju.zones[0].kind="miju";
  await seed(miju);
  for(const [n,value] of [[1,"11"],[2,"22"],[3,"33"]])await input("#miju-"+n+"-count",value);
  await click('[data-action="save-miju-detail"]');
  const checkpoint=await read();
  await ev('window.__auditRealSave=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__deliverySafety.runtime.store.saveDay=async()=>{throw new Error("AUDIT_CLEAR_FAILURE")}');
  await click('[data-action="clear-miju-detail"]');
  assert.deepEqual(await read(),checkpoint);
  for(const [n,value] of [[1,"11"],[2,"22"],[3,"33"]])assert.equal(await ev('document.querySelector("#miju-'+n+'-count").value'),value,"failed clear lost building draft");
  await ev('window.__deliverySafety.runtime.store.saveDay=window.__auditRealSave');
  checks.push("failed building-checkpoint clear preserves saved checkpoint and all three visible quantities");
  await input("#miju-total-count","90");await click('[data-action="clear-miju-detail"]');
  for(const n of [1,2,3])assert.equal(await ev('document.querySelector("#miju-'+n+'-count").value'),"");
  assert.equal(await ev('document.querySelector("#miju-total-count").value'),"90");
  await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector("#miju-total-count")');
  for(const n of [1,2,3])assert.equal(await ev('document.querySelector("#miju-'+n+'-count").value'),"");
  assert.equal(await ev('document.querySelector("#miju-total-count").value'),"90");
  checks.push("successful checkpoint clear empties only buildings; cumulative90 draft survives clear and reload");
  await seed(fixture());
}
