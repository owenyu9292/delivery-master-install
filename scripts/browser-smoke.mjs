const base = process.env.SMOKE_BASE || "http://localhost:4173";
const cdpPort = Number(process.env.CDP_PORT || 9223);
const phoneViewport = {
  width: Number(process.env.SMOKE_WIDTH || 411),
  height: Number(process.env.SMOKE_HEIGHT || 762),
  deviceScaleFactor: Number(process.env.SMOKE_DPR || 2.63),
};
const screenshotName = process.env.SMOKE_SCREENSHOT || `review-fold-cover-${phoneViewport.width}x${phoneViewport.height}.png`;
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
    return;
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
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function click(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
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

async function selectCorrectionTarget(labelFragment) {
  return evaluate(`(() => {
    const select = document.querySelector("#correction-target");
    if (!select) return "";
    const option = [...select.options].find((candidate) => candidate.textContent.includes(${JSON.stringify(labelFragment)}));
    if (!option) return "";
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  })()`);
}

async function setSelectedZoneCorrectionKind(kind) {
  return evaluate(`(() => {
    const select = document.querySelector("#correction-zone-kind");
    if (!select) return false;
    select.value = ${JSON.stringify(kind)};
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function setSelectedZoneCorrectionName(name) {
  return setValue("#correction-zone-name", name);
}

async function activeHelperId() {
  return evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-action="save-helper-correction"][data-helper]')];
    return buttons.at(-1)?.dataset.helper || "";
  })()`);
}

async function setHelperKind(helperId, kind) {
  return evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(`select[data-helper-kind="${helperId}"]`)});
    if (!select) return false;
    select.value = ${JSON.stringify(kind)};
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function setHelperRestoreTarget(helperId, target) {
  return evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(`select[data-helper-zone-restore="${helperId}"]`)});
    if (!select) return false;
    select.value = ${JSON.stringify(target)};
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

function wait(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stablePastRegularOffDate() {
  return "2024-01-01";
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  ...phoneViewport,
  mobile: true,
});
await send("Storage.clearDataForOrigin", {
  origin: base,
  storageTypes: "all",
});
await send("Page.navigate", { url: base });
await wait(900);
await evaluate(`new Promise((resolve) => {
  const request = indexedDB.deleteDatabase("delivery-master-install");
  request.onsuccess = () => resolve(true);
  request.onerror = () => resolve(false);
  request.onblocked = () => resolve(false);
})`);
await send("Page.navigate", { url: base });
await wait(900);

await click('[data-action="reset-confirm"]');
await wait(400);
await click('[data-action="depart"]');
await wait(400);
const emptyDepartBlocked = await evaluate(`(() => {
  return Boolean(document.querySelector("#expected-count")) &&
    !document.querySelector('[data-action="arrive"]');
})()`);
await setValue("#expected-count", "552");
await click('[data-action="depart"]');
await wait();
await click('[data-action="arrive"]');
await wait();
await click('[data-action="prepare-default-order"]');
await wait();
const startButtonBeforeOrderEditor = await evaluate(`(() => {
  const start = document.querySelector('[data-action="zone-start"][data-zone="miju"]');
  const order = document.querySelector(".order-editor");
  if (!start || !order) return false;
  return Boolean(start.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING);
})()`);

const orderBefore = await bodyText();
await click('[data-action="move-zone-down"][data-zone="miju"]');
await wait();
const orderAfterDown = await bodyText();
await click('[data-action="move-zone-up"][data-zone="miju"]');
await wait();
const orderAfterUp = await bodyText();
await click('[data-action="add-alt-zone-to-order"]');
await wait();
const orderWithAlt = await bodyText();

await click('[data-action="zone-start"][data-zone="miju"]');
await wait();
await setValue("#miju-1-count", "44");
await setValue("#miju-2-count", "55");
await setValue("#miju-3-count", "54");
await click('[data-action="save-miju-detail"]');
await wait();
await click('[data-action="zone-end"][data-zone="miju"]');
await wait(500);
const afterMijuMissingTotal = await bodyText();
await setValue("#miju-total-count", "321");
await click('[data-action="zone-end"][data-zone="miju"]');
await wait(700);
const afterMiju = await bodyText();

