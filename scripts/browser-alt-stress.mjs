const base = process.env.SMOKE_BASE || "http://localhost:4173";
const cdpPort = Number(process.env.CDP_PORT || 9223);
const phoneViewport = {
  width: Number(process.env.SMOKE_WIDTH || 411),
  height: Number(process.env.SMOKE_HEIGHT || 762),
  deviceScaleFactor: Number(process.env.SMOKE_DPR || 2.63),
};

async function openSmokeTab() {
  const response = await fetch(`http://localhost:${cdpPort}/json/new?${encodeURIComponent(base)}`, { method: "PUT" });
  if (response.ok) return response.json();
  const tabs = await (await fetch(`http://localhost:${cdpPort}/json`)).json();
  return tabs.find((item) => item.type === "page") || tabs[0];
}

const tab = await openSmokeTab();
const ws = new WebSocket(tab.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let seq = 0;
const pending = new Map();

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
  if (message.method === "Page.javascriptDialogOpening") {
    void send("Page.handleJavaScriptDialog", { accept: true });
  }
};

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function wait(ms = 350) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function click(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);
}

async function setValue(selector, value) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function bodyText() {
  return evaluate("document.body.innerText");
}

async function findStartButtonByName(name) {
  return evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-action="zone-start"]')]
      .find((item) => item.textContent.includes(${JSON.stringify(name)}));
    return button?.dataset.zone || "";
  })()`);
}

async function findCurrentZoneId() {
  return evaluate(`(() => {
    const delivery = document.querySelector('[data-action="delivery-start"]');
    if (delivery?.dataset.zone) return delivery.dataset.zone;
    const zoneEnd = document.querySelector('[data-action="zone-end"]');
    if (zoneEnd?.dataset.zone) return zoneEnd.dataset.zone;
    const start = document.querySelector('[data-action="zone-start"]');
    return start?.dataset.zone || "";
  })()`);
}

async function moveZoneToTop(name) {
  for (let i = 0; i < 5; i += 1) {
    const moved = await evaluate(`(() => {
      const row = [...document.querySelectorAll(".order-row")]
        .find((item) => item.textContent.includes(${JSON.stringify(name)}));
      const button = row?.querySelector('[data-action="move-zone-up"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!moved) return;
    await wait(150);
  }
}

async function addAlternateNow() {
  const ok = await click('[data-action="add-alt-zone"]');
  if (!ok) throw new Error("대체배송 계속 추가 버튼을 찾지 못했습니다.");
  await wait(500);
}

async function skipVisibleExtraZone() {
  const id = await evaluate(`(() => {
    const button = document.querySelector('[data-action="skip-zone"]');
    return button?.dataset.zone || "";
  })()`);
  if (!id) return false;
  await click(`[data-action="skip-zone"][data-zone="${id}"]`);
  await wait(500);
  return true;
}

async function closeDayIfReady() {
  const ok = await click('[data-action="close-day"]');
  await wait(500);
  return ok;
}

async function startVisibleZone(name) {
  const id = await findStartButtonByName(name);
  if (!id) throw new Error(`${name} 시작 버튼을 찾지 못했습니다.`);
  await click(`[data-action="zone-start"][data-zone="${id}"]`);
  await wait(350);
  return id;
}

async function completeMiju(cumulativeTotal, detail = [2, 2, 2]) {
  const id = await findCurrentZoneId();
  if (id !== "miju") throw new Error(`미주 화면이 아닙니다: ${id}`);
  await setValue("#miju-1-count", String(detail[0]));
  await setValue("#miju-2-count", String(detail[1]));
  await setValue("#miju-3-count", String(detail[2]));
  await click('[data-action="save-miju-detail"]');
  await wait(250);
  await setValue("#miju-total-count", String(cumulativeTotal));
  await click('[data-action="zone-end"][data-zone="miju"]');
  await wait(700);
}

async function completeGeneric(cumulativeTotal) {
  const id = await findCurrentZoneId();
  if (!id || id === "miju") throw new Error(`일반 구역 화면이 아닙니다: ${id}`);
  await click(`[data-action="delivery-start"][data-zone="${id}"]`);
  await wait(250);
  const inputId = id === "hils" ? "#hils-count" : "#extra-count";
  await setValue(inputId, String(cumulativeTotal));
  await click(`[data-action="zone-end"][data-zone="${id}"]`);
  await wait(700);
  return id;
}

async function resetAndStart(expected = 300) {
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: base });
  await wait(900);
  await setValue("#expected-count", String(expected));
  await click('[data-action="depart"]');
  await wait(350);
  await click('[data-action="arrive"]');
  await wait(350);
  await click('[data-action="prepare-default-order"]');
  await wait(500);
}

