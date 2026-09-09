import assert from "node:assert/strict";

export async function runNavigationChecks({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks}) {
  await seed(fixture());
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
  // Simulate a taller Android safe-area/footer without touching real phone settings.
  await ev('document.querySelector(".tabbar").style.paddingBottom="110px"');
  await pause(150);
  await send("Input.dispatchMouseEvent",{type:"mouseWheel",x:200,y:350,deltaY:5000,deltaX:0});await pause(300);
  const bottom=await ev('(()=>{const e=[...document.querySelectorAll(".work-details>summary")].at(-1),r=e.getBoundingClientRect(),nav=document.querySelector(".tabbar").getBoundingClientRect();return{bottom:r.bottom,navTop:nav.top,scrollY,max:document.scrollingElement.scrollHeight-innerHeight,footer:nav.height,padding:getComputedStyle(document.querySelector(".shell")).paddingBottom}})()');
  await shot("14-bottom-safe-area");
  assert(bottom.bottom<=bottom.navTop-8,"last work menu hidden at scroll end: "+JSON.stringify(bottom));
  checks.push("bottom reachability with tall native footer and real wheel scrolling");
  const wheelBottom=async()=>{
    await send("Input.dispatchMouseEvent",{type:"mouseWheel",x:Math.min(200,await ev('innerWidth/2')),y:Math.max(30,await ev('document.querySelector(".tabbar").getBoundingClientRect().top/2')),deltaY:8000,deltaX:0});await pause(180);
  };
  const tap=async selector=>{
    const pt=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e===document.elementFromPoint(x,y)||e.contains(document.elementFromPoint(x,y))}})()`);
    assert(pt.hit,"control occluded: "+selector);
    await send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:pt.x,y:pt.y});
    await send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:pt.x,y:pt.y});await pause();
  };
  const baseline=await read();
  let scenarios=0;
  for(const [width,height] of [[411,762],[360,640],[762,411],[411,430]]){
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:2.63,mobile:true});
    for(const name of ["work","log","report","stats","backup"]){
      await tab(name);
      for(const footer of [6,48,110]){
        await ev(`document.querySelector('.tabbar').style.paddingBottom='${footer}px'`);await pause(100);await wheelBottom();
        const bounds=await ev(`(()=>{const nav=document.querySelector('.tabbar').getBoundingClientRect();const items=[...document.querySelectorAll('.shell button,.shell input,.shell select,.shell summary,.shell p,.shell pre,.shell strong,.shell time')].filter(e=>!e.closest('.tabbar')&&e.checkVisibility()).map(e=>({r:e.getBoundingClientRect(),tag:e.tagName})).filter(e=>e.r.height>0&&e.r.width>0);return {end:Math.max(0,...items.map(e=>e.r.bottom)),top:nav.top,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
        assert(!bounds.overflow,`horizontal ${name}/${width}/${footer}`);
        assert(bounds.end<=bounds.top-8,`last content ${name}/${width}/${footer}: `+JSON.stringify(bounds));
        scenarios++;
      }
    }
  }
  checks.push(`${scenarios} real-scroll end checks: all5 tabs x4 viewports x3 native footer insets; final content above navigation`);
  assert.deepEqual(await read(),baseline,"reading tabs changed day");
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
  await tab("work");
  await ev('[...document.querySelectorAll(".work-details")].forEach((e,i)=>e.id="reach-"+i)');
  const count=await ev('document.querySelectorAll(".work-details").length');
  await wheelBottom();await tap(`#reach-${count-1}>summary`);
  assert(await ev(`document.querySelector('#reach-${count-1}').open`));
  await wheelBottom();await shot("15-last-zone-open");
  for(let i=0;i<4;i++){assert(await ev('window.__deliverySafety.back()'));await pause();if(!await ev('!!document.querySelector(".work-details[open]")'))break;}
  assert.equal(await ev('!!document.querySelector(".work-details[open]")'),false);
  await input("#hils-count","100");
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:420,deviceScaleFactor:2.63,mobile:true});await pause(200);
  const focus=await ev('(()=>{const r=document.activeElement.getBoundingClientRect(),n=document.querySelector(".tabbar").getBoundingClientRect();return {bottom:r.bottom,top:r.top,nav:n.top}})()');
  assert(focus.top>=0&&focus.bottom<=focus.nav,"focused count hidden with keyboard-sized viewport");
  assert(await ev('window.__deliverySafety.back()'));assert.equal(await ev('document.activeElement.tagName'),"BODY");
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
  await click('[data-action="open-route-editor"][data-zone="hils"]');
  await click('[name="route-mode"][value="alt"]');
  await input("#route-name","뒤로 취소 이름");await ev('window.__deliverySafety.back()');await ev('window.__deliverySafety.back()');await pause();
  assert.equal(await ev('!!document.querySelector("dialog[open]")'),false);assert.deepEqual(await read(),baseline);
  assert.equal(await ev('document.querySelector("#hils-count").value'),"100");
  await tab("log");await click('[data-action="open-log-edit"]');
  await ev('document.activeElement.blur();window.__deliverySafety.back()');await pause();
  assert.equal(await ev('!!document.querySelector(".timeline-inline-editor")'),false);
  await ev('window.__deliverySafety.back()');await pause();assert(await ev('!!document.querySelector("#hils-count")'));
  assert.equal(await ev('window.__deliverySafety.back()'),false,"root back may exit only after editor closed");
  checks.push("physical tap opens last zone details; back collapses; keyboard-sized count visible; Back blurs then closes modal, keeps count draft, closes log editor, returns Work then permits exit");
  await click('[data-action="open-route-editor"][data-zone="hils"]');
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await pause();
  assert.equal(await ev('!!document.querySelector("dialog[open]")'),false);
  await click('[data-action="open-route-editor"][data-zone="hils"]');await click('[name="route-mode"][value="alt"]');await input("#route-name","지연 저장");
  await ev('window.__realNavigationSave=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__deliverySafety.runtime.store.saveDay=async d=>{await new Promise(r=>window.__releaseNavigationSave=r);return window.__realNavigationSave(d)}');
  await ev('document.querySelector("[data-action=save-route-editor]").click()');await pause(120);
  assert(await ev('window.__deliverySafety.back()'));assert(await ev('!!document.querySelector("dialog[open]")'));
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  assert(await ev('!!document.querySelector("dialog[open]")'),"busy Escape closed dialog");
  await ev('window.__releaseNavigationSave()');await until('!document.querySelector("dialog[open]")');await ev('window.__deliverySafety.runtime.store.saveDay=window.__realNavigationSave');
  assert.equal((await read()).zones[0].name,"지연 저장");assert.equal((await read()).timeline.length,baseline.timeline.length);
  await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector(".tabbar")');assert.equal((await read()).zones[0].name,"지연 저장");
  checks.push("real Escape cancels dialog without write; Back/Escape during delayed save blocked; one saved name survives reload with unchanged timeline");
  await tab("report");await ev('window.__deliverySafety.runtime.platform.copyText=async text=>window.__copiedReport=text');
  const copySelector=await ev('JSON.stringify([...document.querySelectorAll("button")].filter(b=>b.textContent.includes("복사")).map(b=>b.dataset.action))');
  const action=JSON.parse(copySelector)[0];assert(action);await click(`[data-action="${action}"]`);assert.match(await ev('window.__copiedReport'),/배송/);
  await tab("backup");const beforeImport=await read();
  await ev('window.__deliverySafety.runtime.platform.pickTextFile=async()=>null');
  const importAction=await ev('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("가져오기"))?.dataset.action');assert(importAction);await click(`[data-action="${importAction}"]`);assert.deepEqual(await read(),beforeImport);
  checks.push("report copy button invokes output; import picker cancellation leaves stored day unchanged");
  const long=fixture();for(let i=0;i<25;i++)long.zones.push({id:"planned-"+i,name:"대체 배송 "+i+" 긴 이름 확인",kind:"alt",order:i+2});
  await seed(long);await click('[data-action="open-route-plans"]');
  await send("Emulation.setDeviceMetricsOverride",{width:360,height:430,deviceScaleFactor:2.63,mobile:true});await pause();
  const list=await ev('(()=>{const r=document.querySelector(".route-plan-list").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+Math.min(40,r.height/2)}})()');
  await send("Input.dispatchMouseEvent",{type:"mouseWheel",...list,deltaY:8000,deltaX:0});await pause(250);
  await tap('.route-plan-list [data-action="open-route-editor"][data-zone="planned-24"]');assert.equal(await ev('document.querySelector("#route-name").value'),long.zones.at(-1).name);
  const dialog=await ev('(()=>{const r=document.querySelector("dialog").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+40}})()');
  await send("Input.dispatchMouseEvent",{type:"mouseWheel",...dialog,deltaY:8000,deltaX:0});await pause(250);await tap('[data-action="remove-planned-zone"]');
  assert.equal((await read()).zones.length,25);assert(!(await read()).zones.some(z=>z.id==="planned-24"));
  checks.push("25 planned visits: inner list real-scroll reaches last edit; small-height modal reaches remove; only chosen unstarted visit removed");
  await seed(fixture());await send("Emulation.setDeviceMetricsOverride",{width:360,height:640,deviceScaleFactor:2.63,mobile:true});
  await ev('[...document.querySelectorAll("body *")].filter(e=>e instanceof HTMLElement).map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]).forEach(([e,size])=>e.style.fontSize=(size*1.5)+"px");document.querySelector(".tabbar").style.paddingBottom="110px"');await pause(150);await wheelBottom();
  const large=await ev('(()=>{const e=[...document.querySelectorAll(".work-details>summary")].at(-1),r=e.getBoundingClientRect(),n=document.querySelector(".tabbar").getBoundingClientRect();return{bottom:r.bottom,nav:n.top,overflow:document.documentElement.scrollWidth>innerWidth}})()');assert(large.bottom<=large.nav-8&&!large.overflow);await shot("16-large-text-bottom");
  checks.push("150percent text plus large bottom inset: last menu fully reachable at360");
  await seed(fixture());await input("#hils-count","100");const beforeInterrupt=await read();
  await ev('window.__deliverySafety.runtime.store.saveDay=async()=>new Promise(()=>{});document.querySelector("[data-action=zone-end]").click()');await pause(200);assert(await ev('window.__deliverySafety.back()'));
  await send("Page.reload",{ignoreCache:true});await until('!!document.querySelector("#hils-count")');assert.deepEqual(await read(),beforeInterrupt);assert.equal(await ev('document.querySelector("#hils-count").value'),"100");
  checks.push("reload during uncommitted completion: original day unchanged, quantity100 draft restored, workflow still editable");
  await seed(fixture());
}