await click('[data-action="zone-start"][data-zone="hils"]');
await wait();
const genericInitialUiOrder = await evaluate(`(() => {
  const sortStart = document.querySelector('[data-action="sorting-start"][data-zone="hils"]');
  const deliveryStart = document.querySelector('[data-action="delivery-start"][data-zone="hils"]');
  if (!sortStart || !deliveryStart) return false;
  return Boolean(sortStart.compareDocumentPosition(deliveryStart) & Node.DOCUMENT_POSITION_FOLLOWING) &&
    !sortStart.classList.contains("secondary") &&
    deliveryStart.classList.contains("secondary");
})()`);
await click('[data-action="sorting-start"][data-zone="hils"]');
await wait();
const sortingEndBeforeCleanupCorrection = await evaluate(`(() => {
  const sortingEnd = document.querySelector('[data-action="sorting-end"][data-zone="hils"]');
  const fixCleanup = document.querySelector('[data-action="fix-cleanup"][data-zone="hils"]');
  const skipCleanup = document.querySelector('[data-action="skip-cleanup"][data-zone="hils"]');
  if (!sortingEnd || !fixCleanup || !skipCleanup) return false;
  return Boolean(sortingEnd.compareDocumentPosition(fixCleanup) & Node.DOCUMENT_POSITION_FOLLOWING) &&
    Boolean(sortingEnd.compareDocumentPosition(skipCleanup) & Node.DOCUMENT_POSITION_FOLLOWING);
})()`);
const genericSortingUiOrder = await evaluate(`(() => {
  const button = document.querySelector('[data-action="sorting-end"][data-zone="hils"]');
  const hint = [...document.querySelectorAll(".hint")].find((item) => item.textContent.includes("정리가 끝나면"));
  if (!button || !hint) return false;
  return Boolean(button.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING);
})()`);
await click('[data-action="sorting-end"][data-zone="hils"]');
await wait();
const genericCountUiOrder = await evaluate(`(() => {
  const input = document.querySelector("#hils-count");
  const finish = document.querySelector('[data-action="zone-end"][data-zone="hils"]');
  const hint = [...document.querySelectorAll(".hint")].find((item) => item.textContent.includes("뒤 구역에서는"));
  if (!input || !finish || !hint) return false;
  return Boolean(input.compareDocumentPosition(finish) & Node.DOCUMENT_POSITION_FOLLOWING) &&
    Boolean(finish.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING);
})()`);
await evaluate(`(() => {
  window.__autoDialogCount = 0;
  window.__autoDialogMessage = "";
  window.confirm = (message) => {
    window.__autoDialogCount += 1;
    window.__autoDialogMessage = message;
    return true;
  };
  window.alert = (message) => {
    window.__autoDialogCount += 1;
    window.__autoDialogMessage = message;
  };
})()`);
await setValue("#hils-count", "560");
await click('[data-action="zone-end"][data-zone="hils"]');
await wait(900);
const afterHils = await bodyText();
const autoDialogCount = await evaluate("window.__autoDialogCount || 0");
const autoDialogMessage = await evaluate("window.__autoDialogMessage || ''");
const viewportInfo = await evaluate(`(() => ({
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: window.devicePixelRatio,
}))()`);
const mobileViewport = viewportInfo.width === phoneViewport.width
  && viewportInfo.height === phoneViewport.height
  && Math.abs(viewportInfo.dpr - phoneViewport.deviceScaleFactor) < 0.01;
const editFormMobileOk = await evaluate(`(() => {
  document.querySelectorAll("details.zone-edit").forEach((item) => { item.open = true; });
  const timeInputs = [
    "#edit-miju-start",
    "#edit-miju-end",
    "#edit-hils-start",
    "#edit-hils-end",
    "#edit-hils-sorting-start",
    "#edit-hils-sorting-end",
  ].map((selector) => document.querySelector(selector));
  const timeTypesOk = timeInputs.every((input) => input && input.type === "time");
  const noDateTimeInputs = ![...document.querySelectorAll("details.zone-edit input")]
    .some((input) => input.type === "datetime-local");
  const noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth + 2;
  return timeTypesOk && noDateTimeInputs && noHorizontalOverflow;
})()`);
await setValue("#edit-hils-start", "00:00");
await click('[data-action="save-zone-edit"][data-zone="hils"]');
await wait(500);
const timelineEditText = await bodyText();
const timelineEditBlocked = timelineEditText.includes("수 없습니다.")
  && !timelineEditText.includes("완료 구역 수정이 저장됐습니다.");

