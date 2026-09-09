import assert from "node:assert/strict";

export async function runSafetyChecks({ ev, send, seed, fixture, read, click, input, tab, until, pause, shot, checks, date }) {
  const runtime = "window.__deliverySafety.runtime";
  const reload = async () => { await send("Page.reload", { ignoreCache: true }); await pause(350); };
  const fresh = async day => { await ev("localStorage.clear()"); await seed(day); };
  const backup = days => ({ schemaVersion: 1, app: "delivery-master-phone-install", backupType: "day-record-store", exportedAt: new Date().toISOString(), appVersion: "safety-test", scope: { kind: "all" }, days });
  const day2 = () => { const d = fixture(true); d.date = "2026-01-02"; d.id = "day-" + d.date; return d; };
  const all = () => ev(`${runtime}.store.createBackup({kind:"all"})`);
  const setFile = async data => ev(`${runtime}.platform.pickTextFile=async()=>({name:"isolated-test.json",text:${JSON.stringify(JSON.stringify(data))}});window.confirm=()=>true`);
  const logTime = async (id, hour, minute) => {
    await input("#log-edit-" + id + "-time-hour", hour);
    await input("#log-edit-" + id + "-time-minute", minute);
  };

  await fresh(fixture());
  await input("#hils-count", "123");
  await tab("log"); await tab("work");
  assert.equal(await ev('document.querySelector("#hils-count").value'), "123");
  await reload();
  assert.equal(await ev('document.querySelector("#hils-count").value'), "123");
  assert.match(await ev("document.body.innerText"), /입력 복원됨/);
  const before = await read();
  await ev(`window.__saveDay=${runtime}.store.saveDay.bind(${runtime}.store);${runtime}.store.saveDay=async()=>{throw Error("TEST_WRITE_FAILED")}`);
  await click('[data-action="save-handling"]');
  assert.deepEqual(await read(), before);
  assert.match(await ev("document.body.innerText"), /TEST_WRITE_FAILED/);
  assert.equal(await ev('document.querySelector("#hils-count").value'), "123");
  await ev(`${runtime}.store.saveDay=window.__saveDay`);
  await ev('document.querySelector("[data-action=save-handling]").click();document.querySelector("[data-action=save-handling]").click()');
  await pause(300);
  assert.equal((await read()).timeline.filter(e => e.payload?.kind === "handling_time").length, 1);
  checks.push("draft survives tabs/reload; failed save preserves full day; retry/double-tap yields one event");

  await fresh(fixture(true));
  await tab("log"); await click('[data-action="open-log-edit"][data-event="close"]');
  await logTime("close", "12", "05");
  await click('[data-action="save-log-edit"][data-event="close"]');
  assert.equal(new Date((await read()).timeline.find(e => e.id === "close").at).getUTCHours(), 3);
  await click('[data-action="open-log-edit"][data-event="close"]');
  assert.equal(await ev('document.querySelector("#log-edit-close-time-minute").value'), "05");
  await click('[data-action="close-log-edit"]');
  checks.push("day-close time can be edited and reopened repeatedly");

  await click('[data-action="open-log-edit"][data-event="end"]');
  await input("#log-edit-end-delivered", "120");
  const logBefore = await read();
  await ev(`${runtime}.store.saveDay=async()=>{throw Error("TEST_LOG_SAVE_FAILED")}`);
  await click('[data-action="save-log-edit"][data-event="end"]');
  assert.deepEqual(await read(), logBefore);
  assert.equal(await ev('document.querySelector("#log-edit-end-delivered").value'), "120");
  await ev(`${runtime}.store.saveDay=window.__saveDay`);
  // Reload recreates the real store while retaining the rejected editor draft.
  await reload(); await tab("log");
  await click('[data-action="open-log-edit"][data-event="end"]');
  assert.equal(await ev('document.querySelector("#log-edit-end-delivered").value'), "120");
  await click('[data-action="save-log-edit"][data-event="end"]');
  assert.equal((await read()).timeline.find(e=>e.id==="end").payload.delivered, 120);
  await click('[data-action="open-log-edit"][data-event="end"]');
  await logTime("end", "07", "00");
  await click('[data-action="save-log-edit"][data-event="end"]');
  await tab("report");
  assert.match(await ev('document.querySelector(".report").innerText'), /실제 효율: 시간당 -/);
  await tab("log"); await click('[data-action="open-log-edit"][data-event="end"]');
  await logTime("end", "11", "00");
  await click('[data-action="save-log-edit"][data-event="end"]');
  await tab("report");
  assert.match(await ev('document.querySelector(".report").innerText'), /실제 효율: 시간당 72개/);
  checks.push("log save failure keeps editor+120; reload retry saves; end before departure shows unknown; correction restores72perHour");

  const missed = fixture(true);
  missed.timeline = missed.timeline.filter(e => e.id !== "sorted");
  delete missed.zones[0].sortingEndEventId;
  const delivery = missed.timeline.find(e => e.id === "delivery");
  delivery.at = missed.timeline.find(e => e.id === "end").at;
  delivery.payload = { autoCorrected: true, correctionReason: "missing_delivery_start" };
  await fresh(missed); await tab("log");
  await click('[data-action="open-log-edit"][data-event="missing-sorting-end-hils"]');
  await logTime("missing-sorting-end-hils", "09", "30");
  await click('[data-action="save-log-edit"][data-event="missing-sorting-end-hils"]');
  const recovered = await read();
  assert.equal(new Date(recovered.timeline.find(e => e.id === "delivery").at).toISOString(), new Date(date + "T09:30:00+09:00").toISOString());
  await tab("report");
  assert.match(await ev('document.querySelector(".report").innerText'), /실제 배송 소요: 1시간 30분/);
  checks.push("forgot sorting finish: log adds09:30 and reanchors generated delivery start; 90min recovered");

  await fresh(fixture(true));
  await tab("backup");
  const original = await all();
  const malformed = fixture(true); malformed.timeline = [null];
  await setFile(backup([malformed]));
  await click('[data-action="import-phone-backup"]');
  assert.deepEqual((await all()).days, original.days);
  assert.match(await ev("document.body.innerText"), /손상/);
  checks.push("malformed nested backup rejected from real import UI without altering day");

  const replacement = fixture(true); replacement.timeline.find(e => e.id === "end").payload.total = 120;
  replacement.timeline.find(e => e.id === "end").payload.delivered = 120;
  await setFile(backup([replacement, day2()]));
  await ev('window.__put=IDBObjectStore.prototype.put;window.__puts=0;IDBObjectStore.prototype.put=function(...args){if(this.name==="dayRecords"&&++window.__puts===2)throw new DOMException("TEST_SECOND_WRITE","DataCloneError");return window.__put.apply(this,args)}');
  await click('[data-action="import-phone-backup"]'); await pause(200);
  await ev("IDBObjectStore.prototype.put=window.__put");
  assert.deepEqual((await all()).days, original.days);
  checks.push("second IndexedDB put synchronous exception rolls back first overwrite and second day");

  await setFile(backup([replacement, day2()]));
  await ev('window.__puts=0;IDBObjectStore.prototype.put=function(...args){const result=window.__put.apply(this,args);if(this.name==="dayRecords"&&++window.__puts===2)this.transaction.abort();return result}');
  await click('[data-action="import-phone-backup"]'); await pause(200);
  await ev("IDBObjectStore.prototype.put=window.__put");
  assert.deepEqual((await all()).days, original.days);
  checks.push("IndexedDB transaction abort rolls back entire multi-day import");

  await setFile(backup([replacement, day2()]));
  await ev(`window.__snapshot=${runtime}.platform.saveJsonSnapshot.bind(${runtime}.platform);window.__snapshotCalls=0;${runtime}.platform.saveJsonSnapshot=async(...args)=>{if(++window.__snapshotCalls===2)throw Error("TEST_POST_SNAPSHOT");return window.__snapshot(...args)}`);
  await click('[data-action="import-phone-backup"]');
  assert.equal((await all()).days.length, 2);
  assert.equal((await read()).timeline.find(e => e.id === "end").payload.delivered, 120);
  assert.match(await ev("document.body.innerText"), /기록 반영은 완료/);
  assert.match(await ev("document.body.innerText"), /가져온 기록: 2일/);
  await ev(`${runtime}.platform.saveJsonSnapshot=window.__snapshot`);
  checks.push("post-commit snapshot failure reports actual imported2, not false0");

  await reload(); await tab("backup");
  await setFile(backup([fixture(true), day2()]));
  await ev("window.__confirms=0;window.confirm=()=>++window.__confirms===1");
  await click('[data-action="import-phone-backup"]');
  assert.equal((await read()).timeline.find(e => e.id === "end").payload.delivered, 120);
  assert.match(await ev("document.body.innerText"), /가져온 기록: 0일/);
  checks.push("skip existing retains120 and truthfully reports zero new dates");

  // A corrupt historical row must not prevent today's recording or safe repair.
  await fresh(fixture(true));
  const corrupt = day2(); corrupt.timeline = [null];
  await ev(`new Promise((resolve,reject)=>{const q=indexedDB.open("delivery-master-install");q.onsuccess=()=>{const db=q.result;const tx=db.transaction("dayRecords","readwrite");tx.objectStore("dayRecords").put(${JSON.stringify(corrupt)});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=reject}})`);
  await reload();
  assert.match(await ev("document.body.innerText"), /2026-01-02 기록을 읽지 못했습니다/);
  assert.equal((await all()).days.length, 2);
  await tab("backup"); await setFile(backup([day2()]));
  await click('[data-action="import-phone-backup"]');
  assert(!/2026-01-02 기록을 읽지 못했습니다/.test(await ev("document.body.innerText")));
  checks.push("corrupt history preserved in raw backup; other day opens; overwrite repairs selected date");

  // Corrupt today: offer recovery, never silently create an empty replacement.
  const corruptToday = fixture(true); corruptToday.timeline = [null];
  await ev(`new Promise((resolve,reject)=>{const q=indexedDB.open("delivery-master-install");q.onsuccess=()=>{const db=q.result;const tx=db.transaction("dayRecords","readwrite");tx.objectStore("dayRecords").put(${JSON.stringify(corruptToday)});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=reject}})`);
  await reload();
  assert.match(await ev("document.body.innerText"), /기록을 불러오지 못했습니다/);
  assert.deepEqual((await read()).timeline, [null]);
  await setFile(backup([fixture(true)]));
  await click("#recover-import");
  await until('!!document.querySelector(".tabbar")');
  assert.equal((await read()).timeline.filter(e => e.type === "zone_end").length, 1);
  checks.push("corrupt today is not reset; recovery UI repairs from valid backup");

  // Work already started stays fixed; only pending zones move.
  const route = fixture(true);
  route.status = "active"; route.timeline = route.timeline.filter(e => e.type !== "day_close");
  route.zones.push({ id: "miju", name: "미주", order: 2 }, { id: "alt-1", name: "대체배송", order: 3 }, { id: "alt-2", name: "대체배송 2", order: 4 });
  await fresh(route);
  await click('[data-action="open-route-plans"]');
  await click('[data-action="move-zone-up"][data-zone="alt-2"]');
  await click('[data-action="move-zone-up"][data-zone="alt-2"]');
  let ordered = (await read()).zones.sort((a,b)=>a.order-b.order).map(z=>z.id);
  assert.deepEqual(ordered, ["hils","alt-2","miju","alt-1"]);
  await click('.route-sheet [data-action="open-route-editor"]:not([data-zone])');
  await click('[data-action="save-route-editor"]');
  assert.equal((await read()).zones.length, 5);
  assert.equal(await ev('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size === document.querySelectorAll("[id]").length'), true);
  await shot("safety-route-411");
  checks.push("pending zones reorder after completed first zone; repeated alternate addition; no duplicate DOM ids");

  await fresh(fixture());
  const midnightBefore = await read();
  const tomorrow = new Date(new Date(date + "T12:00:00+09:00").getTime() + 86400000).toISOString();
  await ev(`window.__Date=Date;window.Date=class extends window.__Date{constructor(...args){super(...(args.length?args:[${JSON.stringify(tomorrow)}]))}static now(){return new window.__Date(${JSON.stringify(tomorrow)}).getTime()}};window.dispatchEvent(new Event("focus"))`);
  await until('!!document.querySelector("[data-action=continue-previous-day]")');
  assert.deepEqual(await read(), midnightBefore);
  await click('[data-action="start-today"]');
  assert.deepEqual(await read(), midnightBefore);
  assert.equal((await all()).days.length, 2);
  await ev("window.Date=window.__Date"); await reload();
  checks.push("midnight active-work choice preserves yesterday; opening today creates separate day");

  await fresh(fixture(true)); await tab("stats");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 762, deviceScaleFactor: 2.63, mobile: true });
  assert.equal(await ev("document.documentElement.scrollWidth > innerWidth"), false);
  await shot("safety-stats-360");
  await tab("log");
  const logText = await ev('document.querySelector(".timeline-log").innerText');
  assert(logText.indexOf("청량리 도착") < logText.indexOf("1구역 시작"));
  assert(logText.indexOf("1구역 시작") < logText.indexOf("정리 시작"));
  assert(logText.indexOf("정리 완료") < logText.indexOf("배송 시작"));
  const pens = await ev('[...document.querySelectorAll(".timeline-edit-btn")].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))');
  assert(pens.length > 0 && pens.every(p=>p.w >= 48 && p.h >= 48));
  assert.equal(await ev("document.documentElement.scrollWidth > innerWidth"), false);
  await shot("safety-log-360");
  checks.push("360px stats/log fit; all edit touch targets at least48x48");
  checks.push("same-minute log follows arrival-zone start-sorting start-sorting end-delivery start");
}
