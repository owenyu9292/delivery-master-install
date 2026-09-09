import assert from "node:assert/strict";

export async function runReportChecks({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks}) {
  const day=fixture(true,"miju");day.zones[0].kind="miju";day.zones[0].name="미주";
  day.timeline.find(e=>e.type==="zone_end").payload={total:100,delivered:100,failed:0,extra:0,aTotal:40,restTotal:60};
  day.zones.push({id:"unstarted",name:"미방문 대체배송",order:2,kind:"alt"});
  await seed(day);const original=await read();await tab("report");
  assert.equal(await ev('document.querySelector("[data-report=total]").textContent'),"100개");
  assert.equal(await ev('document.querySelectorAll(".report-zone").length'),1);
  assert.match(await ev('document.querySelector(".report-document").innerText'),/A · 1, 2, 3동\s+40개/);
  assert.match(await ev('document.querySelector(".report-document").innerText'),/B · 나머지 동\s+60개/);
  await ev('window.__deliverySafety.runtime.platform.copyText=async text=>window.__reportCopy=text');
  await click('.report-heading [data-action="copy-report"]');
  assert.match(await ev('window.__reportCopy'),/총 배송 수량: 100개/);
  assert.match(await ev('window.__reportCopy'),/A구간\(1,2,3동\): 40개/);
  assert.deepEqual(await read(),original);
  for(const width of [411,360]){
    await send("Emulation.setDeviceMetricsOverride",{width,height:762,deviceScaleFactor:2.63,mobile:true});
    await ev('scrollTo(0,0)');await until('!document.querySelector(".toast")');await pause();await shot(`17-report-${width}`);
    const bounds=await ev('(()=>{const r=document.querySelector(".report-document");return{max:getComputedStyle(r).maxHeight,overflow:getComputedStyle(r).overflowY,scroll:r.scrollHeight,client:r.clientHeight,horizontal:document.documentElement.scrollWidth>innerWidth}})()');
    assert.equal(bounds.max,"none");assert.equal(bounds.overflow,"visible");assert(bounds.scroll<=bounds.client+1);assert(!bounds.horizontal);
    await send("Input.dispatchMouseEvent",{type:"mouseWheel",x:180,y:350,deltaY:10000,deltaX:0});await pause();
    const pt=await ev('(()=>{const b=document.querySelector(".report-footer button"),r=b.getBoundingClientRect(),n=document.querySelector(".tabbar").getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,bottom:r.bottom,nav:n.top,hit:b.contains(document.elementFromPoint(x,y))}})()');
    assert(pt.bottom<pt.nav&&pt.hit);
    await send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:pt.x,y:pt.y});
    await send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:pt.x,y:pt.y});
    await pause();assert.match(await ev('window.__reportCopy'),/총 배송 수량: 100개/);await until('!document.querySelector(".toast")');await shot(`18-report-bottom-${width}`);
  }
  checks.push("structured report: same100/A40/B60 and copy text, unstarted hidden, no internal scroll, 411/360 real bottom-scroll and copy tap, original unchanged");
  await tab("log");await click('[data-action="open-log-edit"][data-event="end"]');await input("#log-edit-end-delivered","120");
  await click('[data-action="save-log-edit"][data-event="end"]');await tab("report");
  assert.equal(await ev('document.querySelector("[data-report=total]").textContent'),"120개");
  assert.match(await ev('document.querySelector(".report-document").innerText'),/B · 나머지 동\s+80개/);
  await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector(".tabbar")');await tab("report");
  assert.equal(await ev('document.querySelector("[data-report=total]").textContent'),"120개");
  await tab("stats");await click('[data-action="set-stats-tab"][data-stats-tab="date"]');
  assert.equal(await ev('document.querySelector(".date-result [data-report=total]").textContent'),"120개");
  checks.push("log correction100->120 recalculates B60->80 immediately, survives reload, date statistics uses same report120");
  const long=fixture(true);long.zones[0].name='<img src=x onerror="alert(1)">'+"긴이름".repeat(40);
  for(let i=0;i<18;i++){
    const id="report-zone-"+i;long.zones.push({id,name:"대체배송 "+i,order:i+2,kind:"alt"});
    for(const event of long.timeline.filter(e=>e.zoneId==="hils").slice())long.timeline.push({...structuredClone(event),id:event.id+"-"+i,zoneId:id});
  }
  await seed(long);await tab("report");const before=await read();
  await send("Emulation.setDeviceMetricsOverride",{width:360,height:640,deviceScaleFactor:2.63,mobile:true});
  await ev('[...document.querySelectorAll("body *")].filter(e=>e instanceof HTMLElement).map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]).forEach(([e,s])=>e.style.fontSize=s*1.5+"px")');await pause();
  assert.equal(await ev('document.querySelectorAll(".report-zone").length'),19);
  assert.equal(await ev('!!document.querySelector(".report-document img")'),false);
  assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false);
  await send("Input.dispatchMouseEvent",{type:"mouseWheel",x:180,y:250,deltaY:100000,deltaX:0});await pause(250);
  assert(await ev('document.querySelector(".report-footer").getBoundingClientRect().bottom<document.querySelector(".tabbar").getBoundingClientRect().top'));
  assert.deepEqual(await read(),before);await shot("19-report-large-text-many-zones");
  checks.push("19 zones, escaped hostile long name, 150percent text at360, entire report bottom accessible without nested scroll; records unchanged");
  const empty=fixture();empty.timeline=[];empty.zones=[];empty.status="draft";
  await seed(empty);await tab("report");assert.equal(await ev('document.querySelector("[data-report=total]").textContent'),"0개");assert.equal(await ev('document.querySelector("[data-report=efficiency]").textContent'),"미확정");
  assert(await ev('!!document.querySelector(".report-empty")'));assert.deepEqual(await read(),empty);
  checks.push("empty pre-work report is zero/unknown with no fake scan difference or writes");
  await seed(fixture());
}