await click('[data-action="set-tab"][data-tab="log"]');
await wait();
const logText = await bodyText();
const arriveBeforeMijuStart = logText.indexOf("청량리 도착") >= 0
  && logText.indexOf("1구역 시작 · 미주") >= 0
  && logText.indexOf("청량리 도착") < logText.indexOf("1구역 시작 · 미주");
const previousZoneEndBeforeNextZoneStart = logText.indexOf("미주 완료") >= 0
  && logText.indexOf("2구역 시작 · 힐스테이트") >= 0
  && logText.indexOf("미주 완료") < logText.indexOf("2구역 시작 · 힐스테이트");
await click('[data-action="set-tab"][data-tab="report"]');
await wait();
const reportText = await bodyText();
await click('[data-action="set-tab"][data-tab="stats"]');
await wait();
const statsWeekText = await bodyText();
await click('[data-action="stats-week-prev"]');
await wait();
const statsPrevWeekText = await bodyText();
await click('[data-action="set-stats-tab"][data-stats-tab="month"]');
await wait();
const statsMonthText = await bodyText();
await click('[data-action="stats-month-prev"]');
await wait();
const statsPrevMonthText = await bodyText();
await click('[data-action="set-stats-tab"][data-stats-tab="date"]');
await wait();
const statsDateText = await bodyText();
const virtualHolidayDate = stablePastRegularOffDate();
await setValue("#stats-date-input", virtualHolidayDate);
await wait();
const statsHolidayText = await bodyText();
await click('[data-action="set-tab"][data-tab="backup"]');
await wait();
const backupText = await bodyText();

await click('[data-action="reset-confirm"]');
await wait(400);
await click('[data-action="set-tab"][data-tab="work"]');
await wait();
await setValue("#expected-count", "100");
await click('[data-action="depart"]');
await wait();
await click('[data-action="arrive"]');
await wait();
await click('[data-action="prepare-default-order"]');
await wait();
await setValue("#custom-zone-name", "상가 추가");
await click('[data-action="add-custom-zone-to-order"]');
await wait();
await click('[data-action="move-zone-down"][data-zone="miju"]');
await wait();
await click('[data-action="move-zone-down"][data-zone="miju"]');
await wait();
await click('[data-action="move-zone-down"][data-zone="miju"]');
await wait();
await click('[data-action="zone-start"][data-zone="hils"]');
await wait();
await click('[data-action="delivery-start"][data-zone="hils"]');
await wait();
await click('[data-action="zone-end"][data-zone="hils"]');
await wait(500);
const afterMissing = await bodyText();
await setValue("#hils-count", "13");
await click('[data-action="zone-end"][data-zone="hils"]');
await wait(500);
const afterDirectHils = await bodyText();
const altZoneId = await evaluate(`(() => {
  const button = [...document.querySelectorAll('[data-action="zone-start"]')]
    .find((item) => item.textContent.includes("대체배송"));
  return button?.dataset.zone || "";
})()`);
if (altZoneId) {
  await click(`[data-action="zone-start"][data-zone="${altZoneId}"]`);
  await wait();
  await click(`[data-action="delivery-start"][data-zone="${altZoneId}"]`);
  await wait();
  await setValue("#extra-count", "7");
  await click(`[data-action="zone-end"][data-zone="${altZoneId}"]`);
  await wait(500);
}
const afterDirectAlt = await bodyText();
const customZoneId = await evaluate(`(() => {
  const button = [...document.querySelectorAll('[data-action="zone-start"]')]
    .find((item) => item.textContent.includes("상가 추가"));
  return button?.dataset.zone || "";
})()`);
if (customZoneId) {
  await click(`[data-action="zone-start"][data-zone="${customZoneId}"]`);
  await wait();
  await click(`[data-action="delivery-start"][data-zone="${customZoneId}"]`);
  await wait();
  await setValue("#extra-count", "5");
  await click(`[data-action="zone-end"][data-zone="${customZoneId}"]`);
  await wait(500);
}
const afterDirectCustom = await bodyText();

