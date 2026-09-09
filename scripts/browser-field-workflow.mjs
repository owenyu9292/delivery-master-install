import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { runSafetyChecks } from "./browser-safety-cases.mjs";
import { runTimeChecks } from "./browser-time-cases.mjs";
import { runCorrectionParity } from "./browser-correction-parity.mjs";
import { runStatisticsChecks } from "./browser-statistics-cases.mjs";
import { runNavigationChecks } from "./browser-navigation-cases.mjs";
import { runReportChecks } from "./browser-report-cases.mjs";
import { runKeyboardChecks } from "./browser-keyboard-cases.mjs";
import { runBasicAudit } from "./browser-basic-audit.mjs";
import { runInputSurfaces } from "./browser-input-surfaces.mjs";

const output = await mkdtemp(join(tmpdir(), "delivery-field-v37-"));
await cp("public", join(output, "web"), { recursive: true });
await mkdir(join(output, "web/assets"), { recursive: true });
await build({ entryPoints: ["src/app/main.ts"], bundle: true, format: "esm", target: "es2022", outfile: join(output, "web/assets/app.js"),
  plugins: [{ name: "isolated-safety-injection", setup(plugin) {
    plugin.onLoad({ filter: /src[\\/]app[\\/]main\.ts$/ }, async args => ({ loader: "ts", contents: (await readFile(args.path, "utf8"))
      .replace("const { store, platform } = runtime;", "const { store, platform } = runtime; (window as any).__deliverySafety = { runtime, back: handleAppBack };")
      .replace("nativeInsets: Capacitor.isNativePlatform()", process.env.NATIVE_LAYOUT === "1" ? "nativeInsets: true" : "nativeInsets: Capacitor.isNativePlatform()") }));
  } }] });
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const body = await readFile(join(output, "web", path === "/" ? "index.html" : path));
    res.writeHead(200, { "Content-Type": mime[extname(path === "/" ? "index.html" : path)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
for (let attempt=0; ; attempt++) {
  try {
    await new Promise((resolve,reject)=>{
      const failed=error=>reject(error);
      server.once("error",failed);
      server.listen(40000+Math.floor(Math.random()*10000),"127.0.0.1",()=>{server.off("error",failed);resolve();});
    });
    break;
  } catch (error) { if(error.code!=="EADDRINUSE"||attempt>=19)throw error; }
}
const base = "http://127.0.0.1:" + server.address().port;
const profile = join(output, "chrome");
const chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=0", "--user-data-dir=" + profile,
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const pause = (ms = 160) => new Promise(r => setTimeout(r, ms));
let ws, cdpPort;
const checks = [];
try {
  for (let n = 0; n < 100; n++) {
    try { cdpPort = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await pause(100); }
  }
  assert(cdpPort, "dedicated background Chrome did not start");
  const target = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/new?" + encodeURIComponent(base), { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const q = pending.get(message.id); pending.delete(message.id);
      message.error ? q.reject(message.error) : q.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async expression => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async expression => {
    for (let n = 0; n < 80; n++) { if (await ev(expression)) return; await pause(80); }
    throw Error("Timed out: " + expression + " / " + await ev("document.body.innerText") + " / errors:" + JSON.stringify(errors));
  };
  const click = async selector => {
    await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return;for(let p=e.parentElement;p;p=p.parentElement){if(p.tagName==="DETAILS"&&!p.open)p.querySelector("summary")?.click();}})()`);
    const pt = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...pt });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...pt });
    await pause();
  };
  const input = async (selector, text) => {
    await click(selector);
    await ev(`document.querySelector(${JSON.stringify(selector)}).select()`);
    await send("Input.insertText", { text }); await pause(40);
    assert.equal(await ev(`document.querySelector(${JSON.stringify(selector)}).value`), text);
  };
  const tab = async name => click('[data-action="set-tab"][data-tab="' + name + '"]');
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 411, height: 762, deviceScaleFactor: 2.63, mobile: true });
  await send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
  await send("Page.navigate", { url: base });
  await until('!!document.querySelector(".tabbar")');
  const date = await ev("new Date().toLocaleDateString('en-CA')");
  const fixture = (closed = false, id = "hils") => {
    const at = t => date + "T" + t + ":00+09:00";
    const e = (eventId, type, t, zoneId, payload) => ({ id: eventId, type, at: at(t), zoneId, payload, source: "manual", createdAt: at(t), updatedAt: at(t) });
    const timeline = [
      e("depart", "depart_jinjeop", "08:00", undefined, { total: 100 }),
      e("arrive", "arrive_cheongnyangni", "09:00"),
      e("start", "zone_start", "09:00", id), e("sort", "sorting_start", "09:00", id),
      e("sorted", "sorting_end", "09:20", id), e("delivery", "delivery_start", "09:20", id),
    ];
    if (closed) timeline.push(e("end", "zone_end", "11:00", id, { total: 100, delivered: 100, failed: 0, extra: 0 }), e("close", "day_close", "11:00"));
    return { schemaVersion: 1, id: "day-" + date, date, status: closed ? "closed" : "active", timeline,
      zones: [{ id, name: "힐스테이트", order: 1, startEventId: "start", sortingStartEventId: "sort", sortingEndEventId: "sorted", deliveryStartEventId: "delivery", ...(closed ? { endEventId: "end" } : {}) }],
      helpers: [], adjustments: [], meta: { createdAt: at("08:00"), updatedAt: at("11:00"), recoveryStatus: "none" } };
  };
  const seed = async record => {
    // This origin and browser profile are created only for this test.
    await ev("localStorage.clear()");
    await ev(`new Promise((resolve,reject)=>{const o=indexedDB.open('delivery-master-install');o.onerror=reject;o.onsuccess=()=>{const db=o.result;const tx=db.transaction('dayRecords','readwrite');tx.objectStore('dayRecords').clear();tx.objectStore('dayRecords').put(${JSON.stringify(record)});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=reject}})`);
    await send("Page.reload", { ignoreCache: true }); await pause(300); await until('!!document.querySelector(".tabbar")');
  };
  const read = async () => ev(`new Promise(r=>{const o=indexedDB.open('delivery-master-install');o.onsuccess=()=>{const db=o.result;const q=db.transaction('dayRecords').objectStore('dayRecords').get(${JSON.stringify(date)});q.onsuccess=()=>{db.close();r(q.result)}}})`);
  const handling = record => record.timeline.filter(e => e.payload?.kind === "handling_time");
  const minute = async () => handling(await read())[0]?.payload.minutes;
  const save = async () => { await click('[data-action="save-handling"]'); await until('!!document.querySelector("[data-action=save-handling]:not(:disabled)")'); };
  const shot = async name => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(output, name + ".png"), Buffer.from(r.data, "base64"));
  };


  const newDay = () => {
    const day = fixture();
    day.timeline = day.timeline.filter(e => e.type === "depart_jinjeop" || e.type === "arrive_cheongnyangni");
    day.timeline[0].payload.total = 250;
    day.zones = [{ id:"miju", name:"미주", order:1 },{ id:"hils", name:"힐스테이트", order:2 }];
    return day;
  };
  const act = name => click(name === "open-route-editor" ? '.add-zone[data-action="open-route-editor"]' : '[data-action="'+name+'"]');
  const ready = () => until('!!document.querySelector(".tabbar") && ![...document.querySelectorAll("button")].every(b=>b.disabled)');
  const select = async (selector,value) => {
    await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
    await pause();
  };
  const choose = async (kind, name) => {
    await click('[name="route-mode"][value="'+(kind==="alt"?"alt":"own")+'"]');
    if(kind!=="alt") await select("#route-place",kind);
    if(name!==undefined) await input("#route-name",name);
    await act("save-route-editor");await ready();
  };
  const clock = async (hour,minute) => ev(`(()=>{const Native=window.__NativeDate||Date;window.__NativeDate=Native;window.__now=new Native(${JSON.stringify(date)}+"T"+${JSON.stringify(String(hour).padStart(2,"0"))}+":"+${JSON.stringify(String(minute).padStart(2,"0"))}+":00+09:00").getTime();window.Date=class extends Native { constructor(...a){super(...(a.length?a:[window.__now]));}static now(){return window.__now;}};})()`);
  const endCount = async (id,raw) => {
    if (!await ev("!!window.__now")) await clock(11,0);
    await ev("window.__now += 30*60000");
    const selector = await ev('document.querySelector(".quantity-input input").id');
    await input("#"+selector,String(raw));await click('[data-action="zone-end"][data-zone="'+id+'"]');await ready();
  };
  const dataCounts = record => record.timeline.filter(e=>e.type==="zone_end").map(e=>e.payload.delivered);
  const noOverflow = async width => {
    await send("Emulation.setDeviceMetricsOverride",{width,height:762,deviceScaleFactor:2.63,mobile:true});
    assert.equal(await ev("document.documentElement.scrollWidth>innerWidth"),false,"horizontal overflow "+width);
  };
  if (!process.env.TIME_ONLY && !process.env.STATS_ONLY && !process.env.UI_ONLY) {
  await seed(fixture());
  assert.equal(await ev('getComputedStyle(document.documentElement).fontFamily'),"sans-serif");
  assert.equal(await ev('document.querySelectorAll(".tabbar svg").length'),5);
  assert.equal(await ev('getComputedStyle(document.querySelector(".tabbar")).position'),"fixed");
  await shot("01-hils-delivery-411");
  await input("#hils-count","100");
  await click('[data-action="open-route-editor"][data-zone="hils"]');
  await choose("alt","대체 <현장>");
  assert.equal((await read()).zones[0].id,"hils");assert.equal((await read()).zones[0].kind,"alt");
  assert.equal(await ev('document.querySelector("#extra-count").value'),"100");
  assert.equal(await ev('document.querySelector(".route-heading h2").textContent'),"대체 <현장>");
  await click('[data-action="open-route-editor"][data-zone="hils"]');await choose("miju");
  assert.equal(await ev('document.querySelector("#miju-total-count").value'),"100");
  await input("#miju-1-count","5");await input("#miju-2-count","6");await input("#miju-3-count","9");
  await act("save-miju-detail");
  assert.equal((await read()).timeline.filter(e=>e.payload?.reason==="miju_a_checkpoint")[0].zoneId,"hils");
  await shot("02-miju-input-411");
  await click('[data-action="open-route-editor"][data-zone="hils"]');await choose("alt","대체배송");
  await click('[data-action="open-route-editor"][data-zone="hils"]');await choose("miju");
  assert.equal(await ev('document.querySelector("#miju-1-count").value'),"5");
  assert.equal(await ev('document.querySelector("#miju-total-count").value'),"100");
  assert.equal(await ev('document.querySelector("[data-preview=last]").textContent'),"80개");
  await noOverflow(360);await shot("03-miju-360");
  await noOverflow(411);
  const originalTimeline=(await read()).timeline;
  await act("open-route-editor");await choose("alt","대체배송");
  assert.deepEqual((await read()).timeline,originalTimeline,"planning must not create start events");
  await act("open-route-editor");await choose("miju");
  await act("open-route-plans");await shot("04-next-sheet");
  await act("close-route-sheet");
  assert.equal(await ev('document.querySelector("#miju-total-count").value'),"100");
  await click('[data-action="open-route-editor"][data-zone="hils"]');await choose("hils");
  assert.equal(await ev('document.querySelector("#hils-count").value'),"100");
  await send("Page.reload",{ignoreCache:true});await pause(400);await ready();
  assert.equal(await ev('document.querySelector("#hils-count").value'),"100");
  assert.equal((await read()).zones[0].kind,"hils");
  checks.push("active hils->alt->miju->alt->miju->hils preserves IDs,times,A20,count100, reload");
  const beforeBad=await read();
  await input("#hils-count","");await act("zone-end");assert.deepEqual(await read(),beforeBad);
  await input("#hils-count","0");await act("zone-end");assert.deepEqual(await read(),beforeBad);
  for(const bad of ["-1","1.5","12x","NaN","1e3"]){
    await input("#hils-count",bad);await act("zone-end");assert.deepEqual(await read(),beforeBad);
    assert.equal(await ev('document.querySelector("#hils-count").value'),bad);
  }
  await input("#hils-count","99999");await act("zone-end");assert.equal(dataCounts(await read()).length,0);
  assert(await ev('!!document.querySelector(".quantity-risk-panel")'));
  await act("quantity-risk-reset");
  await endCount("hils",100);
  assert.deepEqual(dataCounts(await read()),[100]);
  const next=(await read()).zones.find(z=>!z.startEventId);
  assert(next);assert.equal((await read()).timeline.filter(e=>e.type==="zone_start").length,1);
  checks.push("empty/zero/99999 blocked; recover count100; next zone never auto-starts");

  await seed(newDay());await clock(10,0);
  for(let i=0;i<7;i++){await act("open-route-editor");await choose("alt","대체배송 "+(i+1));}
  assert.equal((await read()).zones.length,9);
  await act("open-route-plans");
  assert(await ev('document.querySelector(".route-plan-list").scrollHeight>document.querySelector(".route-plan-list").clientHeight'));
  await shot("05-many-plans");
  const altIds=(await read()).zones.filter(z=>z.kind==="alt").map(z=>z.id);
  await click('[data-action="select-next-zone"][data-zone="'+altIds[0]+'"]');
  assert.equal((await read()).zones.find(z=>z.id===altIds[0]).order,1);
  await click('[data-action="zone-start"][data-start-mode="delivery"]');
  assert.equal((await read()).timeline.filter(e=>e.type==="delivery_start").length,1);
  await endCount(altIds[0],13);
  await ev("window.__now += 5*60000");
  await act("open-route-plans");await click('[data-action="select-next-zone"][data-zone="miju"]');
  await click('[data-action="zone-start"][data-start-mode="delivery"]');
  await input("#miju-1-count","5");await input("#miju-2-count","6");await input("#miju-3-count","8");await act("save-miju-detail");
  await input("#miju-total-count","12");await act("zone-end");assert.deepEqual(dataCounts(await read()),[13]);
  await input("#miju-total-count","31");await act("zone-end");assert.deepEqual(dataCounts(await read()),[13],"A19 larger than current18");
  await endCount("miju",32);assert.deepEqual(dataCounts(await read()),[13,19]);
  const mijuEnd=(await read()).timeline.find(e=>e.type==="zone_end"&&e.zoneId==="miju");
  assert.equal(mijuEnd.payload.restTotal,0);
  await act("open-route-plans");await click('[data-action="select-next-zone"][data-zone="'+altIds[1]+'"]');
  await ev("window.__now += 5*60000");await click('[data-action="zone-start"][data-start-mode="delivery"]');await endCount(altIds[1],53);
  assert.deepEqual(dataCounts(await read()),[13,19,21]);
  await act("open-route-plans");await click('[data-action="select-next-zone"][data-zone="hils"]');
  await ev("window.__now += 5*60000");await click('[data-action="zone-start"][data-start-mode="sorting"]');
  assert(await ev('!!document.querySelector("[data-action=sorting-end]")'));
  assert(await ev('[...document.querySelectorAll("details")].some(d=>d.querySelector("summary")?.textContent==="정리 시간 보정"&&!d.open)'),"active sorting correction stays collapsed");
  await shot("06-sorting-primary");
  await act("sorting-end");await endCount("hils",70);
  await act("open-route-editor");await choose("miju");
  const repeat=(await read()).zones.filter(z=>z.kind==="miju").at(-1);
  await act("open-route-plans");await click('[data-action="select-next-zone"][data-zone="'+repeat.id+'"]');
  await ev("window.__now += 5*60000");await click('[data-action="zone-start"][data-start-mode="delivery"]');
  assert.equal(await ev('document.querySelector("#miju-1-count").value'),"","new visit does not reuse Miju A");
  await input("#miju-1-count","1");await input("#miju-2-count","2");await input("#miju-3-count","3");await act("save-miju-detail");await endCount(repeat.id,90);
  assert.deepEqual(dataCounts(await read()),[13,19,21,17,20]);
  await act("open-close-day");await act("close-route-sheet");assert.equal((await read()).status,"active");
  await act("open-close-day");await act("confirm-close-day");await ready();assert.equal((await read()).status,"closed");
  assert.equal(dataCounts(await read()).reduce((a,b)=>a+b,0),90);
  await tab("log");await shot("07-log");
  await tab("report");assert.equal(await ev('document.querySelector("[data-report=total]").textContent'),"90개");
  await tab("stats");await noOverflow(360);await shot("08-stats-360");await noOverflow(411);
  await tab("backup");await shot("09-backup");
  checks.push("7 repeated alternates; reorder; alt13->miju19->alt21->hils17->miju20 = cumulative90; independent A; close cancel+confirm with unused plans");
  await tab("work");await shot("10-closed");
await seed(newDay());await clock(10,0);
  const pristine=await read();
  await act("open-route-editor");
  await input("#route-name","취소 테스트");
  await act("close-route-sheet");
  assert.deepEqual(await read(),pristine);
  await act("open-route-editor");
  await input("#route-name","저장 재시도");
  await ev('window.__realSave=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__deliverySafety.runtime.store.saveDay=async()=>{throw Error("TEST_ROUTE_SAVE_FAILED")}');
  await click('[data-action="save-route-editor"]');
  assert.deepEqual(await read(),pristine);
  assert.equal(await ev('document.querySelector("#route-name").value'),"저장 재시도");
  await ev('window.__deliverySafety.runtime.store.saveDay=window.__realSave');
  await ev('const b=document.querySelector("[data-action=save-route-editor]");b.click();b.click()');await pause(350);
  assert.equal((await read()).zones.length,3);
  assert.equal((await read()).timeline.filter(e=>e.type==="zone_start").length,0);
  const added=(await read()).zones.find(z=>z.name==="저장 재시도");
  await act("open-route-plans");await click('[data-action="open-route-editor"][data-zone="'+added.id+'"]');
  await choose("miju");
  assert.equal((await read()).zones.find(z=>z.id===added.id).kind,"miju");
  await act("open-route-plans");await click('[data-action="open-route-editor"][data-zone="'+added.id+'"]');
  await choose("hils");
  assert.equal((await read()).zones.find(z=>z.id===added.id).kind,"hils");
  await act("open-route-plans");await click('[data-action="open-route-editor"][data-zone="'+added.id+'"]');
  await act("remove-planned-zone");assert.equal((await read()).zones.length,2);
  for(const id of ["miju","hils"]){await click('.route-sheet [data-action="open-route-editor"][data-zone="'+id+'"]');await act("remove-planned-zone");}
  await act("close-route-sheet");assert.equal((await read()).zones.length,0);
  await act("open-close-day");await act("confirm-close-day");assert.equal((await read()).status,"closed");
  checks.push("cancel preserves whole day; write failure retains editor and name; retry double-tap adds once; planned alt->miju->hils->remove; remove all still permits close");

  await seed(fixture());await clock(10,0);await input("#hils-count","100");
  const beforeFailure=await read();
  await ev('window.__realSave=window.__deliverySafety.runtime.store.saveDay.bind(window.__deliverySafety.runtime.store);window.__deliverySafety.runtime.store.saveDay=async()=>{throw Error("TEST_COMPLETE_FAILED")}');
  await act("zone-end");assert.deepEqual(await read(),beforeFailure);
  assert.equal(await ev('document.querySelector("#hils-count").value'),"100");
  await ev('window.__deliverySafety.runtime.store.saveDay=window.__realSave');
  await ev('const b=document.querySelector("[data-action=zone-end]");b.click();b.click()');await pause(350);
  assert.equal((await read()).timeline.filter(e=>e.type==="zone_end").length,1);
  checks.push("completion storage failure preserves day+100; retry double-tap makes one completion");

  await seed(fixture());await input("#hils-count","100");
  await ev('[...document.querySelectorAll("body *")].filter(e=>e instanceof HTMLElement).map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]).forEach(([e,size])=>e.style.fontSize=(size*1.5)+"px")');
  await noOverflow(360);await shot("11-large-text-360");
  const overlap=await ev('(()=>{const nav=document.querySelector(".tabbar");return [...nav.querySelectorAll("button")].some(b=>b.scrollWidth>b.clientWidth+1)})()');
  assert.equal(overlap,false,"large text nav clipped");
  checks.push("150percent text at360 has no horizontal overflow or clipped navigation");
  }
  if (!process.env.STATS_ONLY && !process.env.UI_ONLY) {
    await runTimeChecks({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks,date,clock});
    await runCorrectionParity({ev,seed,fixture,read,click,input,tab,until,pause,checks,date});
  }
  if (!process.env.UI_ONLY) await runStatisticsChecks({ev,send,seed,fixture,read,click,tab,until,pause,shot,checks,date});
  if (!process.env.KEYBOARD_ONLY && !process.env.BASIC_ONLY) {
    await runNavigationChecks({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks});
    await runReportChecks({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks});
  }
  if (process.env.NATIVE_LAYOUT === "1") await runKeyboardChecks({ev,send,seed,fixture,read,click,input,tab,pause,shot,checks});
  if (!process.env.KEYBOARD_ONLY) await runBasicAudit({ev,send,seed,fixture,read,click,input,tab,until,pause,shot,checks});
  if (!process.env.KEYBOARD_ONLY) await runInputSurfaces({ev,send,seed,fixture,read,click,tab,pause,shot,checks});
  assert.deepEqual(errors,[]);
  await writeFile(join(output,"result.json"),JSON.stringify({passed:true,checks,errors},null,2));
  console.log(JSON.stringify({passed:true,checks,artifacts:output},null,2));
} finally {
  if (ws) ws.close();
  if (cdpPort) {
    try {
      const version = await (await fetch("http://127.0.0.1:" + cdpPort + "/json/version")).json();
      const closer = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise(resolve => {
        closer.onopen = () => closer.send(JSON.stringify({ id: 1, method: "Browser.close" }));
        closer.onclose = resolve; closer.onerror = resolve;
        setTimeout(() => { closer.close(); resolve(); }, 2000).unref();
      });
    } catch { /* Dedicated process only; never touch the user's browser. */ }
  }
  if (chrome.exitCode === null) chrome.kill();
  await new Promise(resolve => server.close(resolve));
}