async function summary() {
  return evaluate(`(() => [...document.querySelectorAll(".zone-card")]
    .map((card) => card.innerText.replace(/\\n+/g, " | "))
    .join(" || "))()`);
}

async function runScenario(name, steps) {
  await resetAndStart();
  const records = [];
  for (const step of steps) {
    if (step.kind === "moveTop") {
      await moveZoneToTop(step.name);
    } else if (step.kind === "addAlt") {
      await addAlternateNow();
    } else if (step.kind === "start") {
      await startVisibleZone(step.name);
    } else if (step.kind === "completeMiju") {
      await completeMiju(step.total, step.detail);
    } else if (step.kind === "completeGeneric") {
      await completeGeneric(step.total);
    } else if (step.kind === "skipExtra") {
      await skipVisibleExtraZone();
    } else if (step.kind === "closeDay") {
      await closeDayIfReady();
    }
    records.push(await bodyText());
  }
  const text = await bodyText();
  return { name, ok: true, text, summary: await summary(), records };
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { ...phoneViewport, mobile: true });

const scenarios = [];

scenarios.push(await runScenario("alt-miju-alt-hils-alt", [
  { kind: "moveTop", name: "대체배송" },
  { kind: "start", name: "대체배송" },
  { kind: "completeGeneric", total: 10 },
  { kind: "start", name: "미주" },
  { kind: "completeMiju", total: 40, detail: [5, 6, 7] },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 55 },
  { kind: "start", name: "힐스테이트" },
  { kind: "completeGeneric", total: 80 },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 92 },
  { kind: "closeDay" },
]));

scenarios.push(await runScenario("miju-alt-hils-alt-alt", [
  { kind: "start", name: "미주" },
  { kind: "completeMiju", total: 30, detail: [4, 5, 6] },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 45 },
  { kind: "start", name: "힐스테이트" },
  { kind: "completeGeneric", total: 70 },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 85 },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 96 },
  { kind: "skipExtra" },
  { kind: "closeDay" },
]));

scenarios.push(await runScenario("hils-alt-miju-alt-alt", [
  { kind: "moveTop", name: "힐스테이트" },
  { kind: "start", name: "힐스테이트" },
  { kind: "completeGeneric", total: 20 },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 35 },
  { kind: "start", name: "미주" },
  { kind: "completeMiju", total: 75, detail: [7, 8, 9] },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 90 },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 102 },
  { kind: "skipExtra" },
  { kind: "closeDay" },
]));

scenarios.push(await runScenario("today-alt-alt-alt-miju-hils", [
  { kind: "moveTop", name: "대체배송" },
  { kind: "start", name: "대체배송" },
  { kind: "completeGeneric", total: 27 },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 42 },
  { kind: "addAlt" },
  { kind: "completeGeneric", total: 115 },
  { kind: "start", name: "미주" },
  { kind: "completeMiju", total: 154, detail: [4, 4, 5] },
  { kind: "start", name: "힐스테이트" },
  { kind: "completeGeneric", total: 163 },
  { kind: "closeDay" },
]));

const checks = scenarios.map((scenario) => ({
  name: scenario.name,
  hasAllDone: scenario.text.includes("완료"),
  hasAltRepeat: /대체배송 2|대체배송 3/.test(scenario.text),
  hasNoNaN: !scenario.text.includes("NaN"),
  hasNoNegativeQuantity: !/수량 -\\d+개/.test(scenario.text),
  hasNoWaitingAltAtEnd: !scenario.summary.includes("대체배송 | 대기"),
  canCloseAfterRoute: scenario.text.includes("오늘 업무가 종료됐습니다"),
  summary: scenario.summary,
}));

const result = {
  viewport: phoneViewport,
  checks,
  allPassed: checks.every((item) =>
    item.hasAllDone &&
    item.hasAltRepeat &&
    item.hasNoNaN &&
    item.hasNoNegativeQuantity &&
    item.hasNoWaitingAltAtEnd &&
    item.canCloseAfterRoute
  ),
};

console.log(JSON.stringify(result, null, 2));
ws.close();

if (!result.allPassed) {
  throw new Error(`alternate stress failed: ${checks.filter((item) =>
    !(item.hasAllDone &&
      item.hasAltRepeat &&
      item.hasNoNaN &&
      item.hasNoNegativeQuantity &&
      item.hasNoWaitingAltAtEnd &&
      item.canCloseAfterRoute)
  ).map((item) => item.name).join(", ")}`);
}