await click('[data-action="set-tab"][data-tab="backup"]');
await wait();
const selectedAltForPaid = await selectCorrectionTarget("대체배송");
if (selectedAltForPaid) {
  await click('[data-action="select-correction-target"]');
  await wait(300);
  await setSelectedZoneCorrectionKind("paid_received");
  await click('[data-action="save-zone-correction"]');
}
await wait(900);
const afterAltToPaidHelper = await bodyText();
await selectCorrectionTarget("도우미 배송 유료");
await click('[data-action="select-correction-target"]');
await wait(300);
const helperIdAfterPaid = await activeHelperId();
if (helperIdAfterPaid) {
  await setHelperKind(helperIdAfterPaid, "free_received");
  await click(`[data-action="save-helper-correction"][data-helper="${helperIdAfterPaid}"]`);
  await wait(900);
}
const afterPaidToFreeHelper = await bodyText();
await selectCorrectionTarget("도우미 배송 무료");
await click('[data-action="select-correction-target"]');
await wait(300);
if (helperIdAfterPaid) {
  await setHelperRestoreTarget(helperIdAfterPaid, "alt");
  await click(`[data-action="restore-helper-zone"][data-helper="${helperIdAfterPaid}"]`);
  await wait(900);
}
const afterHelperRestoredToAlt = await bodyText();

const selectedCustomForRepeatedEdit = await selectCorrectionTarget("상가 추가");
if (selectedCustomForRepeatedEdit) {
  await click('[data-action="select-correction-target"]');
  await wait(300);
  await setSelectedZoneCorrectionKind("alt");
  await setSelectedZoneCorrectionName("상가 정정");
  await setValue("#correction-zone-delivered", "6");
  await click('[data-action="save-zone-correction"]');
  await wait(900);
}
const afterCorrectedZoneEdited = await bodyText();

const selectedAltAgain = await selectCorrectionTarget("대체배송");
if (selectedAltAgain) {
  await click('[data-action="select-correction-target"]');
  await wait(300);
  await setSelectedZoneCorrectionKind("paid_received");
  await click('[data-action="save-zone-correction"]');
}
await wait(900);
await selectCorrectionTarget("도우미 배송 유료");
await click('[data-action="select-correction-target"]');
await wait(300);
const helperIdForHilsRestore = await activeHelperId();
if (helperIdForHilsRestore) {
  await setHelperRestoreTarget(helperIdForHilsRestore, "hils");
  await click(`[data-action="restore-helper-zone"][data-helper="${helperIdForHilsRestore}"]`);
  await wait(900);
}
const afterHelperRestoredToHils = await bodyText();

const selectedHilsForHelper = await selectCorrectionTarget("힐스테이트");
if (selectedHilsForHelper) {
  await click('[data-action="select-correction-target"]');
  await wait(300);
  await setSelectedZoneCorrectionKind("free_received");
  await click('[data-action="save-zone-correction"]');
}
await wait(900);
await selectCorrectionTarget("도우미 배송 무료");
await click('[data-action="select-correction-target"]');
await wait(300);
const helperIdForMijuRestore = await activeHelperId();
if (helperIdForMijuRestore) {
  await setHelperRestoreTarget(helperIdForMijuRestore, "miju");
  await click(`[data-action="restore-helper-zone"][data-helper="${helperIdForMijuRestore}"]`);
  await wait(900);
}
const afterHelperRestoredToMiju = await bodyText();

await evaluate("window.confirm = (message) => { window.__lastConfirm = message; return false; }");
await setValue("#hils-count", "999");
await click('[data-action="zone-end"][data-zone="hils"]');
await wait(500);
const afterHuge = await bodyText();
const hugeConfirm = await evaluate("window.__lastConfirm || ''");

const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await import("node:fs").then((fs) => {
  fs.writeFileSync(screenshotName, Buffer.from(screenshot.data, "base64"));
});

