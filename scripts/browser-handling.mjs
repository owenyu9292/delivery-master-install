import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { runSafetyChecks } from "./browser-safety-cases.mjs";

const output = await mkdtemp(join(tmpdir(), "delivery-handling-"));
await cp("public", join(output, "web"), { recursive: true });
await mkdir(join(output, "web/assets"), { recursive: true });
await build({ entryPoints: ["src/app/main.ts"], bundle: true, format: "esm", target: "es2022", outfile: join(output, "web/assets/app.js"),
  plugins: [{ name: "isolated-safety-injection", setup(plugin) {
    plugin.onLoad({ filter: /src[\\/]app[\\/]main\.ts$/ }, async args => ({ loader: "ts", contents: (await readFile(args.path, "utf8")).replace("const { store, platform } = runtime;", "const { store, platform } = runtime; (window as any).__deliverySafety = { runtime };") }));
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
await new Promise(r => server.listen(0, "127.0.0.1", r));
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

  await seed(fixture());
  assert.equal(await ev('document.querySelector("#handling-minutes").value'), "30");
  assert.equal(handling(await read()).length, 0);
  await input("#hils-count", "100");
  await save();
  assert.equal(await minute(), 30);
  assert.equal(await ev('document.querySelector("#hils-count").value'), "100");
  await ev('document.querySelector("[data-action=save-handling]").click();document.querySelector("[data-action=save-handling]").click()');
  await pause(300);
  assert.equal(handling(await read()).length, 1);
  await input("#handling-minutes", "45"); await save(); assert.equal(await minute(), 45);
  await click('[data-action="cancel-handling"]'); assert.equal(await minute(), 0);
  await input("#handling-minutes", "30"); await save(); assert.equal(await minute(), 30);
  await shot("handling-work-411");
  checks.push("default30-opt-in, count-draft-preserved, double-click, edit45, cancel0, reapply30");

  for (const bad of ["", "-1", "1.5", "abc", "1000", "Infinity"]) {
    await input("#handling-minutes", bad); await save();
    assert.equal(await minute(), 30);
    assert.equal(await ev('document.querySelector("#handling-minutes").value'), bad);
  }
  checks.push("invalid-empty-negative-decimal-text-overlimit-infinity preserve stored30");
  await send("Page.reload", { ignoreCache: true }); await pause(350);
  assert.equal(await minute(), 30);
  assert.equal(await ev('document.querySelector("#handling-minutes").value'), "Infinity");
  await input("#handling-minutes", "30"); await save();
  checks.push("reload retains stored30 and unsaved invalid input for correction");

  const closed = fixture(true);
  closed.timeline.push(handling(await read())[0]);
  await seed(closed); await tab("report");
  const report = await ev('document.querySelector(".report").innerText');
  assert.match(report, /실제 배송 소요: 1시간 10분/);
  assert.match(report, /정리:.*20분/);
  assert.match(report, /이벤트: 30분/);
  assert.match(report, /총 배송 수량: 100개/);
  assert.match(report, /반품·선집화·상차/);
  checks.push("sorting20 plus handling30 = delivery70; report100 unchanged");
  let id = handling(await read())[0].id;
  const edit = async value => {
    await tab("log"); await click('[data-action="open-log-edit"][data-event="' + id + '"]');
    await input("#log-edit-" + id + "-minutes", value);
    await click('[data-action="save-log-edit"][data-event="' + id + '"]');
    assert.equal(await minute(), Number(value));
    assert.equal(handling(await read()).length, 1);
  };
  await edit("60"); await edit("0"); await edit("45");
  await click('[data-action="open-log-edit"][data-event="' + id + '"]');
  await shot("handling-log-411");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 762, deviceScaleFactor: 2.63, mobile: true });
  assert.equal(await ev("document.documentElement.scrollWidth > innerWidth"), false);
  await shot("handling-log-360");
  checks.push("completed-log60-cancel0-reapply45; no360overflow");

  await send("Emulation.setDeviceMetricsOverride", { width: 411, height: 762, deviceScaleFactor: 2.63, mobile: true });
  await seed(fixture(true)); await tab("log");
  await click('[data-action="open-log-edit"][data-event="end"]');
  assert.equal(await ev('document.querySelector("#log-edit-end-handling").value'), "0");
  await input("#log-edit-end-handling", "35");
  await click('[data-action="save-log-edit"][data-event="end"]');
  assert.equal(await minute(), 35);
  await click('[data-action="open-log-edit"][data-event="end"]');
  await input("#log-edit-end-handling", "40");
  await click('[data-action="save-log-edit"][data-event="end"]');
  assert.equal(await minute(), 40);
  assert.equal(handling(await read()).length, 1);
  assert.equal((await read()).timeline.find(e => e.id === "end").payload.delivered, 100);
  checks.push("add missed handling from completed-zone log; repeat update no duplicates/count changes");

  await seed(fixture(false, "custom-hils-2"));
  assert.equal(await ev('document.querySelector("#handling-minutes").value'), "30");
  await save();
  assert.equal(handling(await read())[0].zoneId, "custom-hils-2");
  checks.push("non-default hils zone ID uses independent record");
  assert.deepEqual(errors, []);
  await runSafetyChecks({ ev, send, seed, fixture, read, click, input, tab, until, pause, shot, checks, date });
  assert.deepEqual(errors, []);
  if (process.env.HANDLING_FULL_REGRESSION === "1") {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/run-browser-checks.mjs"], { windowsHide: true, stdio: "inherit",
        env: { ...process.env, SMOKE_BASE: base, CDP_PORT: String(cdpPort), SMOKE_SCREENSHOT: join(output, "regression.png") } });
      child.on("error", reject); child.on("exit", c => c === 0 ? resolve() : reject(Error("regression exit " + c)));
    });
    checks.push("current-isolated-field-and-storage-regression");
  }
  await writeFile(join(output, "result.json"), JSON.stringify({ viewport: "411x762 DPR2.63 (+360)", checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, artifacts: output }, null, 2));
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