const result = {
  expectedViewport: phoneViewport,
  viewportInfo,
  mobileViewport,
  emptyDepartBlocked,
  startButtonBeforeOrderEditor,
  orderEditorShown: orderBefore.includes("오늘 작업 순서") && orderBefore.includes("▲") && orderBefore.includes("▼"),
  movedDown: orderAfterDown.includes("1. 힐스테이트") && orderAfterDown.includes("2. 미주"),
  movedBackUp: orderAfterUp.includes("1. 미주") && orderAfterUp.includes("2. 힐스테이트"),
  addedAlt: orderWithAlt.includes("대체배송"),
  genericInitialUiOrder,
  sortingEndBeforeCleanupCorrection,
  genericSortingUiOrder,
  genericCountUiOrder,
  editFormMobileOk,
  timelineEditBlocked,
  arriveBeforeMijuStart,
  previousZoneEndBeforeNextZoneStart,
  mijuMissingTotalBlocked: afterMijuMissingTotal.includes("미주 전체 수량을 입력해야"),
  mijuAutoRest: afterMiju.includes("미주 총합 321개 / A 153개 / 나머지 168개") || afterMiju.includes("수량 321개"),
  hilsSuggested: afterHils.includes("수량 239개") || afterHils.includes("배송 239개"),
  statsRatioCardFirst: statsWeekText.indexOf("이번 주 비율") >= 0
    && statsWeekText.indexOf("이번 주 비율") < statsWeekText.indexOf("총 배송"),
  statsRatioLabel: statsWeekText.includes("미57:힐43:대0"),
  statsWeekNavigation: statsPrevWeekText.includes("정기휴무") || statsPrevWeekText.includes("데이터 없음"),
  statsMonthNavigation: statsMonthText.includes("이번 달 비율")
    && (statsPrevMonthText.includes("정기휴무") || statsPrevMonthText.includes("데이터 없음")),
  statsDateSearch: statsDateText.includes("날짜 선택")
    && statsDateText.includes("로그")
    && statsDateText.includes("리포트")
    && statsDateText.includes("청량리 도착"),
  statsVirtualHoliday: statsHolidayText.includes("정기휴무")
    && statsHolidayText.includes("백업 JSON에는 휴무 기록을 새로 만들지 않습니다."),
  backupShowsViewport: backupText.includes("화면 정보") && backupText.includes(`${phoneViewport.width}x${phoneViewport.height}`),
  missingQuantityBlocked: !afterMissing.includes("힐스테이트 | 완료"),
  directHilsFirstComplete: afterDirectHils.includes("힐스테이트") && afterDirectHils.includes("수량 13개"),
  directAlternateComplete: afterDirectAlt.includes("대체배송") && afterDirectAlt.includes("수량 7개"),
  directCustomComplete: afterDirectCustom.includes("상가 추가") && afterDirectCustom.includes("수량 5개"),
  correctionAltToPaidHelper: afterAltToPaidHelper.includes("도우미 배송 유료") && afterAltToPaidHelper.includes("7개"),
  correctionPaidToFreeHelper: afterPaidToFreeHelper.includes("도우미 배송 무료") && afterPaidToFreeHelper.includes("효율 제외"),
  correctionHelperRestoredToAlt: afterHelperRestoredToAlt.includes("대체배송") && afterHelperRestoredToAlt.includes("구역 기록으로 복구"),
  correctionZoneRepeatedEdit: afterCorrectedZoneEdited.includes("상가 정정") && afterCorrectedZoneEdited.includes("6개"),
  correctionHelperRestoredToHils: afterHelperRestoredToHils.includes("힐스테이트") && afterHelperRestoredToHils.includes("구역 기록으로 복구"),
  correctionHelperRestoredToMiju: afterHelperRestoredToMiju.includes("미주") && afterHelperRestoredToMiju.includes("구역 기록으로 복구"),
  hugeQuantityBlockedOrWarned: !afterHuge.includes("수량 999개"),
  screenshotName,
  hugeConfirm,
  afterHugeSnippet: afterHuge.slice(afterHuge.indexOf("구역 현황"), afterHuge.indexOf("통계")).replace(/\n+/g, " | "),
  afterHilsSnippet: afterHils
    .slice(afterHils.indexOf("구역 현황"), afterHils.indexOf("통계"))
    .replace(/\n+/g, " | "),
};

console.log(JSON.stringify(result, null, 2));
const requiredTrue = Object.entries(result)
  .filter(([key, value]) => typeof value === "boolean" && key !== "hugeConfirm")
  .filter(([, value]) => value !== true)
  .map(([key]) => key);
if (requiredTrue.length > 0) {
  ws.close();
  throw new Error(`browser smoke failed: ${requiredTrue.join(", ")}`);
}
ws.close();
