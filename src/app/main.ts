import { applyMissingCleanupCorrection, hasMissingCleanupFinish } from "../domain/cleanupCorrection";
import { DEFAULT_HANDLING_MINUTES, HANDLING_TITLE, findHandlingEvent, isHandlingEvent, readHandlingMinutes, setHandlingMinutes } from "../domain/handlingTime";
import { applyCompletedZoneEdit } from "../domain/zoneEdit";
import { applyLinkedEventTime } from "../domain/timeLinks";
import { applyAutomaticCleanup } from "../domain/autoCleanup";
import { captureHelperZone, restoreConvertedHelperZone, type HelperZoneSnapshot } from "../domain/helperZoneSnapshot";
import { assertDayRecord } from "../storage/recordValidation";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { createEvent, updateEvent } from "../domain/eventTimeline";
import { calculateDay } from "../domain/deliveryCalc";
import { buildDailyReport } from "../domain/reportBuilder";
import { resolveMijuDetailQuantity, validateZoneQuantity } from "../domain/zoneValidation";
import { resolveMissingDeliveryStart } from "../domain/deliveryStartRecovery";
import { validateTimeAxis } from "../domain/timeAxisValidation";
import type { DayCalculation, DayRecord, HelperRecord, ReportResult, TimelineEvent, TimelineEventType, ZoneRecord } from "../domain/types";
import { buildPhoneInstallDashboard, preparePhoneInstallUpdate } from "../install/phoneInstall";
import {
  PHONE_INSTALL_BACKUP_FILENAME,
  assertPhoneInstallBackup,
  buildFieldAppMigrationBackup,
  createBackupCopyDay,
  normalizePhoneInstallBackup,
} from "../storage/backupImportExport";
import type { ZoneQuantityComparison } from "../ui/uiScreens";
import { APP_VERSION, SETTINGS_VERSION_LABEL, TOPBAR_VERSION_LABEL } from "./version";
import { createAppRuntime } from "./appRuntime";
import { FormDrafts } from "./formDrafts";
import { fieldIcon, renderRouteSheet, type RouteSheetState } from "./fieldView";
import { getZoneKind, type ZoneKind } from "../domain/zoneIdentity";

const BASE_ZONE_IDS = ["miju", "hils"] as const;
const MAX_REASONABLE_EXPECTED = 1200;
const MAX_REASONABLE_ZONE = 800;
const EVENT_TYPES = [
  "식사/휴식",
  "업체 방문",
  "반품 선수거",
  "전체 반품 상차",
  "고객/관리실 대응",
  "엘리베이터/시설 문제",
  "차량 이동/적재 정리",
  "대기",
  "기타",
] as const;
const runtime = createAppRuntime(APP_VERSION);
const { store, platform } = runtime;

let currentDay: DayRecord | null = null;
let historyDays: DayRecord[] = [];
let lastImportFeedback: ImportFeedback | null = null;
let activeTab: AppTab = "work";
let activeStatsTab: StatsTab = "week";
let statsWeekOffset = 0;
let statsMonthOffset = 0;
let statsSelectedDate = todayKey();
let activeCorrectionTargetId = "";
let activeLogEditEventId = "";
let pendingQuantityRisk: PendingQuantityRisk | null = null;
const formDrafts = new FormDrafts();
let renderedFormKey = "";
let discardDraftOnRender = false;
let actionInProgress = false;
let currentAction = "";
let actionError = "";
let historyReadErrors: string[] = [];
let observedToday = todayKey();
let historicalEditing = false;
let rolloverChoice = false;
let routeSheet: RouteSheetState | null = null;

type AppTab = "work" | "log" | "report" | "stats" | "backup";
type StatsTab = "week" | "month" | "date";

interface ImportFeedback {
  title?: string;
  fileName: string;
  recognizedDays: number;
  importedCount: number;
  skippedCount: number;
  importedDates: string[];
  skippedDates: string[];
  message: string;
  snapshotCreated: boolean;
  backupExported: boolean;
  activeDate?: string;
}

interface PendingQuantityRisk {
  zoneId: string;
  zoneName: string;
  entered: number;
  saveValue: number;
  previousDelivered: number;
  expectedTotal?: number;
  warning: string;
  adjustedValue?: number;
  mijuInput?: MijuInputParts;
}

type LogEditKind =
  | "depart"
  | "arrive"
  | "day_close"
  | "zone_start"
  | "delivery_start"
  | "sorting_start"
  | "sorting_end"
  | "missing_sorting_end"
  | "zone_end"
  | "incident"
  | "helper";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Missing #app root");
const root: HTMLDivElement = appRoot;

let appReady = false;
void boot();
root.addEventListener("input", () => formDrafts.capture(root, renderedFormKey));
root.addEventListener("change", () => formDrafts.capture(root, renderedFormKey));
window.addEventListener("pagehide", () => formDrafts.capture(root, renderedFormKey));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkBackgroundWork();
});
window.addEventListener("focus", () => void checkBackgroundWork());
window.setInterval(() => { if (document.visibilityState === "visible") void checkBackgroundWork(); }, 15000);
if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener("appStateChange", state => {
    if (state.isActive) void checkBackgroundWork();
  }).catch(showBackgroundError);
}

async function boot(): Promise<void> {
  try {
    await platform.initialize();
    await loadToday();
    try { await persistAutomaticCleanup(); } catch (error) { showBackgroundError(error); }
    render();
    appReady = true;
  } catch (error) {
    renderLoadRecovery(error);
  }
}

function renderLoadRecovery(error: unknown): void {
  root.innerHTML = `<main class="shell"><h1>기록을 불러오지 못했습니다</h1><p>기존 자료는 초기화하지 않았습니다.</p><p role="alert">${escapeHtml(error instanceof Error ? error.message : "저장소 연결을 확인하세요.")}</p><button id="retry-load">다시 불러오기</button><button id="recover-export">현재 자료 보관</button><button id="recover-import">백업으로 복구</button></main>`;
  root.querySelector("#retry-load")?.addEventListener("click", () => void boot());
  for (const id of ["recover-export", "recover-import"]) {
    root.querySelector<HTMLButtonElement>("#" + id)?.addEventListener("click", async () => {
      if (actionInProgress) return;
      actionInProgress = true;
      root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = true; });
      try {
        if (id === "recover-export") {
          const result = await platform.exportJson(await store.createBackup({ kind: "all" }), buildBackupFilename("recovery-raw"));
          renderLoadRecovery(new Error(result.status === "saved" ? "현재 자료를 파일로 보관했습니다." : "파일 저장을 취소했습니다. 기존 자료는 유지됩니다."));
        } else {
          const file = await platform.pickTextFile();
          if (!file) { renderLoadRecovery(error); return; }
          const parsed = readJsonText(file.text);
          assertPhoneInstallBackup(parsed);
          const backup = normalizePhoneInstallBackup(parsed);
          if (!confirm(`${backup.days.length}일의 백업으로 해당 날짜를 복구할까요? 다른 날짜는 유지하고 복구 전 자료는 내부에 보관합니다.`)) { renderLoadRecovery(error); return; }
          await platform.saveJsonSnapshot(await store.createBackup({ kind: "all" }), buildBackupFilename("recovery-before"));
          await store.importBackup(backup, { mode: "overwrite" });
          backup.days.forEach((day) => formDrafts.clearDate(day.date));
          discardDraftOnRender = true;
          await boot();
        }
      } catch (failure) { renderLoadRecovery(failure); }
      finally { actionInProgress = false; }
    });
  }
}

async function loadToday(): Promise<void> {
  const date = todayKey();
  observedToday = date;
  historicalEditing = false;
  rolloverChoice = false;
  currentDay = await store.getDay(date);
  if (!currentDay) {
    currentDay = createEmptyDay(date);
    await store.saveDay(currentDay);
  }
  await refreshHistory();
}

function render(): void {
  if (!currentDay) return;
  if (!discardDraftOnRender) formDrafts.capture(root, renderedFormKey);
  discardDraftOnRender = false;

  const calculation = calculateDay(currentDay);
  const report = buildDailyReport(currentDay, calculation, { title: "Delivery Master Install Report" });
  const pendingZone = currentDay.zones.find((zone) => hasMissingCleanupFinish(currentDay!, zone.id));
  const history = historyDays.length > 0 ? historyDays : [currentDay];

  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div>          <h1>${fieldIcon("work")}배송마스터 <span class="app-version">${TOPBAR_VERSION_LABEL}</span></h1>
        </div>
        <button class="icon-btn" data-action="refresh" title="새로고침" aria-label="새로고침">${fieldIcon("refresh")}</button>
      </header>

      <section class="status-band">
        <div><span class="label">날짜</span><strong>${currentDay.date}</strong></div>
        <div><span class="label">상태</span><strong>${statusLabel(currentDay.status)}</strong></div>
        <div><span class="label">기록</span><strong>${currentDay.timeline.length}</strong></div>
      </section>

      ${renderTabs()}
      ${actionError ? `<aside class="warning" role="alert">${escapeHtml(actionError)}</aside>` : ""}
      ${historyReadErrors.length ? `<aside class="warning" role="alert">${escapeHtml(historyReadErrors.join(", "))} 기록을 읽지 못했습니다. 해당 자료는 삭제하지 않았습니다.</aside>` : ""}
      ${rolloverChoice ? `<aside class="warning"><strong>${escapeHtml(currentDay.date)} 기록이 열려 있습니다.</strong><div class="field-actions"><button data-action="continue-previous-day">이전 업무 계속</button><button data-action="start-today">오늘 업무 열기</button></div></aside>` : ""}
      ${calculation.warnings.filter((warning) => warning.code !== "missing_calculation_event").length ? `<aside class="warning" role="status">${calculation.warnings.filter((warning) => warning.code !== "missing_calculation_event").map((warning) => escapeHtml(warning.message)).join("<br>")}</aside>` : ""}
      ${renderActiveTabContent(calculation, report, history, pendingZone)}
    </main>
    ${routeSheet ? renderRouteSheet(routeSheet, getOrderedZones().filter(z => !hasZoneStarted(z.id)), !!routeSheet.zoneId && !hasZoneStarted(routeSheet.zoneId), !!getOrderedZones().find(z => hasZoneStarted(z.id) && !hasZoneEnded(z.id)), calculation.totals.deliveredCount) : ""}
  `;

  renderedFormKey = [currentDay.date, activeTab, activeLogEditEventId, getCurrentWorkZone()?.id ?? "closed"].join(":");
  if (formDrafts.restore(root, renderedFormKey)) {
    const notice = document.createElement("p");
    notice.className = "draft-notice";
    notice.setAttribute("role", "status");
    notice.textContent = "입력 복원됨 · 저장 전";
    root.querySelector(".tabbar")?.after(notice);
  }
  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => void runButtonAction(button));
  });
  bindNumericLimits();
  bindStatsDateInput();
  updateQuantityPreview();
  root.querySelectorAll<HTMLInputElement>(".quantity-input input,.building-grid input").forEach(input => input.addEventListener("input", updateQuantityPreview));
  bindRouteSheet();
}

async function runButtonAction(button: HTMLButtonElement): Promise<void> {
  if (button.disabled || actionInProgress) return;
  if (todayKey() !== observedToday) {
    try { await checkDateBoundary(); } catch (error) { showBackgroundError(error); }
    return;
  }
  if (rolloverChoice && !["continue-previous-day", "start-today", "set-tab", "open-log-edit", "close-log-edit", "save-log-edit"].includes(button.dataset.action ?? "")) return;
  const before = currentDay ? structuredClone(currentDay) : null;
  const beforeEditId = activeLogEditEventId;
  const beforeRouteSheet = routeSheet ? { ...routeSheet, name: root.querySelector<HTMLInputElement>("#route-name")?.value ?? routeSheet.name } : null;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
  const disabled = buttons.map((element) => element.disabled);
  actionInProgress = true;
  currentAction = button.dataset.action ?? "";
  actionError = "";
  buttons.forEach((element) => { element.disabled = true; });
  try {
    if (["sorting-end", "zone-end"].includes(currentAction) && await persistAutomaticCleanup()) {
      render();
      return;
    }
    await handleAction(button);
  } catch (error) {
    console.error("Action failed", error);
    activeLogEditEventId = beforeEditId;
    routeSheet = beforeRouteSheet;
    if (before) {
      try { currentDay = await store.getDay(before.date) ?? before; } catch { currentDay = before; }
    }
    actionError = error instanceof Error ? error.message : "작업을 완료하지 못했습니다. 입력 내용을 확인하고 다시 저장하세요.";
    render();
    toast(actionError);
  } finally {
    actionInProgress = false;
    currentAction = "";
    buttons.forEach((element, index) => { element.disabled = disabled[index]!; });
  }
}

function discardFormDraft(): void {
  formDrafts.clear(renderedFormKey);
  discardDraftOnRender = true;
}

function showBackgroundError(error: unknown): void {
  actionError = error instanceof Error ? error.message : "기록을 다시 확인하지 못했습니다. 기존 자료는 보존됩니다.";
  if (currentDay) render();
}

async function persistAutomaticCleanup(): Promise<boolean> {
  if (!currentDay || historicalEditing || rolloverChoice || activeLogEditEventId) return false;
  const result = applyAutomaticCleanup(currentDay, nowIso());
  if (result.correctedZoneIds.length === 0) return false;
  formDrafts.capture(root, renderedFormKey);
  await store.saveDay(result.dayRecord);
  currentDay = result.dayRecord;
  actionError = "";
  await refreshHistory();
  return true;
}

async function checkBackgroundWork(): Promise<void> {
  if (!appReady || actionInProgress || activeLogEditEventId || routeSheet) return;
  try {
    await checkDateBoundary();
    if (actionInProgress || rolloverChoice) return;
    actionInProgress = true;
    try { if (await persistAutomaticCleanup()) render(); }
    finally { actionInProgress = false; }
  } catch (error) { showBackgroundError(error); }
}

async function checkDateBoundary(): Promise<boolean> {
  const today = todayKey();
  if (!currentDay || actionInProgress || today === observedToday) return false;
  observedToday = today;
  if (historicalEditing) return false;
  if ((currentDay.timeline.some((event) => event.type === "depart_jinjeop") && !hasEvent("day_close")) || activeLogEditEventId) {
    rolloverChoice = true;
    render();
  } else {
    await loadToday();
    activeTab = "work";
    render();
  }
  return true;
}
function renderTabs(): string {
  const tabs: Array<{ key: AppTab; label: string }> = [
    { key: "work", label: "업무" },
    { key: "log", label: "로그" },
    { key: "report", label: "리포트" },
    { key: "stats", label: "통계" },
    { key: "backup", label: "백업설정" },
  ];

  return `
    <nav class="tabbar" aria-label="화면 이동">
      ${tabs.map((tab) => `
        <button class="${activeTab === tab.key ? "active" : ""}" data-action="set-tab" data-tab="${tab.key}">${fieldIcon(tab.key)}<span>${tab.label}</span></button>
      `).join("")}
    </nav>
  `;
}

function renderActiveTabContent(
  calculation: DayCalculation,
  report: ReportResult,
  history: DayRecord[],
  pendingZone: ZoneRecord | undefined,
): string {
  switch (activeTab) {
    case "log":
      return renderLogTab(calculation);
    case "report":
      return renderReportTab(report);
    case "stats":
      return renderStatsTab(history);
    case "backup":
      return renderBackupSettingsTab();
    case "work":
    default:
      return renderWorkTab(calculation, pendingZone);
  }
}

function renderWorkTab(calculation: DayCalculation, pendingZone: ZoneRecord | undefined): string {
  const canPlan = hasEvent("arrive_cheongnyangni") && !hasEvent("day_close") && !isUnpaidHelperDay(currentDay!);
  const next = getOrderedZones().find(z => !hasZoneStarted(z.id));
  return `
    ${renderCurrentStep()}
    ${pendingQuantityRisk ? renderQuantityRiskPanel(pendingQuantityRisk) : ""}
    ${pendingZone ? hasZoneEnded(pendingZone.id) ? renderCleanupCorrectionPanel(pendingZone.id) : `<details class="work-details"><summary>정리 시간 보정</summary>${renderCleanupCorrectionPanel(pendingZone.id)}</details>` : ""}
    ${canPlan ? `<div class="route-next"><button class="next-zone" data-action="open-route-plans">${fieldIcon("route")}<span><small>다음 구역</small>${next ? escapeHtml(next.name) : "예정 없음"}</span>${fieldIcon("next")}</button><button class="symbol-button add-zone" data-action="open-route-editor" title="구역 추가" aria-label="구역 추가">${fieldIcon("plus")}</button></div>` : ""}
    ${renderEventPanel() ? `<details class="work-details"><summary>이벤트 · 도우미</summary>${renderEventPanel()}</details>` : ""}
    <details class="work-details"><summary>오늘 요약 · ${calculation.totals.deliveredCount}개</summary><section class="panel"><div class="summary"><span>배송 ${formatMin(calculation.totals.deliveryMinutes)}</span><span>효율 ${formatEff(calculation.totals.efficiencyPerHour)}</span></div></section></details>
    <details class="work-details"><summary>구역 현황</summary><section class="panel">${renderZoneCards()}</section></details>
  `;
}

function renderLogTab(calculation: DayCalculation): string {
  return `
    <section class="panel">
      <h2>로그</h2>
      <div class="timeline-log">
        ${buildLogEntries(calculation).map((entry) => renderLogEntry(entry)).join("")}
      </div>
    </section>
  `;
}

function renderReportTab(report: ReportResult): string {
  return `
    <section class="panel">
      <h2>리포트</h2>
      <pre class="report">${escapeHtml(report.text)}</pre>
      <div class="row-actions">
        <button data-action="copy-report">리포트 복사</button>
      </div>
    </section>
  `;
}

function renderStatsTab(history: DayRecord[]): string {
  return `
    <section class="panel">
      <h2>통계</h2>
      ${renderStatsSubtabs()}
      ${activeStatsTab === "week" ? renderWeeklyStats(history) : ""}
      ${activeStatsTab === "month" ? renderMonthlyStats(history) : ""}
      ${activeStatsTab === "date" ? renderDateStats(history) : ""}
    </section>
  `;
}

function renderStatsSubtabs(): string {
  const tabs: Array<{ key: StatsTab; label: string }> = [
    { key: "week", label: "주간" },
    { key: "month", label: "월간" },
    { key: "date", label: "날짜조회" },
  ];

  return `
    <div class="stats-subtabs">
      ${tabs.map((tab) => `
        <button class="${activeStatsTab === tab.key ? "active" : ""}" data-action="set-stats-tab" data-stats-tab="${tab.key}">${tab.label}</button>
      `).join("")}
    </div>
  `;
}

function renderWeeklyStats(history: DayRecord[]): string {
  const range = getWeekRange(statsWeekOffset);
  const days = getHistoryInRange(history, range.start, range.end);
  const stats = buildPeriodStats(days);
  const title = statsWeekOffset === 0 ? "이번 주 비율" : `${formatDateRange(range.start, range.end)} 비율`;

  return `
    <div class="period-nav">
      <button class="secondary" data-action="stats-week-prev" aria-label="이전 주" title="이전 주">&#8592;</button>
      <strong>${formatDateRange(range.start, range.end)}</strong>
      <button class="secondary" data-action="stats-week-next" aria-label="다음 주" title="다음 주" ${statsWeekOffset >= 0 ? "disabled" : ""}>&#8594;</button>
    </div>
    ${renderQuantityComparison(title, stats.quantityComparison)}
    ${renderPeriodSummary(stats)}
    ${renderZonePeriodCards(stats)}
    ${renderWeekDayCards(history, range.start, range.end)}
  `;
}

function renderMonthlyStats(history: DayRecord[]): string {
  const range = getMonthRange(statsMonthOffset);
  const days = getHistoryInRange(history, range.start, range.end);
  const stats = buildPeriodStats(days);
  const title = statsMonthOffset === 0 ? "이번 달 비율" : `${formatMonthTitle(range.start)} 비율`;

  return `
    <div class="period-nav">
      <button class="secondary" data-action="stats-month-prev" aria-label="이전 달" title="이전 달">&#8592;</button>
      <strong>${formatMonthTitle(range.start)}</strong>
      <button class="secondary" data-action="stats-month-next" aria-label="다음 달" title="다음 달" ${statsMonthOffset >= 0 ? "disabled" : ""}>&#8594;</button>
    </div>
    ${renderQuantityComparison(title, stats.quantityComparison)}
    ${renderPeriodSummary(stats)}
    ${renderMonthlyVariation(stats)}
    ${renderZonePeriodCards(stats)}
    ${renderWeekdayAverage(days)}
    ${renderMonthDayCards(history, range.start, range.end)}
  `;
}

function renderDateStats(history: DayRecord[]): string {
  const selected = history.find((dayRecord) => dayRecord.date === statsSelectedDate);
  const calculation = selected ? calculateDay(selected) : undefined;
  const report = selected && calculation
    ? buildDailyReport(selected, calculation, { title: "Delivery Master Install Report" })
    : undefined;

  return `
    <div class="date-search-row">
      <label>날짜 선택<input id="stats-date-input" type="date" value="${statsSelectedDate}"></label>
      <button class="secondary" data-action="stats-date-today">오늘</button>
    </div>
    ${selected && calculation && report
      ? `
        <div class="date-result">
          <h3>${formatKoreanDateLabel(selected.date)}</h3>
          <div class="summary">
            <span>총 ${calculation.totals.totalCount}개</span>
            <span>배송 ${formatMin(calculation.totals.deliveryMinutes)}</span>
            <span>효율 ${formatEff(calculation.totals.efficiencyPerHour)}</span>
          </div>
          <h3>로그</h3>
          <div class="timeline-log compact">
            ${buildLogEntriesForDay(selected, calculation).map((entry) => `
              <article class="timeline-entry ${entry.kind}">
                <div>
                  <strong>${entry.title}</strong>
                  <time>${entry.time}</time>
                  ${entry.detail ? `<p>${entry.detail}</p>` : ""}
                </div>
              </article>
            `).join("")}
          </div>
          <h3>리포트</h3>
          <pre class="report">${escapeHtml(report.text)}</pre>
        </div>
      `
      : renderMissingDateState(statsSelectedDate)}
  `;
}

interface PeriodStats {
  totalQuantity: number;
  expectedQuantity?: number;
  scanMiss?: number;
  workDays: number;
  totalElapsedMinutes?: number;
  deliveryMinutes?: number;
  averageEfficiencyPerHour?: number;
  dailyAverage?: number;
  maxDay?: PeriodDaySummary;
  minDay?: PeriodDaySummary;
  quantityComparison: ZoneQuantityComparison;
  zoneSummaries: ZonePeriodSummary[];
}

interface PeriodDaySummary {
  date: string;
  totalQuantity: number;
  efficiencyPerHour?: number;
}

interface ZonePeriodSummary {
  label: string;
  quantity: number;
  deliveryMinutes?: number;
  efficiencyPerHour?: number;
}

function buildPeriodStats(days: DayRecord[]): PeriodStats {
  const pairs = days.map((dayRecord) => ({ dayRecord, calculation: calculateDay(dayRecord) }));
  const deliveryPairs = pairs.filter((pair) => pair.calculation.totals.totalCount > 0);
  const totalQuantity = deliveryPairs.reduce((sum, pair) => sum + pair.calculation.totals.deliveredCount, 0);
  const expectedValues = deliveryPairs
    .map((pair) => getExpectedTotalForDay(pair.dayRecord))
    .filter((value): value is number => typeof value === "number");
  const expectedQuantity = expectedValues.length > 0
    ? expectedValues.reduce((sum, value) => sum + value, 0)
    : undefined;
  const efficiencyCount = deliveryPairs.reduce((sum, pair) => sum + (pair.calculation.totals.efficiencyCount ?? pair.calculation.totals.deliveredCount), 0);
  const efficiencyMinutes = sumDefined(deliveryPairs.map((pair) => pair.calculation.totals.deliveryMinutes));
  const allEfficienciesKnown = deliveryPairs.every((pair) => pair.calculation.totals.efficiencyPerHour !== undefined);
  const daySummaries = deliveryPairs.map((pair) => ({
    date: pair.dayRecord.date,
    totalQuantity: pair.calculation.totals.deliveredCount,
    efficiencyPerHour: pair.calculation.totals.efficiencyPerHour,
  }));

  return {
    totalQuantity,
    expectedQuantity,
    scanMiss: expectedQuantity === undefined ? undefined : totalQuantity - expectedQuantity,
    workDays: deliveryPairs.length,
    totalElapsedMinutes: sumDefined(deliveryPairs.map((pair) => pair.calculation.totals.totalElapsedMinutes)),
    deliveryMinutes: sumDefined(deliveryPairs.map((pair) => pair.calculation.totals.deliveryMinutes)),
    averageEfficiencyPerHour: allEfficienciesKnown && efficiencyMinutes !== undefined && efficiencyMinutes >= 1
      ? efficiencyCount / (efficiencyMinutes / 60)
      : undefined,
    dailyAverage: deliveryPairs.length > 0 ? totalQuantity / deliveryPairs.length : undefined,
    maxDay: daySummaries.length > 0
      ? [...daySummaries].sort((left, right) => right.totalQuantity - left.totalQuantity)[0]
      : undefined,
    minDay: daySummaries.length > 0
      ? [...daySummaries].sort((left, right) => left.totalQuantity - right.totalQuantity)[0]
      : undefined,
    quantityComparison: buildQuantityComparisonFromPairs(pairs),
    zoneSummaries: buildZonePeriodSummaries(pairs),
  };
}

function buildQuantityComparisonFromPairs(
  pairs: Array<{ dayRecord: DayRecord; calculation: DayCalculation }>,
): ZoneQuantityComparison {
  const quantities: Record<ZoneQuantityComparison["buckets"][number]["key"], number> = {
    miju: 0,
    hils: 0,
    alternate: 0,
  };

  for (const pair of pairs) {
    for (const zone of pair.calculation.zones) {
      quantities[getZoneBucket(pair.dayRecord, zone.zoneId)] += zone.counts.delivered;
    }
  }

  const totalQuantity = quantities.miju + quantities.hils + quantities.alternate;
  const buckets = (["miju", "hils", "alternate"] as const).map((key) => ({
    key,
    label: formatBucketLabel(key),
    quantity: quantities[key],
    ratioPart: quantities[key],
    percent: totalQuantity > 0 ? Math.round((quantities[key] / totalQuantity) * 1000) / 10 : 0,
  }));

  return {
    basis: "deliveredCount",
    totalQuantity,
    ratioLabel: totalQuantity > 0
      ? buckets.map((bucket) => `${formatBucketShortLabel(bucket.key)}${Math.round(bucket.percent)}`).join(":")
      : "데이터 없음",
    buckets,
  };
}

function buildZonePeriodSummaries(
  pairs: Array<{ dayRecord: DayRecord; calculation: DayCalculation }>,
): ZonePeriodSummary[] {
  const zones = new Map<string, { label: string; quantity: number; deliveryMinutes: number; efficiencyCount: number; reliable: boolean }>();

  for (const pair of pairs) {
    for (const zone of pair.calculation.zones) {
      const label = getZoneNameFromDay(pair.dayRecord, zone.zoneId);
      const current = zones.get(label) ?? { label, quantity: 0, deliveryMinutes: 0, efficiencyCount: 0, reliable: true };
      current.quantity += zone.counts.delivered;
      current.deliveryMinutes += zone.deliveryMinutes ?? 0;
      current.efficiencyCount += zone.efficiencyCount ?? zone.counts.delivered;
      if (zone.counts.delivered > 0 && zone.efficiencyPerHour === undefined) current.reliable = false;
      zones.set(label, current);
    }
  }

  return [...zones.values()]
    .filter((zone) => zone.quantity > 0 || zone.deliveryMinutes > 0)
    .map((zone) => ({
      label: zone.label,
      quantity: zone.quantity,
      deliveryMinutes: zone.deliveryMinutes > 0 ? zone.deliveryMinutes : undefined,
      efficiencyPerHour: zone.reliable && zone.deliveryMinutes >= 1
        ? zone.efficiencyCount / (zone.deliveryMinutes / 60)
        : undefined,
    }))
    .sort((left, right) => right.quantity - left.quantity);
}

function renderPeriodSummary(stats: PeriodStats): string {
  return `
    <div class="stats-grid">
      <article><span>총 배송</span><strong>${stats.totalQuantity}개</strong></article>
      <article><span>근무일</span><strong>${stats.workDays}일</strong></article>
      <article><span>평균 효율</span><strong>${formatEff(stats.averageEfficiencyPerHour)}</strong></article>
      <article><span>스캔차</span><strong>${formatScanMiss(stats.scanMiss)}</strong></article>
      <article><span>배송 시간</span><strong>${formatMin(stats.deliveryMinutes)}</strong></article>
      <article><span>일 평균</span><strong>${stats.dailyAverage === undefined ? "-" : `${Math.round(stats.dailyAverage)}개`}</strong></article>
    </div>
  `;
}

function renderMonthlyVariation(stats: PeriodStats): string {
  return `
    <div class="stats-grid compact-stats">
      <article><span>최고 물량</span><strong>${stats.maxDay ? `${formatShortDate(stats.maxDay.date)} · ${stats.maxDay.totalQuantity}개` : "-"}</strong></article>
      <article><span>최저 물량</span><strong>${stats.minDay ? `${formatShortDate(stats.minDay.date)} · ${stats.minDay.totalQuantity}개` : "-"}</strong></article>
    </div>
  `;
}

function renderZonePeriodCards(stats: PeriodStats): string {
  if (stats.zoneSummaries.length === 0) return `<p class="empty-state">구역별 데이터가 없습니다.</p>`;

  return `
    <div class="period-zone-list">
      ${stats.zoneSummaries.map((zone) => `
        <article>
          <strong>${zone.label}</strong>
          <p>${zone.quantity}개 · 배송 ${formatMin(zone.deliveryMinutes)} · 효율 ${formatEff(zone.efficiencyPerHour)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWeekdayAverage(days: DayRecord[]): string {
  const buckets = ["일", "월", "화", "수", "목", "금", "토"].map((label) => ({ label, total: 0, count: 0 }));
  for (const dayRecord of days) {
    const calculation = calculateDay(dayRecord);
    if (calculation.totals.deliveredCount <= 0) continue;
    const day = parseDateKey(dayRecord.date).getDay();
    buckets[day].total += calculation.totals.deliveredCount;
    buckets[day].count += 1;
  }

  return `
    <div class="stats-grid weekday-grid">
      ${buckets.map((bucket) => `
        <article>
          <span>${bucket.label}</span>
          <strong>${bucket.count > 0 ? `${Math.round(bucket.total / bucket.count)}개` : "-"}</strong>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWeekDayCards(history: DayRecord[], start: Date, end: Date): string {
  const dates = getDateKeysInRange(start, end);
  return `
    <div class="period-day-list">
      ${dates.map((date) => renderDayStatsCard(date, history.find((dayRecord) => dayRecord.date === date))).join("")}
    </div>
  `;
}

function renderMonthDayCards(history: DayRecord[], start: Date, end: Date): string {
  const today = todayKey();
  const dates = getDateKeysInRange(start, end).filter((date) =>
    date <= today || history.some((dayRecord) => dayRecord.date === date),
  );
  if (dates.length === 0) return `<p class="empty-state">이 달에 표시할 날짜가 없습니다.</p>`;

  return `
    <div class="period-day-list">
      ${dates.map((date) => renderDayStatsCard(date, history.find((dayRecord) => dayRecord.date === date))).join("")}
    </div>
  `;
}

function renderDayStatsCard(date: string, dayRecord?: DayRecord): string {
  if (!dayRecord) {
    const detail = isVirtualRegularHoliday(date) ? "정기휴무" : "데이터 없음";
    return `
      <article>
        <strong>${formatShortDate(date)}</strong>
        <span>${detail}</span>
      </article>
    `;
  }
  const calculation = calculateDay(dayRecord);
  const total = calculation.totals.deliveredCount;
  const detail = total > 0
    ? `${total}개 · ${formatEff(calculation.totals.efficiencyPerHour)}`
    : statusLabel(dayRecord.status);

  return `
    <article>
      <strong>${formatShortDate(date)}</strong>
      <span>${detail}</span>
    </article>
  `;
}

function renderMissingDateState(date: string): string {
  if (!isVirtualRegularHoliday(date)) return `<p class="empty-state">${date} 기록이 없습니다.</p>`;

  return `
    <div class="holiday-state">
      <h3>${formatKoreanDateLabel(date)}</h3>
      <strong>정기휴무</strong>
      <p>저장된 기록은 없고, 과거 일요일/월요일 빈 날짜라 화면에서만 휴무로 표시합니다. 백업 JSON에는 휴무 기록을 새로 만들지 않습니다.</p>
    </div>
  `;
}

function renderBackupSettingsTab(): string {
  const resetLabel = currentDay?.date === todayKey() ? "오늘 초기화" : "선택 날짜 초기화";
  return `
    <section class="panel">
      <h2>백업설정</h2>
      <p class="hint">데이터 보호, 복구, 초기화, 버전 확인을 한곳에 모았습니다.</p>
      ${renderImportFeedback()}
      <div class="backup-list">
        <article>
          <strong>앱 버전</strong>
          <p>${SETTINGS_VERSION_LABEL}</p>
        </article>
        <article>
          <strong>화면 정보</strong>
          <p>${getViewportInfoLabel()}</p>
        </article>
        <article>
          <strong>자동저장</strong>
          <p>입력 후 IndexedDB에 저장됩니다. 위험 작업 전에는 별도 백업을 만듭니다.</p>
        </article>
      </div>
      <div class="row-actions">
        <button data-action="snapshot">백업 내보내기</button>
        <button data-action="import-field-backup">현장앱 백업 가져오기</button>
        <button data-action="import-phone-backup">개발앱 백업 복구</button>
        <button class="danger" data-action="reset-confirm">${resetLabel}</button>
      </div>
      <details class="aux-correction-panel">
        <summary>기존 선택형 기록 정정 열기</summary>
        <p class="hint">로그 직접 수정이 기본입니다. 이 화면은 지난 날짜 불러오기나 보조 전환 작업이 필요할 때만 엽니다.</p>
        ${renderRecordCorrectionPanel()}
      </details>
    </section>
  `;
}

function renderRecordCorrectionPanel(): string {
  if (!currentDay) return "";
  const correctionDates = buildCorrectionDateOptions();
  const completed = getOrderedZones()
    .filter((zone) => hasZoneEnded(zone.id))
    .map((zone) => {
      const end = latestZoneEvent(zone.id, "zone_end");
      const payload = end?.payload as Record<string, unknown> | undefined;
      const delivered = typeof payload?.delivered === "number" ? payload.delivered : 0;
      return { zone, delivered, end };
    })
    .filter((item) => item.end && item.delivered > 0);
  const helpers = currentDay.helpers
    .map((helper) => {
      const event = currentDay?.timeline.find((candidate) =>
        candidate.type === "helper_add" && helper.linkedEventIds.includes(candidate.id)
      );
      const payload = event?.payload as Record<string, unknown> | undefined;
      const kind = normalizeReceivedHelperKind(helper.kind ?? payload?.helperKind);
      const quantity = typeof helper.quantity === "number"
        ? helper.quantity
        : typeof payload?.quantity === "number"
          ? payload.quantity
          : 0;
      return { helper, event, kind, quantity };
    })
    .filter((item) => item.event && item.kind && (item.quantity > 0 || hasHelperSourceZone(item.event)));
  const targets = [
    ...completed.map(({ zone, delivered }) => ({
      id: `zone:${zone.id}`,
      label: `${zone.order}구역 ${zone.name} · ${delivered}개`,
      type: "zone" as const,
      zone,
      delivered,
    })),
    ...helpers.map(({ helper, kind, quantity }) => ({
      id: `helper:${helper.id}`,
      label: `${helper.name} · ${quantity > 0 ? `${quantity}개` : "수량 미기록"} · ${kind === "free_received" ? "무료" : "유료"}`,
      type: "helper" as const,
      helper,
      kind,
      quantity,
    })),
  ];
  if (!targets.some((target) => target.id === activeCorrectionTargetId)) {
    activeCorrectionTargetId = targets[0]?.id ?? "";
  }
  const selectedTarget = targets.find((target) => target.id === activeCorrectionTargetId);

  return `
    <section class="record-correction">
      <h3>기록 정정</h3>
      <p class="hint">로그 직접 수정이 기본이고, 이 화면은 지난 날짜 선택이나 보조 전환 작업이 필요할 때만 사용합니다.</p>
      <label>정정 날짜
        <select id="correction-date">
          ${correctionDates.map((date) => `
            <option value="${escapeAttribute(date)}"${date === currentDay!.date ? " selected" : ""}>${escapeHtml(date)}${date === todayKey() ? " · 오늘" : ""}</option>
          `).join("")}
        </select>
      </label>
      <div class="row-actions">
        <button data-action="load-correction-date">선택 날짜 불러오기</button>
        <button data-action="load-today">오늘로 돌아가기</button>
      </div>
      <p class="hint">현재 정정 날짜: ${escapeHtml(currentDay.date)}. 지난 날짜를 불러와 고쳐도 해당 날짜 기록만 저장됩니다.</p>
      ${completed.length === 0 && helpers.length === 0 ? `<p class="empty-state">정정할 기록이 없습니다.</p>` : ""}
      ${targets.length === 0 ? "" : `
        <label>수정할 기록
          <select id="correction-target">
            ${targets.map((target) => `
              <option value="${escapeAttribute(target.id)}"${target.id === activeCorrectionTargetId ? " selected" : ""}>${escapeHtml(target.label)}</option>
            `).join("")}
          </select>
        </label>
        <button data-action="select-correction-target">기록 불러오기</button>
        ${selectedTarget?.type === "zone" ? renderZoneCorrectionForm(selectedTarget.zone, selectedTarget.delivered) : ""}
        ${selectedTarget?.type === "helper" ? renderHelperCorrectionForm(selectedTarget.helper) : ""}
      `}
      ${renderMissingHelperCorrectionForm()}
    </section>
  `;
}

function buildCorrectionDateOptions(): string[] {
  const dates = new Set<string>();
  if (currentDay) dates.add(currentDay.date);
  historyDays.forEach((day) => dates.add(day.date));
  dates.add(todayKey());
  return [...dates].sort((a, b) => b.localeCompare(a));
}

function renderZoneCorrectionForm(zone: ZoneRecord, delivered: number): string {
  const start = latestZoneEvent(zone.id, "zone_start");
  const end = latestZoneEvent(zone.id, "zone_end");
  const sortingStart = latestZoneEvent(zone.id, "sorting_start");
  const sortingEnd = latestZoneEvent(zone.id, "sorting_end");
  const bucket = getZoneBucket(currentDay!, zone.id);
  const currentKind = bucket === "miju" ? "miju" : bucket === "hils" ? "hils" : "alt";
  const customName = currentKind === "alt" ? zone.name : "";
  const previousDelivered = getPreviousZoneDeliveredTotal(zone.id);
  const usesCumulativeDefault = previousDelivered > 0;
  const displayedDelivered = usesCumulativeDefault ? previousDelivered + delivered : delivered;
  return `
    <article class="correction-editor">
      <strong>${escapeHtml(zone.name)}</strong>
      <p>${delivered}개 · ${zone.order}구역 완료 기록</p>
      <label>기록 종류
        <select id="correction-zone-kind">
          <option value="miju"${currentKind === "miju" ? " selected" : ""}>구역 기록 · 미주</option>
          <option value="hils"${currentKind === "hils" ? " selected" : ""}>구역 기록 · 힐스테이트</option>
          <option value="alt"${currentKind === "alt" ? " selected" : ""}>구역 기록 · 대체배송/추가구역</option>
          <option value="free_received">도우미 배송 무료로 전환</option>
          <option value="paid_received">도우미 배송 유료로 전환</option>
        </select>
      </label>
      <label>구역 이름
        <input id="correction-zone-name" type="text" value="${escapeAttribute(customName || zone.name)}">
      </label>
      <label>수량 입력 방식
        <select id="correction-zone-quantity-mode">
          <option value="actual"${usesCumulativeDefault ? "" : " selected"}>이 구역 실제 수량</option>
          <option value="cumulative"${usesCumulativeDefault ? " selected" : ""}>누적 총합에서 이전 구역 자동 차감</option>
        </select>
      </label>
      <p class="hint">이전 구역 완료: ${previousDelivered}개. 누적 모드에서는 CJ 앱의 누적 총합을 넣으면 앱이 앞 구역을 빼서 저장합니다.</p>
      <label>수량
        <input id="correction-zone-delivered" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${displayedDelivered}">
      </label>
      <div class="edit-grid compact">
        <label>시작
          <input id="correction-zone-start" type="time" value="${formatIsoForTimeInput(start?.at)}">
        </label>
        <label>종료
          <input id="correction-zone-end" type="time" value="${formatIsoForTimeInput(end?.at)}">
        </label>
        <label>정리 시작
          <input id="correction-zone-sorting-start" type="time" value="${formatIsoForTimeInput(sortingStart?.at)}">
        </label>
        <label>정리 완료
          <input id="correction-zone-sorting-end" type="time" value="${formatIsoForTimeInput(sortingEnd?.at)}">
        </label>
        <label>실패
          <input id="correction-zone-failed" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="0">
        </label>
        <label>추가
          <input id="correction-zone-extra" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="0">
        </label>
      </div>
      <button data-action="save-zone-correction" data-zone="${escapeAttribute(zone.id)}">선택 기록 정정 반영</button>
    </article>
  `;
}

function renderMissingHelperCorrectionForm(): string {
  if (!currentDay) return "";
  const defaultAt = currentDay.timeline.find((event) => event.type === "day_close")?.at
    ?? currentDay.timeline.at(-1)?.at
    ?? nowIso();
  return `
    <article class="correction-editor">
      <strong>누락 도우미 배송 추가</strong>
      <p class="hint">잘못 전환됐거나 빠진 도우미 배송은 여기서 다시 추가합니다. 무료는 효율 제외, 유료는 효율 포함입니다.</p>
      <label>도우미 종류
        <select id="correction-helper-kind">
          <option value="free_received">도우미 배송 무료</option>
          <option value="paid_received">도우미 배송 유료</option>
        </select>
      </label>
      <label>수량
        <input id="correction-helper-quantity" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="">
      </label>
      <label>시각
        <input id="correction-helper-at" type="time" value="${formatIsoForTimeInput(defaultAt)}">
      </label>
      <label>메모
        <input id="correction-helper-note" type="text" value="기록 정정에서 추가">
      </label>
      <button data-action="add-correction-helper">누락 도우미 기록 추가</button>
    </article>
  `;
}

function renderHelperCorrectionForm(helper: HelperRecord): string {
  const event = currentDay?.timeline.find((candidate) =>
    candidate.type === "helper_add" && helper.linkedEventIds.includes(candidate.id)
  );
  const payload = event?.payload as Record<string, unknown> | undefined;
  const kind = normalizeReceivedHelperKind(helper.kind ?? payload?.helperKind) ?? "free_received";
  const quantity = typeof helper.quantity === "number"
    ? helper.quantity
    : typeof payload?.quantity === "number"
      ? payload.quantity
      : 0;
  return `
    <article class="correction-editor">
      <strong>${escapeHtml(helper.name)}</strong>
      <p>${quantity > 0 ? `${quantity}개` : "수량 미기록"} · ${hasHelperSourceZone(event) ? "구역 동행 · 총량 중복 제외" : kind === "free_received" ? "효율 제외" : "효율 포함"}</p>
      <label>도우미 종류
        <select data-helper-kind="${escapeAttribute(helper.id)}">
          <option value="free_received"${kind === "free_received" ? " selected" : ""}>도우미 배송 무료</option>
          <option value="paid_received"${kind === "paid_received" ? " selected" : ""}>도우미 배송 유료</option>
        </select>
      </label>
      <label>수량
        <input data-helper-quantity="${escapeAttribute(helper.id)}" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${quantity > 0 ? quantity : ""}">
      </label>
      <label>시각
        <input data-helper-at="${escapeAttribute(helper.id)}" type="time" value="${formatIsoForTimeInput(event?.at)}">
      </label>
      <button data-action="save-helper-correction" data-helper="${escapeAttribute(helper.id)}">도우미 기록 정정 반영</button>
      <label>구역 기록으로 바꾸기
        <select data-helper-zone-restore="${escapeAttribute(helper.id)}">
          <option value="alt">대체배송/추가구역</option>
          <option value="hils">힐스테이트</option>
          <option value="miju">미주</option>
        </select>
      </label>
      <button data-action="restore-helper-zone" data-helper="${escapeAttribute(helper.id)}">구역 기록으로 복구</button>
    </article>
  `;
}

function getViewportInfoLabel(): string {
  if (typeof window === "undefined") return "확인 불가";
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  return `${window.innerWidth}x${window.innerHeight} / DPR ${dpr}`;
}


interface LogViewEntry {
  eventId?: string;
  title: string;
  time: string;
  detail?: string;
  kind: "depart" | "arrive" | "zone" | "sorting" | "done" | "event";
  editable?: boolean;
  editKind?: LogEditKind;
}

function buildLogEntries(calculation: DayCalculation): LogViewEntry[] {
  if (!currentDay) return [];
  return buildLogEntriesForDay(currentDay, calculation);
}

function buildLogEntriesForDay(dayRecord: DayRecord, calculation: DayCalculation): LogViewEntry[] {
  const entries: LogViewEntry[] = [];
  const zoneCalcs = new Map(calculation.zones.map((zone) => [zone.zoneId, zone]));
  const orderedEvents = [...dayRecord.timeline].sort((a, b) => compareLogEventOrder(a, b, dayRecord));

  for (const event of orderedEvents) {
    const zoneName = event.zoneId ? getZoneNameFromDay(dayRecord, event.zoneId) : undefined;
    const zoneCalc = event.zoneId ? zoneCalcs.get(event.zoneId) : undefined;
    const payload = event.payload as Record<string, unknown> | undefined;
    const time = formatTime(event.at);
    const editKind = getLogEditKind(event);
    const baseEntry = {
      eventId: event.id,
      time,
      editable: Boolean(editKind),
      editKind,
    };

    if (event.type === "depart_jinjeop") {
      const total = typeof payload?.total === "number" ? `예상 수량: ${payload.total}개` : "예상 수량 없음";
      entries.push({ ...baseEntry, title: "진접 출발", detail: total, kind: "depart" });
    } else if (event.type === "arrive_cheongnyangni") {
      entries.push({ ...baseEntry, title: "청량리 도착", detail: `운전: ${formatMin(getDriveMinutesForDay(dayRecord))}`, kind: "arrive" });
    } else if (event.type === "zone_start") {
      const detail = getZoneKind(dayRecord.zones.find(z => z.id === event.zoneId)) === "miju" ? buildMijuStartDetailForDay(dayRecord, event.zoneId) : buildMovementDetail(zoneCalc);
      entries.push({ ...baseEntry, title: `${getZoneOrderLabelForDay(dayRecord, event.zoneId)} 시작 · ${zoneName}`, detail, kind: "zone" });
    } else if (event.type === "delivery_start") {
      const corrected = payload?.autoCorrected === true;
      entries.push({
        ...baseEntry,
        title: corrected ? "배송 시작 자동 보정" : "바로 배송 시작",
        detail: corrected
          ? `${zoneName ?? "구역"} · ${typeof payload?.correctionReason === "string" ? payload.correctionReason : "시작 누락 보정"}`
          : zoneName ? `${zoneName} 진행 중` : undefined,
        kind: "zone",
      });
    } else if (event.type === "sorting_start") {
      entries.push({ ...baseEntry, title: "정리 시작", detail: buildMovementDetail(zoneCalc), kind: "sorting" });
      if (event.zoneId && !dayRecord.timeline.some((candidate) => candidate.zoneId === event.zoneId && candidate.type === "sorting_end")) {
        const missingEditId = `missing-sorting-end-${event.zoneId}`;
        if (!entries.some((entry) => entry.eventId === missingEditId)) {
          entries.push({
            eventId: missingEditId,
            title: "정리 완료 누락",
            time: "-",
            detail: `${zoneName ?? "구역"} 정리 완료 시각을 로그에서 직접 추가할 수 있습니다.`,
            kind: "sorting",
            editable: true,
            editKind: "missing_sorting_end",
          });
        }
      }
    } else if (event.type === "sorting_end") {
      entries.push({ ...baseEntry, title: "정리 완료", detail: `정리: ${formatMin(zoneCalc?.sortingMinutes)}${payload?.autoCleanup === true ? " · 자동 적용" : ""}`, kind: "sorting" });
    } else if (event.type === "zone_end") {
      const delivered = typeof payload?.delivered === "number" ? `${payload.delivered}개` : "수량 없음";
      const delivery = zoneCalc?.deliveryMinutes !== undefined ? ` · ${formatMin(zoneCalc.deliveryMinutes)}` : "";
      const efficiency = zoneCalc?.efficiencyPerHour !== undefined ? ` · ${Math.round(zoneCalc.efficiencyPerHour)}개/시간` : "";
      entries.push({ ...baseEntry, title: `${zoneName} 완료`, detail: `${delivered}${delivery}${efficiency}`, kind: "done" });
    } else if (event.type === "incident") {
      const title = typeof payload?.title === "string" ? payload.title : "이벤트";
      const minutes = typeof payload?.minutes === "number" ? `${payload.minutes}분` : "시간 미입력";
      entries.push({ ...baseEntry, title, detail: `${minutes}${zoneName ? ` / ${zoneName}` : ""}`, kind: "event" });
    } else if (event.type === "helper_add") {
      entries.push({ ...baseEntry, title: getHelperEventTitle(payload), detail: getHelperEventDetail(payload), kind: "event" });
    } else if (event.type === "day_close") {
      entries.push({ ...baseEntry, title: "업무 종료", detail: "오늘 업무가 종료됐습니다.", kind: "done" });
    }
  }

  if (entries.length === 0) {
    entries.push({ title: "업무 시작 전", time: "-", detail: "진접 출발 버튼을 눌러 시작하세요.", kind: "event" });
  }

  return entries;
}

function renderLogEntry(entry: LogViewEntry): string {
  const editing = Boolean(entry.eventId && activeLogEditEventId === entry.eventId);
  return `
    <article class="timeline-entry ${entry.kind}${editing ? " editing" : ""}">
      <div class="timeline-entry-head">
        <div class="timeline-entry-copy">
          <strong>${entry.title}</strong>
          <time>${entry.time}</time>
          ${entry.detail ? `<p>${entry.detail}</p>` : ""}
        </div>
        ${entry.editable && entry.eventId ? `
          <button class="timeline-edit-btn${editing ? " active" : ""}" data-action="${editing ? "close-log-edit" : "open-log-edit"}" data-event="${escapeAttribute(entry.eventId)}" title="로그 직접 수정" aria-label="로그 직접 수정">&#9998;</button>
        ` : ""}
      </div>
      ${editing && entry.eventId ? renderLogInlineEditor(entry.eventId, entry.editKind) : ""}
    </article>
  `;
}

function renderLogInlineEditor(eventId: string, editKind?: LogEditKind): string {
  if (!currentDay) return "";
  if (editKind === "missing_sorting_end") {
    return renderMissingSortingEndEditor(eventId);
  }
  const event = currentDay.timeline.find((candidate) => candidate.id === eventId);
  if (!event || !editKind) return "";

  const zoneName = event.zoneId ? getZoneName(event.zoneId) : undefined;
  const payload = event.payload as Record<string, unknown> | undefined;
  const baseId = `log-edit-${event.id}`;

  if (editKind === "depart") {
    const total = typeof payload?.total === "number" ? String(payload.total) : "";
    return renderLogEventTimeEditor(event, "진접 출발 수정", "출발 시각과 예상 수량을 함께 바로잡습니다.", `
        <label>예상 수량
          <input id="${escapeAttribute(`${baseId}-total`)}" type="text" inputmode="numeric" maxlength="5" data-numeric-limit="5" value="${escapeAttribute(total)}">
        </label>
      `, "출발 시각");
  }

  if (editKind === "arrive") {
    return renderLogEventTimeEditor(event, "청량리 도착 수정", "도착 시각을 고치면 운전 시간이 다시 계산됩니다.", "", "도착 시각");
  }
  if (editKind === "day_close") {
    return renderLogEventTimeEditor(event, "업무 종료 수정", "", "", "업무 종료 시각");
  }

  if (editKind === "zone_start") {
    return renderLogEventTimeEditor(event, `${escapeHtml(zoneName ?? "구역")} 시작 수정`, "로그 현장 정정은 입력값을 우선 저장하고 시간축 경고는 정정 이력에 남깁니다.", "", "구역 시작 시각");
  }

  if (editKind === "delivery_start") {
    return renderLogEventTimeEditor(event, `${escapeHtml(zoneName ?? "구역")} 배송 시작 수정`, "로그 현장 정정은 입력값을 우선 저장하고 실제 시간·효율을 다시 계산합니다.", "", "배송 시작 시각");
  }

  if (editKind === "sorting_start") {
    return renderLogEventTimeEditor(event, `${escapeHtml(zoneName ?? "구역")} 정리 시작 수정`, "로그 현장 정정은 입력값을 우선 저장하고 정리 시간을 다시 계산합니다.", "", "정리 시작 시각");
  }

  if (editKind === "sorting_end") {
    return renderLogEventTimeEditor(event, `${escapeHtml(zoneName ?? "구역")} 정리 완료 수정`, "로그 현장 정정은 시간축 조건과 무관하게 저장하고 정리 시간을 다시 계산합니다.", "", "정리 완료 시각");
  }

  if (editKind === "zone_end") {
    const delivered = typeof payload?.delivered === "number" ? String(payload.delivered) : "";
    const failed = typeof payload?.failed === "number" ? String(payload.failed) : "0";
    const extra = typeof payload?.extra === "number" ? String(payload.extra) : "0";
    return `
      <article class="timeline-inline-editor">
        <strong>${escapeHtml(zoneName ?? "구역")} 완료 수정</strong>
        <p class="hint">로그 현장 정정은 시간축·예상수량 조건보다 입력값을 우선합니다. 이상값은 정정 이력에 남기고 리포트와 통계를 다시 계산합니다.</p>
        <div class="log-inline-grid">
          ${renderDigitTimeFields(`${baseId}-time`, "구역 완료 시각", event.at)}
          <label>배송 수량
            <input id="${escapeAttribute(`${baseId}-delivered`)}" type="text" inputmode="numeric" maxlength="5" data-numeric-limit="5" value="${escapeAttribute(delivered)}">
          </label>
          <label>실패
            <input id="${escapeAttribute(`${baseId}-failed`)}" type="text" inputmode="numeric" maxlength="5" data-numeric-limit="5" value="${escapeAttribute(failed)}">
          </label>
          <label>추가
            <input id="${escapeAttribute(`${baseId}-extra`)}" type="text" inputmode="numeric" maxlength="5" data-numeric-limit="5" value="${escapeAttribute(extra)}">
          </label>
          ${event.zoneId && hasHandlingControl(event.zoneId) ? `
            <label class="wide">${HANDLING_TITLE} (분)
              <input id="${escapeAttribute(`${baseId}-handling`)}" type="text" inputmode="numeric" value="${readHandlingMinutes(findHandlingEvent(currentDay!, event.zoneId))}">
            </label>
          ` : ""}
        </div>
        ${renderLogEditButtons(event.id)}
      </article>
    `;
  }

  if (editKind === "incident") {
    if (isHandlingEvent(event)) {
      return `
        <article class="timeline-inline-editor">
          <strong>${escapeHtml(zoneName ?? "구역")} ${HANDLING_TITLE}</strong>
          <div class="log-inline-grid">
            ${renderDigitTimeFields(`${baseId}-time`, "기록 시각", event.at)}
            <label class="wide">소요 시간 (분 · 0은 적용 취소)
              <input id="${escapeAttribute(`${baseId}-minutes`)}" type="text" inputmode="numeric" value="${readHandlingMinutes(event)}">
            </label>
          </div>
          ${renderLogEditButtons(event.id)}
        </article>
      `;
    }
    const minutes = typeof payload?.minutes === "number" ? String(payload.minutes) : "";
    const title = typeof payload?.title === "string" ? payload.title : "기타";
    const scope = typeof payload?.scope === "string" ? payload.scope : event.zoneId ? `zone:${event.zoneId}` : "work";
    return `
      <article class="timeline-inline-editor">
        <strong>이벤트 수정</strong>
        <p class="hint">이벤트 제목, 시간, 메모, 범위를 함께 고칩니다.</p>
        <div class="log-inline-grid">
          ${renderDigitTimeFields(`${baseId}-time`, "기록 시각", event.at)}
          <label>이벤트 이름
            <input id="${escapeAttribute(`${baseId}-title`)}" type="text" value="${escapeAttribute(title)}">
          </label>
          <label>소요 분
            <input id="${escapeAttribute(`${baseId}-minutes`)}" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${escapeAttribute(minutes)}">
          </label>
          <label class="wide">적용 범위
            <select id="${escapeAttribute(`${baseId}-scope`)}">
              ${buildLogEventScopeOptions(scope)}
            </select>
          </label>
          <label class="wide">메모
            <input id="${escapeAttribute(`${baseId}-note`)}" type="text" value="${escapeAttribute(event.note ?? "")}">
          </label>
        </div>
        ${renderLogEditButtons(event.id)}
      </article>
    `;
  }

  if (editKind === "helper") {
    const helper = findLogHelperRecord(event);
    if (!helper) {
      return `
        <article class="timeline-inline-editor">
          <strong>도우미 기록 수정</strong>
          <p class="hint">연결된 도우미 원본을 찾지 못해 이 항목은 여기서 바로 수정할 수 없습니다.</p>
          ${renderLogEditButtons(event.id, "닫기")}
        </article>
      `;
    }
    const kind = normalizeReceivedHelperKind(helper.kind ?? payload?.helperKind) ?? "free_received";
    const quantity = typeof helper.quantity === "number" ? helper.quantity : typeof payload?.quantity === "number" ? payload.quantity : 0;
    return `
      <article class="timeline-inline-editor">
        <strong>${escapeHtml(helper.name)} 수정</strong>
        <p class="hint">${hasHelperSourceZone(event) ? "구역 동행 기록은 수량 0개도 허용되며 총량 중복 합산에서 제외됩니다." : "도우미 핵심 시각과 수량을 바로 고칩니다."}</p>
        <div class="log-inline-grid">
          <label>도우미 종류
            <select data-helper-kind="${escapeAttribute(helper.id)}">
              <option value="free_received"${kind === "free_received" ? " selected" : ""}>도우미 배송 무료</option>
              <option value="paid_received"${kind === "paid_received" ? " selected" : ""}>도우미 배송 유료</option>
            </select>
          </label>
          <label>수량
            <input data-helper-quantity="${escapeAttribute(helper.id)}" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${quantity > 0 ? quantity : ""}">
          </label>
          ${renderHelperDigitTimeFields(helper.id, "기록 시각", event.at)}
        </div>
        ${renderLogEditButtons(event.id)}
      </article>
    `;
  }

  return "";
}

function renderMissingSortingEndEditor(editKey: string): string {
  if (!currentDay) return "";
  const zoneId = editKey.replace(/^missing-sorting-end-/, "");
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const zoneEnd = latestZoneEvent(zoneId, "zone_end");
  if (!zone || !sortingStart) return "";
  const baseId = `log-edit-${editKey}`;
  const suggestedAt = zoneEnd?.at ?? sortingStart.at;
  return `
    <article class="timeline-inline-editor">
      <strong>${escapeHtml(zone.name)} 정리 완료 추가</strong>
      <p class="hint">정리 완료를 놓친 경우 실제 시각을 바로 추가합니다. 기존 시간축 조건에 막지 않고 현장 정정 이력을 남깁니다.</p>
      <div class="log-inline-grid">
        ${renderDigitTimeFields(`${baseId}-time`, "정리 완료 시각", suggestedAt)}
      </div>
      ${renderLogEditButtons(editKey)}
    </article>
  `;
}
function renderLogEventTimeEditor(event: TimelineEvent, title: string, hint: string, extraFields = "", timeLabel = "기록 시각"): string {
  const baseId = `log-edit-${event.id}`;
  return `
    <article class="timeline-inline-editor">
      <strong>${title}</strong>
      <p class="hint">${hint}</p>
      <div class="log-inline-grid">
        ${renderDigitTimeFields(`${baseId}-time`, timeLabel, event.at)}
        ${extraFields}
      </div>
      ${renderLogEditButtons(event.id)}
    </article>
  `;
}

function renderLogEditButtons(eventId: string, closeLabel = "취소"): string {
  return `
    <div class="row-actions">
      <button data-action="save-log-edit" data-event="${escapeAttribute(eventId)}">저장</button>
      <button class="secondary" data-action="close-log-edit" data-event="${escapeAttribute(eventId)}">${closeLabel}</button>
    </div>
  `;
}

function buildLogEventScopeOptions(selectedScope: string): string {
  const options = [{ value: "work", label: "하루 전체" }, ...(currentDay?.zones ?? []).map((zone) => ({ value: `zone:${zone.id}`, label: `${zone.order}구역 · ${zone.name}` }))];
  return options.map((option) => `
    <option value="${escapeAttribute(option.value)}"${option.value === selectedScope ? " selected" : ""}>${escapeHtml(option.label)}</option>
  `).join("");
}

function findLogHelperRecord(event: TimelineEvent): HelperRecord | undefined {
  const payload = event.payload as { helperId?: unknown } | undefined;
  if (typeof payload?.helperId === "string") {
    const byId = currentDay?.helpers.find((helper) => helper.id === payload.helperId);
    if (byId) return byId;
  }
  return currentDay?.helpers.find((helper) => helper.linkedEventIds.includes(event.id));
}

function getLogEditKind(event: TimelineEvent): LogEditKind | undefined {
  switch (event.type) {
    case "depart_jinjeop":
      return "depart";
    case "arrive_cheongnyangni":
      return "arrive";
    case "zone_start":
      return "zone_start";
    case "delivery_start":
      return "delivery_start";
    case "sorting_start":
      return "sorting_start";
    case "sorting_end":
      return "sorting_end";
    case "zone_end":
      return "zone_end";
    case "day_close":
      return "day_close";
    case "incident":
      return "incident";
    case "helper_add":
      return "helper";
    default:
      return undefined;
  }
}
function getDriveMinutes(): number | undefined {
  if (!currentDay) return undefined;
  return getDriveMinutesForDay(currentDay);
}

function getDriveMinutesForDay(dayRecord: DayRecord): number | undefined {
  const depart = dayRecord.timeline.find((event) => event.type === "depart_jinjeop");
  const arrive = dayRecord.timeline.find((event) => event.type === "arrive_cheongnyangni");
  return depart?.at && arrive?.at ? diffMinutesFromIso(depart.at, arrive.at) : undefined;
}

function compareLogEventOrder(a: TimelineEvent, b: TimelineEvent, dayRecord: DayRecord): number {
  const byMinute = minuteTimestamp(a.at) - minuteTimestamp(b.at);
  if (byMinute !== 0) return byMinute;

  const byPriority = logFlowPriority(a, dayRecord) - logFlowPriority(b, dayRecord);
  if (byPriority !== 0) return byPriority;

  const byTime = Date.parse(a.at) - Date.parse(b.at);
  if (byTime !== 0) return byTime;

  return a.id.localeCompare(b.id);
}

function logFlowPriority(event: TimelineEvent, dayRecord: DayRecord): number {
  if (event.type === "depart_jinjeop") return 0;
  if (event.type === "arrive_cheongnyangni") return 1;
  if (event.type === "day_close") return Number.MAX_SAFE_INTEGER;
  const zone = dayRecord.zones.find((candidate) => candidate.id === event.zoneId);
  return (zone?.order ?? dayRecord.zones.length + 1) * 100 + logEventPriority(event);
}

function minuteTimestamp(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  date.setSeconds(0, 0);
  return date.getTime();
}

function logEventPriority(event: TimelineEvent): number {
  switch (event.type) {
    case "depart_jinjeop":
      return 10;
    case "arrive_cheongnyangni":
      return 20;
    case "zone_start":
      return 30;
    case "sorting_start":
      return 40;
    case "sorting_end":
      return 50;
    case "delivery_start":
      return 60;
    case "incident":
    case "helper_add":
      return 70;
    case "zone_end":
      return 80;
    case "day_close":
      return 90;
    default:
      return 100;
  }
}

function getHelperEventTitle(payload?: Record<string, unknown>): string {
  const kind = typeof payload?.helperKind === "string" ? payload.helperKind : "";
  if (kind === "free_received") return "도우미 배송 무료";
  if (kind === "paid_received") return "도우미 배송 유료";
  if (payload?.unpaid === true) return "무보수 도우미";
  return "도우미 배송";
}

function getHelperEventDetail(payload?: Record<string, unknown>): string {
  const quantity = typeof payload?.quantity === "number" ? `${payload.quantity}개` : "";
  const kind = typeof payload?.helperKind === "string" ? payload.helperKind : "";
  const sourceZone = typeof payload?.sourceZoneId === "string" && currentDay?.zones.some(zone => zone.id === payload.sourceZoneId);
  const rule = sourceZone
    ? "구역 동행 · 총량 중복 제외"
    : kind === "free_received"
      ? "효율 제외"
      : kind === "paid_received"
        ? "효율 포함"
        : "";
  return [quantity, rule].filter(Boolean).join(" · ") || "구역 동행";
}

function buildMijuStartDetail(): string | undefined {
  if (!currentDay) return undefined;
  return buildMijuStartDetailForDay(currentDay);
}

function buildMijuStartDetailForDay(dayRecord: DayRecord, zoneId = "miju"): string | undefined {
  const checkpoint = getMijuCheckpointForDay(dayRecord, zoneId);
  if (!checkpoint || checkpoint.aTotal <= 0) return undefined;
  return `1동 ${checkpoint.one} · 2동 ${checkpoint.two} · 3동 ${checkpoint.three} (A합계:${checkpoint.aTotal}개)`;
}

function buildMovementDetail(zoneCalc: DayCalculation["zones"][number] | undefined): string | undefined {
  if (zoneCalc?.movementMinutes === undefined) return undefined;
  return `이동: ${formatMin(zoneCalc.movementMinutes)}`;
}

function getZoneOrderLabel(zoneId: string | undefined): string {
  if (!currentDay || !zoneId) return "구역";
  return getZoneOrderLabelForDay(currentDay, zoneId);
}

function getZoneOrderLabelForDay(dayRecord: DayRecord, zoneId: string | undefined): string {
  if (!zoneId) return "구역";
  const zone = dayRecord.zones.find((item) => item.id === zoneId);
  return zone ? `${zone.order}구역` : "구역";
}

function renderCurrentStep(): string {
  if (!currentDay) return "";
  if (hasEvent("day_close")) return renderFinishedStep();
  if (!hasEvent("depart_jinjeop")) return renderDepartStep();
  if (!hasEvent("arrive_cheongnyangni")) return renderArriveStep();
  if (isUnpaidHelperDay(currentDay) && !hasEvent("day_close")) return renderUnpaidHelperCloseStep();
  if (currentDay.zones.length === 0) return renderExtraZoneChoiceStep();

  const activeZone = getCurrentWorkZone();
  if (activeZone) {
    if (!hasZoneStarted(activeZone.id)) return renderZoneStartStep(activeZone);
    if (!hasZoneEnded(activeZone.id)) return renderZoneWorkStep(activeZone);
  }

  if (!hasEvent("day_close")) return renderExtraZoneChoiceStep();
  return renderFinishedStep();
}

function renderDepartStep(): string {
  return `
    <section class="panel focus">
      <p class="step">1 / 출발</p>
      <h2>진접 출발</h2>
      <label>예상 수량<input id="expected-count" type="number" inputmode="numeric" min="0" max="${MAX_REASONABLE_EXPECTED}" placeholder="예: 285"></label>
      <button data-action="depart">출발 기록</button>
    </section>
  `;
}

function renderArriveStep(): string {
  return `
    <section class="panel focus">
      <p class="step">2 / 도착</p>
      <h2>청량리 도착</h2>
      <p class="hint">도착을 누르면 운전 시간이 보존되고 다음 단계로 넘어갑니다.</p>
      <button data-action="arrive">도착 기록</button>
    </section>
  `;
}

function renderUnpaidHelperCloseStep(): string {
  return `
    <section class="panel focus">
      <p class="step">무보수 도우미</p>
      <h2>무보수 도우미날 진행 중</h2>
      <p class="hint">청량리 도착과 운전 시간은 기록됐습니다. 실제 도우미 업무가 끝난 시각으로 종료하세요.</p>
      <label>종료 시각<input id="helper-close-at" type="datetime-local" value="${formatTimeInputValue(new Date())}"></label>
      <div class="segmented">
        <button data-action="close-day">입력 시각으로 종료</button>
        <button data-action="close-day-now">지금 종료</button>
      </div>
    </section>
  `;
}

function renderWorkOrderStep(): string {
  return `
    <section class="panel focus">
      <p class="step">3 / 오늘 순서</p>
      <h2>작업 순서</h2>
      <p class="hint">기본 순서는 미주, 힐스테이트, 대체배송입니다. 다음 화면에서 화살표로 바로 바꿀 수 있습니다.</p>
      <button data-action="prepare-default-order">오늘 순서 열기</button>
    </section>
  `;
}

function renderZoneStartStep(zone: ZoneRecord): string {
  return `<section class="panel focus">
    ${renderRouteHeading(zone)}
    <p class="work-status">시작 전</p>
    <div class="field-actions">
      <button class="primary full-width" data-action="zone-start" data-zone="${zone.id}" data-start-mode="delivery">${escapeHtml(zone.name)} 시작</button>
      ${getZoneKind(zone) !== "miju" ? `<button class="secondary full-width" data-action="zone-start" data-zone="${zone.id}" data-start-mode="sorting">정리부터 시작</button>` : ""}
      <button class="text-button full-width" data-action="open-close-day">오늘 업무 마감</button>
    </div>
  </section>`;
}

function renderZoneOrderEditor(): string {
  return '<button class="secondary full-width" data-action="open-route-plans">남은 작업 순서</button>';
}

function renderZoneWorkStep(zone: ZoneRecord): string {
  if (getZoneKind(zone) === "miju" && (!hasZoneEvent(zone.id, "sorting_start") || hasZoneEvent(zone.id, "sorting_end"))) return renderMijuWorkStep(zone);
  return renderGenericZoneWorkStep(zone.id, { step: String(zone.order), title: zone.name, countInputId: getWorkCountInputId(zone), endLabel: zone.name + " 완료" });
}

function renderMijuWorkStep(zone: ZoneRecord): string {
  const checkpoint = getMijuCheckpoint(zone.id);
  return `<section class="panel focus">
    ${renderRouteHeading(zone)}
    <p class="work-status">배송 중 · ${formatTime((latestZoneEvent(zone.id, "delivery_start") ?? latestZoneEvent(zone.id, "sorting_end") ?? latestZoneEvent(zone.id, "zone_start"))!.at)} 시작</p>
    <div class="building-block">
      <p class="section-label">1 · 2 · 3동</p>
      <div class="building-grid">
        <label>1동<input id="miju-1-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.one ?? ""}" placeholder="0"></label>
        <label>2동<input id="miju-2-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.two ?? ""}" placeholder="0"></label>
        <label>3동<input id="miju-3-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.three ?? ""}" placeholder="0"></label>
      </div>
      <div class="record-row"><span>${checkpoint ? "기록됨 · " + checkpoint.aTotal + "개" : "선택 기록"}</span><button class="secondary" data-action="save-miju-detail" data-zone="${zone.id}">1/2/3동 기록</button>${checkpoint ? `<button class="symbol-button" data-action="clear-miju-detail" data-zone="${zone.id}" title="동별 기록 지우기" aria-label="동별 기록 지우기">${fieldIcon("close")}</button>` : ""}</div>
    </div>
    ${renderWorkQuantity(zone)}
    <button class="primary full-width" data-action="zone-end" data-zone="${zone.id}">${escapeHtml(zone.name)} 완료</button>
  </section>`;
}

function renderHilsStartStep(): string {
  return `
    <section class="panel focus">
      <p class="step">4 / 2구역</p>
      <h2>힐스테이트 시작</h2>
      <p class="hint">힐스테이트부터는 배송 수량과 정리 시작/완료를 분리해서 기록합니다.</p>
      <button data-action="zone-start" data-zone="hils">힐스테이트 시작</button>
    </section>
  `;
}

function renderHilsWorkStep(): string {
  return renderGenericZoneWorkStep("hils", {
    step: "4 / 힐스테이트",
    title: "힐스테이트 입력",
    countInputId: "hils-count",
    endLabel: "힐스테이트 완료",
  });
}

function renderExtraZoneChoiceStep(): string {
  return `<section class="panel focus"><p class="step">배송 완료</p><h2>오늘 수고했어요</h2><button class="primary full-width" data-action="open-close-day">오늘 업무 마감</button></section>`;
}

function renderExtraZoneWorkStep(zone: ZoneRecord): string {
  return renderGenericZoneWorkStep(zone.id, {
    step: `추가 / ${zone.name}`,
    title: `${zone.name} 입력`,
    countInputId: "extra-count",
    endLabel: `${zone.name} 완료`,
  });
}

function renderGenericZoneWorkStep(zoneId: string, options: { step: string; title: string; countInputId: string; endLabel: string }): string {
  const zone = currentDay!.zones.find(z => z.id === zoneId)!;
  const sortingStarted = hasZoneEvent(zoneId, "sorting_start");
  const sortingEnded = hasZoneEvent(zoneId, "sorting_end");
  const deliveryStarted = hasZoneEvent(zoneId, "delivery_start");
  const sortingEndEvent = latestZoneEvent(zoneId, "sorting_end");
  const automaticallySorted = (sortingEndEvent?.payload as Record<string, unknown> | undefined)?.autoCleanup === true;
  const ready = deliveryStarted || sortingEnded;
  return `<section class="panel focus">
    ${renderRouteHeading(zone)}
    <p class="work-status">${sortingStarted && !sortingEnded ? "정리 중" : ready ? "배송 중" : "작업 시작 전"} · ${formatTime((sortingStarted && !sortingEnded ? latestZoneEvent(zoneId, "sorting_start") : latestZoneEvent(zoneId, "delivery_start") ?? sortingEndEvent ?? latestZoneEvent(zoneId, "zone_start"))!.at)} 시작</p>
    ${sortingStarted && !sortingEnded ? `<button class="primary full-width" data-action="sorting-end" data-zone="${zoneId}">정리 완료</button>` : ""}
    ${!sortingStarted && !deliveryStarted ? `<div class="field-actions"><button class="primary full-width" data-action="delivery-start" data-zone="${zoneId}">바로 배송 시작</button><button class="secondary full-width" data-action="sorting-start" data-zone="${zoneId}">정리 시작</button></div>` : ""}
    ${ready ? `${renderWorkQuantity(zone)}<button class="primary full-width" data-action="zone-end" data-zone="${zoneId}">${escapeHtml(zone.name)} 완료</button>` : ""}
    ${automaticallySorted ? `<div class="auto-cleanup-notice"><span>정리 30분 · 자동 적용</span><button class="symbol-button" data-action="open-log-edit" data-event="${sortingEndEvent!.id}" title="정리 시간 수정" aria-label="정리 시간 수정">${fieldIcon("edit")}</button></div>` : ""}
    ${hasHandlingControl(zoneId) ? renderHandlingControl(zoneId, options.countInputId) : ""}
    ${canCancelEmptyStartedExtraZone(zoneId) ? `<button class="text-button full-width" data-action="cancel-empty-extra-zone" data-zone="${zoneId}">잘못 추가함 · 취소</button>` : ""}
  </section>`;
}

function hasHandlingControl(zoneId: string): boolean {
  const zone = currentDay?.zones.find((candidate) => candidate.id === zoneId);
  return !!zone && (getZoneBucket(currentDay!, zoneId) === "hils" || !!findHandlingEvent(currentDay!, zoneId));
}

function renderHandlingControl(zoneId: string, countInputId: string): string {
  const event = findHandlingEvent(currentDay!, zoneId);
  const minutes = event ? readHandlingMinutes(event) : DEFAULT_HANDLING_MINUTES;
  return `
    <div class="handling-control">
      <label for="handling-minutes">${HANDLING_TITLE} (분)</label>
      <div class="handling-fields">
        <input id="handling-minutes" type="text" inputmode="numeric" value="${minutes}">
        <button class="secondary" data-action="save-handling" data-zone="${escapeAttribute(zoneId)}" data-count-input="${countInputId}">${event ? "수정" : "기록"}</button>
        ${event && minutes > 0 ? `<button class="secondary" data-action="cancel-handling" data-zone="${escapeAttribute(zoneId)}" data-count-input="${countInputId}">취소</button>` : ""}
      </div>
      <p class="handling-status" role="status">${event ? minutes > 0 ? `별도 작업 ${minutes}분 적용됨` : "별도 작업 미적용" : "별도 작업 미기록"}</p>
    </div>
  `;
}

function renderEventPanel(): string {
  if (!currentDay || !hasEvent("depart_jinjeop") || hasEvent("day_close")) return "";
  const defaultScope = getDefaultEventScope();
  return `
    <section class="panel event-panel">
      <h2>이벤트 기록</h2>
      <p class="hint">식사, 업체 방문, 반품, 상차, 대기처럼 배송 외 시간을 따로 남깁니다.</p>
      <div class="form-grid event-grid">
        <label>유형
          <select id="event-title">
            ${EVENT_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
          </select>
        </label>
        <label>위치
          <select id="event-scope">
            ${getEventScopeOptions().map((option) => `<option value="${option.value}" ${option.value === defaultScope ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
        <label>시각<input id="event-at" type="datetime-local" value="${formatTimeInputValue(new Date())}"></label>
        <label>소요분<input id="event-minutes" type="number" inputmode="numeric" min="0" max="240" placeholder="예: 10"></label>
        <label class="wide">메모<input id="event-note" type="text" maxlength="80" placeholder="예: 힐스 전 업체 방문"></label>
      </div>
      <button data-action="add-event">이벤트 추가</button>
      <div class="helper-actions">
        <label>도우미 배송 수량<input id="helper-received-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" placeholder="구역 동행이면 비워도 됨"></label>
        <div class="segmented">
          <button data-action="add-helper-free">도우미 배송 무료</button>
          <button data-action="add-helper-paid">도우미 배송 유료</button>
        </div>
        <p class="hint">위치가 구역이면 도우미는 그 구역 안의 동행/기여로 기록하고 총수량에 다시 더하지 않습니다. 위치가 전체 업무이고 수량이 있으면 별도 도우미 배송으로 계산합니다.</p>
      </div>
    </section>
  `;
}

function renderFinishedStep(): string {
  return `
    <section class="panel focus">
      <p class="step">완료</p>
      <h2>오늘 업무가 종료됐습니다</h2>
      <p class="hint">기록 저장됨</p>
      <button class="primary full-width" data-action="set-tab" data-tab="log">오늘 로그</button>
    </section>
  `;
}

function renderCleanupCorrectionPanel(zoneId: string): string {
  return `
    <section class="warning">
      <strong>정리 완료가 비어 있습니다.</strong>
      <p>${getZoneName(zoneId)} 정리 시작: ${formatTime(latestZoneEvent(zoneId, "sorting_start")!.at)}</p>
      <div class="form-grid">
        <label>정리 시간<input id="cleanup-input" type="number" inputmode="numeric" min="1" value="30"></label>
        <label>처리 방식<input value="정리 시작 + 입력분" readonly></label>
      </div>
      <div class="segmented">
        <button data-action="fix-cleanup" data-zone="${zoneId}">보정 적용</button>
        <button data-action="skip-cleanup" data-zone="${zoneId}">정리 없음</button>
      </div>
    </section>
  `;
}

function renderQuantityRiskPanel(risk: PendingQuantityRisk): string {
  const overExpected = risk.expectedTotal !== undefined
    ? risk.saveValue + risk.previousDelivered - risk.expectedTotal
    : undefined;
  return `
    <section class="warning quantity-risk-panel">
      <strong>수량이 비정상적으로 큽니다.</strong>
      <p>${escapeHtml(risk.warning)}</p>
      <div class="risk-grid">
        <span>입력값 <strong>${risk.entered}개</strong></span>
        <span>저장 예정 <strong>${risk.saveValue}개</strong></span>
        <span>이전 완료 <strong>${risk.previousDelivered}개</strong></span>
        <span>예상 수량 <strong>${risk.expectedTotal ?? "-"}개</strong></span>
        ${overExpected !== undefined ? `<span>예상 대비 <strong>${overExpected > 0 ? "+" : ""}${overExpected}개</strong></span>` : ""}
      </div>
      <div class="risk-actions">
        <button data-action="quantity-risk-reset">입력 다시 하기</button>
        ${risk.adjustedValue !== undefined ? `<button class="secondary" data-action="quantity-risk-adjusted">누적 총합으로 계산 (${risk.adjustedValue}개)</button>` : ""}
        <button class="secondary" data-action="quantity-risk-actual">이 구역 실제 수량 ${risk.entered}개 저장</button>
        <button class="danger" data-action="quantity-risk-override">예외 저장</button>
      </div>
      <p class="hint">실수 저장을 막기 위해 바로 저장하지 않았습니다. 실제 예외라면 예외 저장 기록이 남습니다.</p>
    </section>
  `;
}

function renderZoneCards(): string {
  return `<div class="zone-list">${getOrderedZones().map((zone) => renderZoneCard(zone.id)).join("")}</div>`;
}

function renderZoneCard(zoneId: string): string {
  if (!currentDay) return "";
  const zone = currentDay.zones.find((item) => item.id === zoneId);
  const start = latestZoneEvent(zoneId, "zone_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const count = readDeliveredPayload(end);
  const showSorting = !isMijuZone(zoneId);
  const status = end ? "완료" : start ? "진행" : "대기";

  return `
    <article class="zone-card">
      <div>
        <strong>${escapeHtml(zone?.name ?? getZoneName(zoneId))}</strong>
        <span>${status}</span>
      </div>
      <p>수량 ${count}개</p>
      <p>시작 ${start ? formatTime(start.at) : "-"} / 종료 ${end ? formatTime(end.at) : "-"}</p>
      ${showSorting ? `<p>정리 ${sortingStart ? formatTime(sortingStart.at) : "-"} ~ ${sortingEnd ? formatTime(sortingEnd.at) : "-"}</p>` : ""}
      ${end ? renderCompletedZoneEditForm(zoneId) : ""}
    </article>
  `;
}

function renderCompletedZoneEditForm(zoneId: string): string {
  const start = latestZoneEvent(zoneId, "zone_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const payload = end?.payload as Record<string, unknown> | undefined;
  const delivered = typeof payload?.delivered === "number" ? payload.delivered : 0;
  const failed = typeof payload?.failed === "number" ? payload.failed : 0;
  const extra = typeof payload?.extra === "number" ? payload.extra : 0;
  const one = typeof payload?.building1Total === "number" ? payload.building1Total : 0;
  const two = typeof payload?.building2Total === "number" ? payload.building2Total : 0;
  const three = typeof payload?.building3Total === "number" ? payload.building3Total : 0;
  const aTotal = typeof payload?.aTotal === "number" ? payload.aTotal : one + two + three || delivered;
  const bTotal = typeof payload?.restTotal === "number"
    ? payload.restTotal
    : typeof payload?.bTotal === "number"
      ? payload.bTotal
      : 0;
  const quantitySummary = isMijuZone(zoneId)
    ? `미주 총합 ${delivered}개 / A ${aTotal}개 / 나머지 ${bTotal}개`
    : `배송 ${delivered}개 / 실패 ${failed}개 / 추가 ${extra}개`;

  return `
    <details class="zone-edit">
      <summary>완료 기록 수정</summary>
      <p class="edit-summary">${quantitySummary}</p>
      <div class="form-grid edit-time-grid">
        <label>시작 시간<input id="edit-${zoneId}-start" type="time" value="${formatIsoForTimeInput(start?.at)}"></label>
        <label>종료 시간<input id="edit-${zoneId}-end" type="time" value="${formatIsoForTimeInput(end?.at)}"></label>
      </div>
      <div class="form-grid edit-count-grid ${isMijuZone(zoneId) ? "miju-edit-grid" : "generic-edit-grid"}">
        ${isMijuZone(zoneId)
          ? `
            <label>1동<input id="edit-${zoneId}-1" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${one || ""}"></label>
            <label>2동<input id="edit-${zoneId}-2" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${two || ""}"></label>
            <label>3동<input id="edit-${zoneId}-3" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${three || ""}"></label>
            <label class="edit-miju-total">미주 전체<input id="edit-${zoneId}-total" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${delivered}"></label>
            <label class="edit-miju-rest">나머지<input value="${bTotal || ""}" readonly></label>
          `
          : `
            <label class="edit-delivered">배송 수량<input id="edit-${zoneId}-delivered" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${delivered}"></label>
            <label>정리 시작<input id="edit-${zoneId}-sorting-start" type="time" value="${formatIsoForTimeInput(sortingStart?.at)}"></label>
            <label>정리 완료<input id="edit-${zoneId}-sorting-end" type="time" value="${formatIsoForTimeInput(sortingEnd?.at)}"></label>
          `}
      </div>
      <div class="form-grid edit-extra-grid">
        <label>실패<input id="edit-${zoneId}-failed" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${failed}"></label>
        <label>추가<input id="edit-${zoneId}-extra" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${extra}"></label>
      </div>
      <button data-action="save-zone-edit" data-zone="${zoneId}">수정 저장</button>
    </details>
  `;
}

function renderQuantityComparison(title: string, comparison: ZoneQuantityComparison): string {
  return `
    <article class="ratio-card">
      <div>
        <strong>${title}</strong>
        <span>${comparison.ratioLabel}</span>
      </div>
      <p>기준: 배송 완료 수량 · 합계 ${comparison.totalQuantity}개</p>
      <div class="ratio-bars">
        ${comparison.buckets.map((bucket) => `
          <div>
            <label>${formatBucketLabel(bucket.key)} ${bucket.quantity}개 · ${bucket.percent}%</label>
            <span style="--w:${bucket.percent}%"></span>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function formatBucketLabel(key: ZoneQuantityComparison["buckets"][number]["key"]): string {
  if (key === "miju") return "미주";
  if (key === "hils") return "힐스";
  return "대체배송지";
}

function formatBucketShortLabel(key: ZoneQuantityComparison["buckets"][number]["key"]): string {
  if (key === "miju") return "미";
  if (key === "hils") return "힐";
  return "대";
}

function getZoneBucket(dayRecord: DayRecord, zoneId: string): ZoneQuantityComparison["buckets"][number]["key"] {
  const kind = getZoneKind(dayRecord.zones.find(z => z.id === zoneId));
  return kind === "miju" ? "miju" : kind === "hils" ? "hils" : "alternate";
}

function getZoneNameFromDay(dayRecord: DayRecord, zoneId: string): string {
  const existing = dayRecord.zones.find((zone) => zone.id === zoneId)?.name;
  if (existing) return existing;
  if (zoneId === "miju") return "미주";
  if (zoneId === "hils") return "힐스테이트";
  if (zoneId.startsWith("alt-")) return "대체배송";
  return "추가 구역";
}

function getExpectedTotalForDay(dayRecord: DayRecord): number | undefined {
  const depart = dayRecord.timeline.find((event) => event.type === "depart_jinjeop");
  const payload = depart?.payload as { total?: unknown } | undefined;
  return typeof payload?.total === "number" && payload.total > 0 ? payload.total : undefined;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number");
  if (defined.length === 0) return undefined;
  return defined.reduce((sum, value) => sum + value, 0);
}

function formatScanMiss(value?: number): string {
  if (value === undefined) return "-";
  if (value > 0) return `+${value}개`;
  return `${value}개`;
}

function getWeekRange(offset: number): { start: Date; end: Date } {
  const base = parseDateKey(todayKey());
  const start = new Date(base);
  start.setDate(base.getDate() - base.getDay() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function getMonthRange(offset: number): { start: Date; end: Date } {
  const base = parseDateKey(todayKey());
  const start = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0);
  return { start, end };
}

function getHistoryInRange(history: DayRecord[], start: Date, end: Date): DayRecord[] {
  const startKey = dateKeyFromDate(start);
  const endKey = dateKeyFromDate(end);
  return history.filter((dayRecord) => dayRecord.date >= startKey && dayRecord.date <= endKey);
}

function isVirtualRegularHoliday(date: string): boolean {
  return date < todayKey() && isRegularOffDate(date);
}

function isRegularOffDate(date: string): boolean {
  const day = parseDateKey(date).getDay();
  return day === 0 || day === 1;
}

function getDateKeysInRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function parseDateKey(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

function dateKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateRange(start: Date, end: Date): string {
  return `${formatShortDate(dateKeyFromDate(start))} ~ ${formatShortDate(dateKeyFromDate(end))}`;
}

function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function formatKoreanDateLabel(date: string): string {
  const parsed = parseDateKey(date);
  return `${parsed.getFullYear()}년 ${parsed.getMonth() + 1}월 ${parsed.getDate()}일 ${weekdayLabel(parsed)}`;
}

function formatShortDate(date: string): string {
  const parsed = parseDateKey(date);
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")} (${weekdayLabel(parsed, true)})`;
}

function weekdayLabel(date: Date, short = false): string {
  const labels = short
    ? ["일", "월", "화", "수", "목", "금", "토"]
    : ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return labels[date.getDay()] ?? "";
}


function renderImportFeedback(): string {
  if (!lastImportFeedback) return "";
  const imported = lastImportFeedback.importedDates.length > 0 ? lastImportFeedback.importedDates.join(", ") : "없음";
  const skipped = lastImportFeedback.skippedDates.length > 0 ? lastImportFeedback.skippedDates.join(", ") : "없음";

  return `
    <aside class="import-result">
      <strong>${escapeHtml(lastImportFeedback.title ?? "백업 가져오기 결과")}</strong>
      <p>${escapeHtml(lastImportFeedback.message)}</p>
      <ul>
        <li>파일: ${escapeHtml(lastImportFeedback.fileName)}</li>
        <li>인식한 날짜: ${lastImportFeedback.recognizedDays}일</li>
        <li>가져온 기록: ${lastImportFeedback.importedCount}일 (${escapeHtml(imported)})</li>
        <li>복사/건너뜀: ${lastImportFeedback.skippedCount}일 (${escapeHtml(skipped)})</li>
        <li>사전 스냅샷: ${lastImportFeedback.snapshotCreated ? "생성됨" : "없음"}</li>
        <li>내부 보호 스냅샷: ${lastImportFeedback.backupExported ? "저장됨" : "없음"}</li>
        ${lastImportFeedback.activeDate ? `<li>현재 표시 날짜: ${escapeHtml(lastImportFeedback.activeDate)}</li>` : ""}
      </ul>
    </aside>
  `;
}

async function handleAction(button: HTMLButtonElement): Promise<void> {
  if (!currentDay) return;

  const action = button.dataset.action ?? "";
  const zoneId = button.dataset.zone;

  if (await handleRouteAction(action, zoneId)) return;

  if (action === "continue-previous-day") {
    rolloverChoice = false;
    historicalEditing = true;
    render();
    return;
  }
  if (action === "start-today") {
    await loadToday();
    activeLogEditEventId = "";
    activeTab = "work";
    render();
    return;
  }

  if ((action === "save-handling" || action === "cancel-handling") && zoneId) {
    await saveHandlingControl(button, zoneId, action === "cancel-handling");
    return;
  }

  if (action === "set-tab") {
    const tab = button.dataset.tab as AppTab | undefined;
    if (tab && ["work", "log", "report", "stats", "backup"].includes(tab)) {
      activeTab = tab;
      render();
    }
    return;
  }

  if (action === "set-stats-tab") {
    const tab = button.dataset.statsTab as StatsTab | undefined;
    if (tab && ["week", "month", "date"].includes(tab)) {
      activeStatsTab = tab;
      render();
    }
    return;
  }

  if (action === "stats-week-prev") {
    statsWeekOffset -= 1;
    render();
    return;
  }

  if (action === "stats-week-next") {
    statsWeekOffset = Math.min(0, statsWeekOffset + 1);
    render();
    return;
  }

  if (action === "stats-month-prev") {
    statsMonthOffset -= 1;
    render();
    return;
  }

  if (action === "stats-month-next") {
    statsMonthOffset = Math.min(0, statsMonthOffset + 1);
    render();
    return;
  }

  if (action === "stats-date-today") {
    statsSelectedDate = todayKey();
    render();
    return;
  }

  if (action === "refresh") {
    toast("앱 캐시를 비우고 새 버전을 불러옵니다.");
    await platform.hardRefresh();
    return;
  }
  if (action === "load-today") {
    await loadToday();
    activeCorrectionTargetId = "";
    activeLogEditEventId = "";
    activeTab = "backup";
    render();
    return;
  }
  if (action === "load-correction-date") {
    await loadCorrectionDate();
    return;
  }
  if (action === "copy-report") {
    const report = buildDailyReport(currentDay, calculateDay(currentDay), { title: "Delivery Master Install Report" });
    await platform.copyText(report.text);
    toast("리포트를 복사했습니다.");
    return;
  }
  if (action === "snapshot") {
    const backup = await store.createBackup({ kind: "all" });
    const result = await platform.exportJson(backup, buildBackupFilename("manual"));
    if (result.status === "cancelled") {
      toast("백업 저장을 취소했습니다.");
    } else {
      toast("백업 JSON 파일을 저장했습니다.");
    }
    return;
  }
  if (action === "import-field-backup") {
    await importFieldBackupFile();
    return;
  }
  if (action === "import-phone-backup") {
    await importPhoneInstallBackupFile();
    return;
  }
  if (action === "reset-confirm") {
    const label = currentDay.date === todayKey() ? "오늘 기록" : `${currentDay.date} 기록`;
    if (!confirm(`${label}을 초기화할까요? 먼저 스냅샷을 만든 뒤 진행합니다.`)) return;
    await savePreparedSnapshot("reset-before", { kind: "date", date: currentDay.date });
    currentDay = createEmptyDay(currentDay.date);
    await store.saveDay(currentDay);
    await refreshHistory();
    formDrafts.clearDate(currentDay.date);
    discardDraftOnRender = true;
    render();
    return;
  }
  if (action === "prepare-default-order") {
    ensureDefaultWorkOrder();
    await saveAndRender();
    return;
  }
  if (action === "fix-cleanup") {
    await correctCleanup(zoneId);
    return;
  }
  if (action === "skip-cleanup") {
    removeMissingCleanup(zoneId);
    await saveAndRender();
    return;
  }
  if (action === "save-zone-edit" && zoneId) {
    await saveCompletedZoneEdit(zoneId);
    return;
  }
  if (action === "save-miju-detail") {
    if (!validateWorkDigits()) return;
    saveMijuCheckpoint(zoneId);
    await saveAndRender();
    return;
  }
  if (action === "clear-miju-detail") {
    clearMijuCheckpoint(zoneId);
    await saveAndRender();
    return;
  }
  if (action === "set-work-order") {
    setWorkOrder(button.dataset.order ?? "");
    await saveAndRender();
    return;
  }
  if (action === "move-zone-up" && zoneId) {
    moveZone(zoneId, -1);
    await saveAndRender();
    return;
  }
  if (action === "move-zone-down" && zoneId) {
    moveZone(zoneId, 1);
    await saveAndRender();
    return;
  }
  if (action === "add-alt-zone-to-order") {
    addZoneToOrder("alt");
    await saveAndRender();
    return;
  }
  if (action === "add-custom-zone-to-order") {
    addZoneToOrder("custom", readText("#custom-zone-name", "추가 구역"));
    await saveAndRender();
    return;
  }
  if (action === "skip-zone" && zoneId) {
    skipZone(zoneId);
    await saveAndRender();
    return;
  }
  if (action === "cancel-empty-extra-zone" && zoneId) {
    await cancelEmptyStartedExtraZone(zoneId);
    return;
  }
  if (action === "add-event") {
    addIncidentEvent();
    await saveAndRender();
    return;
  }
  if (action === "add-helper-free") {
    addReceivedHelper("free_received");
    await saveAndRender();
    return;
  }
  if (action === "add-helper-paid") {
    addReceivedHelper("paid_received");
    await saveAndRender();
    return;
  }
  if (action === "open-log-edit") {
    activeLogEditEventId = button.dataset.event ?? "";
    activeTab = "log";
    render();
    return;
  }
  if (action === "close-log-edit") {
    discardFormDraft();
    activeLogEditEventId = "";
    render();
    return;
  }
  if (action === "save-log-edit") {
    await saveLogEdit(button.dataset.event);
    return;
  }
  if (action === "apply-zone-correction" && zoneId) {
    await applyZoneCorrection(zoneId);
    return;
  }
  if (action === "select-correction-target") {
    activeCorrectionTargetId = readText("#correction-target", activeCorrectionTargetId);
    render();
    return;
  }
  if (action === "save-zone-correction" && zoneId) {
    await saveSelectedZoneCorrection(zoneId);
    return;
  }
  if (action === "save-helper-correction") {
    await saveHelperCorrection(button.dataset.helper);
    return;
  }
  if (action === "add-correction-helper") {
    await addCorrectionHelper();
    return;
  }
  if (action === "restore-helper-zone") {
    await restoreHelperToZone(button.dataset.helper);
    return;
  }
  if (action === "add-alt-zone") {
    addExtraZone("alt");
    await saveAndRender();
    return;
  }
  if (action === "add-custom-zone") {
    addExtraZone("custom", readText("#custom-zone-name", "추가 구역"));
    await saveAndRender();
    return;
  }
  if (action === "close-day" && mustCorrectCleanupBeforeClose()) {
    toast("정리 완료 보정이 먼저 필요합니다.");
    render();
    return;
  }
  if (action === "zone-end" && zoneId && hasMissingCleanupFinish(currentDay, zoneId)) {
    await addZoneEnd(zoneId);
    render();
    return;
  }

  if (action === "depart") addDepartEvent();
  if (action === "arrive") {
    addEvent("arrive_cheongnyangni");
    if (currentDay && !isUnpaidHelperDay(currentDay)) ensureDefaultWorkOrder();
  }
  if (action === "zone-start" && zoneId) {
    const running = getOrderedZones().find(z => hasZoneStarted(z.id) && !hasZoneEnded(z.id));
    if (running && running.id !== zoneId) { toast("진행 중인 구역을 먼저 완료하세요."); return; }
    addZoneStart(zoneId);
    normalizeZoneOrdersByActualStart();
    if (button.dataset.startMode === "sorting") addZoneEvent("sorting_start", zoneId);
    else if (button.dataset.startMode === "delivery" || isMijuZone(zoneId)) addDeliveryStart(zoneId);
  }
  if (action === "sorting-start" && zoneId) addZoneEvent("sorting_start", zoneId);
  if (action === "sorting-end" && zoneId) addZoneEvent("sorting_end", zoneId);
  if (action === "delivery-start" && zoneId) addDeliveryStart(zoneId);
  if (action === "zone-end" && zoneId) {
    await addZoneEnd(zoneId);
    if (hasZoneEnded(zoneId)) await saveAndRender();
    else render();
    return;
  }
  if (action === "quantity-risk-reset") {
    pendingQuantityRisk = null;
    render();
    return;
  }
  if (action === "quantity-risk-adjusted") {
    await applyPendingQuantityRisk("adjusted");
    return;
  }
  if (action === "quantity-risk-actual") {
    await applyPendingQuantityRisk("actual");
    return;
  }
  if (action === "quantity-risk-override") {
    await applyPendingQuantityRisk("override");
    return;
  }
  if (action === "close-day-now" && isUnpaidHelperDay(currentDay)) {
    const closeAt = nowIso();
    addUnpaidHelperEvent(closeAt);
    addEvent("day_close", undefined, closeAt);
    await saveAndRender();
    await savePreparedSnapshot("day-close", { kind: "all" });
    toast("업무 종료와 내부 자동 백업을 완료했습니다.");
    return;
  }
  if (action === "close-day") {
    if (getOrderedZones().some(z => hasZoneStarted(z.id) && !hasZoneEnded(z.id))) { toast("진행 중인 구역을 먼저 완료하세요."); return; }
    const closeAt = isUnpaidHelperDay(currentDay) ? readHelperCloseAt() : nowIso();
    if (isUnpaidHelperDay(currentDay)) addUnpaidHelperEvent(closeAt);
    addEvent("day_close", undefined, closeAt);
    await saveAndRender();
    await savePreparedSnapshot("day-close", { kind: "all" });
    toast("업무 종료와 내부 자동 백업을 완료했습니다.");
    return;
  }

  await saveAndRender();
}

function addDepartEvent(): void {
  const expectedInput = readLimitedNumberField("#expected-count", 4);
  if (!expectedInput.hasValue) {
    toast("예상 수량을 입력해야 출발할 수 있습니다. 무보수 도우미날이면 0을 직접 입력하세요.");
    return;
  }
  const expected = expectedInput.value;
  if (expected === 0 && !confirm("예상 수량 0개입니다. 무보수 도우미날로 시작할까요?")) return;
  if (!confirmLargeNumber(expected, MAX_REASONABLE_EXPECTED, "예상 수량")) return;
  addEvent("depart_jinjeop", { total: expected, helperDay: expected === 0 });
}

function addEvent(type: TimelineEventType, payload?: Record<string, unknown>, at = nowIso()): void {
  if (!currentDay) return;
  currentDay = createEvent(currentDay, { type, at, payload });
  currentDay.status = type === "day_close" ? "closed" : "active";
}

function addUnpaidHelperEvent(closeAt: string): void {
  if (!currentDay || hasEvent("helper_add")) return;
  const helperId = `helper-${currentDay.date}`;
  const arrive = currentDay.timeline.find((event) => event.type === "arrive_cheongnyangni");
  currentDay = createEvent(currentDay, {
    type: "helper_add",
    at: closeAt,
    payload: {
      helperId,
      name: "무보수 도우미",
      action: "add",
      unpaid: true,
      minutes: arrive ? diffMinutesFromIso(arrive.at, closeAt) : undefined,
    },
  });
  currentDay.helpers = [
    ...currentDay.helpers.filter((helper) => helper.id !== helperId),
    {
      id: helperId,
      name: "무보수 도우미",
      linkedEventIds: [currentDay.timeline.at(-1)!.id],
      memo: "수량 0 출발로 기록된 무보수 도우미날",
    },
  ];
}

function addZoneStart(zoneId: string): void {
  if (!currentDay || hasZoneStarted(zoneId)) return;
  const zone = ensureZone(zoneId);
  currentDay = createEvent(currentDay, {
    type: "zone_start",
    at: nowIso(),
    zoneId,
    payload: { zoneName: zone.name, order: zone.order },
  });
  linkLatestEvent(zoneId, "zone_start", "startEventId");
  currentDay.status = "active";
}

function addExtraZone(kind: "alt" | "custom", requestedName?: string): void {
  if (!currentDay || getActiveExtraZone()) return;
  const id = createExtraZoneId(kind);
  const defaultName = kind === "alt" ? getNextAltZoneName() : requestedName?.trim() || "추가 구역";
  const insertOrder = getExtraZoneInsertOrder();
  currentDay.zones = currentDay.zones.map((zone) =>
    zone.order >= insertOrder ? { ...zone, order: zone.order + 1 } : zone,
  );
  ensureZone(id, defaultName, insertOrder);
  addZoneStart(id);
}

function setWorkOrder(orderValue: string): void {
  if (!currentDay || currentDay.zones.length > 0) return;
  const ids = orderValue.split(",").map((value) => value.trim()).filter(Boolean);
  ids.forEach((id, index) => {
    if (id === "alt") {
      ensureZone(createExtraZoneId("alt"), "대체배송", index + 1);
      return;
    }
    ensureZone(id, getZoneName(id), index + 1);
  });
}

function ensureDefaultWorkOrder(): void {
  if (!currentDay || currentDay.zones.length > 0) return;
  ensureZone("miju", "미주", 1);
  ensureZone("hils", "힐스테이트", 2);
}

function addZoneToOrder(kind: "alt" | "custom", requestedName?: string): void {
  if (!currentDay) return;
  const id = createExtraZoneId(kind);
  const name = kind === "alt" ? getNextAltZoneName() : requestedName?.trim() || "추가 구역";
  ensureZone(id, name, getNextZoneOrder());
  normalizeZoneOrders();
}

function skipZone(zoneId: string): void {
  if (!currentDay || hasZoneStarted(zoneId)) return;
  currentDay.zones = currentDay.zones.filter((zone) => zone.id !== zoneId);
  normalizeZoneOrders();
}

function canCancelEmptyStartedExtraZone(zoneId: string): boolean {
  if (!currentDay || !isExtraZone(zoneId) || hasZoneEnded(zoneId)) return false;
  const zoneEvents = currentDay.timeline.filter((event) => event.zoneId === zoneId);
  if (zoneEvents.length !== 1 || zoneEvents[0]?.type !== "zone_start") return false;
  return !currentDay.timeline.some((event) => {
    const payload = event.payload as { sourceZoneId?: unknown } | undefined;
    return payload?.sourceZoneId === zoneId;
  });
}

async function cancelEmptyStartedExtraZone(zoneId: string): Promise<void> {
  if (!currentDay) return;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  if (!zone || !canCancelEmptyStartedExtraZone(zoneId)) {
    toast("이미 작업 기록이 있어 취소할 수 없습니다. 기록 정정에서 수정하세요.");
    return;
  }
  if (!confirm(`${zone.name} 추가를 취소하고 이전 단계로 돌아갈까요?`)) return;
  await savePreparedSnapshot("extra-zone-cancel-before", { kind: "date", date: currentDay.date });
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.filter((event) => event.zoneId !== zoneId),
    zones: currentDay.zones.filter((candidate) => candidate.id !== zoneId),
  };
  normalizeZoneOrders();
  toast(`${zone.name} 추가를 취소했습니다.`);
  await saveAndRender();
}

function moveZone(zoneId: string, direction: -1 | 1): void {
  if (!currentDay || hasZoneStarted(zoneId)) return;
  const ordered = getOrderedZones().filter((zone) => !hasZoneStarted(zone.id));
  const index = ordered.findIndex((zone) => zone.id === zoneId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
  const next = [...ordered];
  const [item] = next.splice(index, 1);
  if (!item) return;
  next.splice(targetIndex, 0, item);
  const orderSlots = ordered.map((zone) => zone.order);
  const updates = new Map(next.map((zone, orderIndex) => [zone.id, orderSlots[orderIndex]!]));
  currentDay.zones = currentDay.zones.map((zone) => updates.has(zone.id) ? { ...zone, order: updates.get(zone.id)! } : zone);
}

function normalizeZoneOrders(): void {
  if (!currentDay) return;
  currentDay.zones = getOrderedZones().map((zone, index) => ({ ...zone, order: index + 1 }));
}

function normalizeZoneOrdersByActualStart(): void {
  if (!currentDay) return;
  currentDay.zones = [...currentDay.zones]
    .sort((a, b) => {
      const aStart = latestZoneEvent(a.id, "zone_start")?.at;
      const bStart = latestZoneEvent(b.id, "zone_start")?.at;
      if (aStart && bStart) {
        const diff = new Date(aStart).getTime() - new Date(bStart).getTime();
        if (diff !== 0) return diff;
      }
      if (aStart && !bStart) return -1;
      if (!aStart && bStart) return 1;
      return a.order - b.order;
    })
    .map((zone, index) => ({ ...zone, order: index + 1 }));
}

function addIncidentEvent(): void {
  if (!currentDay) return;
  const title = readText("#event-title", "기타");
  const scope = readText("#event-scope", "work");
  const minutes = readNumber("#event-minutes", 0);
  const at = readOptionalTimeInput("#event-at") ?? nowIso();
  const note = readText("#event-note", "");
  const zoneId = scope.startsWith("zone:") ? scope.slice("zone:".length) : undefined;
  currentDay = createEvent(currentDay, {
    type: "incident",
    at,
    zoneId,
    payload: {
      title,
      minutes,
      scope,
      affectsEfficiency: true,
    },
    note: note || undefined,
  });
}

function addReceivedHelper(kind: "free_received" | "paid_received"): void {
  if (!currentDay) return;
  const quantityInput = readLimitedNumberField("#helper-received-count", 3);
  const scope = readText("#event-scope", "work");
  const sourceZoneId = scope.startsWith("zone:") ? scope.slice("zone:".length) : undefined;
  if (!sourceZoneId && quantityInput.value <= 0) {
    toast("도우미 배송 수량을 입력하세요.");
    return;
  }
  const label = getHelperKindLabel(kind);
  addReceivedHelperRecord({
    kind,
    quantity: quantityInput.hasValue ? quantityInput.value : undefined,
    at: readOptionalTimeInput("#event-at") ?? nowIso(),
    name: label,
    memo: readText("#event-note", sourceZoneId ? "구역 동행" : ""),
    sourceZoneId,
  });
  toast(sourceZoneId
    ? `${label}${quantityInput.hasValue ? ` ${quantityInput.value}개` : ""} 구역 동행을 기록했습니다.`
    : `${label} ${quantityInput.value}개를 기록했습니다.`);
}

async function applyZoneCorrection(zoneId: string): Promise<void> {
  const kind = readZoneCorrectionKind(zoneId);
  if (!kind) {
    toast("정정 종류를 선택하세요.");
    return;
  }
  await convertCompletedZoneToHelper(zoneId, kind);
}

async function saveSelectedZoneCorrection(zoneId: string): Promise<void> {
  if (!currentDay) return;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) {
    toast("수정할 구역 기록을 찾지 못했습니다.");
    return;
  }
  const kind = readText("#correction-zone-kind", "alt");
  if (kind === "free_received" || kind === "paid_received") {
    await convertCompletedZoneToHelper(zoneId, kind);
    activeCorrectionTargetId = "";
    return;
  }

  const deliveredInput = readLimitedNumberField("#correction-zone-delivered", 3);
  const delivered = resolveCorrectionDelivered(zoneId, deliveredInput.value, deliveredInput.hasValue);
  if (delivered === undefined) return;

  const start = latestZoneEvent(zoneId, "zone_start");
  const deliveryStart = latestZoneEvent(zoneId, "delivery_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const startAt = readChangedTimeInput("#correction-zone-start", start?.at);
  const deliveryStartAt = deliveryStart?.at;
  const endAt = readChangedTimeInput("#correction-zone-end", end?.at);
  const sortingStartAt = readChangedTimeInput("#correction-zone-sorting-start", sortingStart?.at);
  const sortingEndAt = readChangedTimeInput("#correction-zone-sorting-end", sortingEnd?.at);
  const timeError = validateZoneEditTimes(zoneId, { startAt, deliveryStartAt, endAt, sortingStartAt, sortingEndAt });
  if (timeError) {
    toast(timeError);
    return;
  }

  const nextName = resolveCorrectionZoneName(kind, readText("#correction-zone-name", zone.name));
  await savePreparedSnapshot("record-correction-before", { kind: "date", date: currentDay.date });
  currentDay = applyCompletedZoneEdit(currentDay, {
    zoneId,
    startAt,
    deliveryStartAt,
    endAt,
    sortingStartAt,
    sortingEndAt,
    delivered,
    failed: readLimitedNumber("#correction-zone-failed", 3),
    extra: readLimitedNumber("#correction-zone-extra", 3),
    reason: "record_correction_panel",
  });
  ensureDeliveryStartBeforeZoneEnd(zoneId, endAt);
  currentDay = {
    ...currentDay,
    zones: currentDay.zones.map((candidate) =>
      candidate.id === zoneId
        ? {
            ...candidate,
            name: nextName,
            kind: (["miju", "hils", "alt", "custom"].includes(kind) ? kind : "custom") as ZoneKind,
            counts: undefined,
            countsSourceEventIds: undefined,
            countsCalculatedAt: undefined,
          }
        : candidate,
    ),
    timeline: currentDay.timeline.map((event) => {
      if (event.zoneId !== zoneId || !["zone_start", "delivery_start", "sorting_start", "sorting_end", "zone_end"].includes(event.type)) {
        return event;
      }
      const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
      return {
        ...event,
        payload: {
          ...payload,
          zoneName: nextName,
        },
      };
    }),
    meta: {
      ...currentDay.meta,
      updatedAt: nowIso(),
      recoveryStatus: currentDay.meta.recoveryStatus === "none" ? "needsReview" : currentDay.meta.recoveryStatus,
    },
  };
  normalizeZoneOrdersByActualStart();
  activeCorrectionTargetId = `zone:${zoneId}`;
  activeLogEditEventId = "";
  toast(`${nextName} 기록을 다시 저장했습니다.`);
  await saveAndRender();
}

async function saveLogEdit(eventId?: string): Promise<void> {
  if (!currentDay || !eventId) return;
  if (eventId.startsWith("missing-sorting-end-")) {
    await saveLogMissingSortingEndEdit(eventId);
    return;
  }
  const event = currentDay.timeline.find((candidate) => candidate.id === eventId);
  if (!event) {
    activeLogEditEventId = "";
    toast("수정할 로그 원본을 찾지 못했습니다.");
    render();
    return;
  }
  const editKind = getLogEditKind(event);
  if (!editKind) {
    toast("이 항목은 아직 직접 수정 대상이 아닙니다.");
    return;
  }
  if (editKind === "helper") {
    const helper = findLogHelperRecord(event);
    if (!helper) {
      toast("연결된 도우미 기록을 찾지 못했습니다.");
      return;
    }
    activeLogEditEventId = "";
    await saveHelperCorrection(helper.id);
    return;
  }
  if (editKind === "incident") {
    await saveLogIncidentEdit(event);
    return;
  }
  if (editKind === "depart" || editKind === "arrive" || editKind === "day_close") {
    await saveLogCoreEventEdit(event);
    return;
  }
  await saveLogZoneEventEdit(event);
}

async function saveLogMissingSortingEndEdit(editKey: string): Promise<void> {
  if (!currentDay) return;
  const zoneId = editKey.replace(/^missing-sorting-end-/, "");
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  if (!zone || !sortingStart) {
    toast("정리 시작 기록을 찾지 못했습니다.");
    return;
  }
  if (hasZoneEvent(zoneId, "sorting_end")) {
    toast("정리 완료 기록이 이미 있습니다. 기존 로그의 연필로 수정하세요.");
    activeLogEditEventId = "";
    render();
    return;
  }
  const baseId = `log-edit-${editKey}`;
  const at = readRequiredDigitTimeInput(`${baseId}-time`, "정리 완료 시각", sortingStart.at);
  if (!at) return;
  await savePreparedSnapshot("log-inline-before", { kind: "date", date: currentDay.date });
  currentDay = createEvent(currentDay, {
    type: "sorting_end",
    at,
    zoneId,
    note: "로그에서 누락된 정리 완료를 현장 정정으로 추가",
  });
  linkLatestEvent(zoneId, "sorting_end", "sortingEndEventId");
  if (!hasZoneEvent(zoneId, "delivery_start")) {
    currentDay = createEvent(currentDay, { type: "delivery_start", at, zoneId, payload: { afterSorting: true } });
    linkLatestEvent(zoneId, "delivery_start", "deliveryStartEventId");
  }
  currentDay = applyCompletedZoneEdit(currentDay, { zoneId, sortingEndAt: at, reason: "missing_sorting_end_reconcile" });
  const axisIssue = validateTimeAxis(currentDay)[0];
  currentDay = withLogInlineAdjustment(
    currentDay,
    editKey,
    "log_inline_missing_sorting_end_add",
    axisIssue
      ? `정리 완료 누락 추가 · 시간축 경고: ${axisIssue.message}`
      : "정리 완료 누락 추가 · 로그 현장 정정",
  );
  activeLogEditEventId = "";
  toast(axisIssue ? "정리 완료를 저장했습니다. 시간 순서는 정정 이력에서 확인하세요." : "정리 완료를 로그에 추가했습니다.");
  await saveAndRender();
}
async function saveLogCoreEventEdit(event: TimelineEvent): Promise<void> {
  if (!currentDay) return;
  const baseId = `log-edit-${event.id}`;
  const label = event.type === "depart_jinjeop" ? "출발 시각" : event.type === "day_close" ? "업무 종료 시각" : "도착 시각";
  const at = readRequiredDigitTimeInput(`${baseId}-time`, label, event.at);
  if (!at) return;

  if (event.type === "depart_jinjeop") {
    const totalInput = readLimitedNumberField(`#${baseId}-total`, 5);
    const payload = event.payload && typeof event.payload === "object" ? { ...(event.payload as Record<string, unknown>) } : {};
    if (totalInput.hasValue) {
      payload.total = totalInput.value;
    } else {
      delete payload.total;
    }
    await savePreparedSnapshot("log-inline-before", { kind: "date", date: currentDay.date });
    currentDay = applyLinkedEventTime(currentDay, event.id, at);
    currentDay = updateEvent(currentDay, event.id, { payload: { ...currentDay.timeline.find(e => e.id === event.id)?.payload, ...payload } });
  } else {
    await savePreparedSnapshot("log-inline-before", { kind: "date", date: currentDay.date });
    currentDay = applyLinkedEventTime(currentDay, event.id, at);
  }

  const axisIssue = validateTimeAxis(currentDay)[0];
  currentDay = withLogInlineAdjustment(
    currentDay,
    event.id,
    event.type === "depart_jinjeop" ? "log_inline_depart_edit" : event.type === "day_close" ? "log_inline_close_edit" : "log_inline_arrive_edit",
    axisIssue
      ? `${event.type} 수정 · 시간축 경고: ${axisIssue.message}`
      : `${event.type} 수정 · 로그 현장 정정`,
  );
  activeLogEditEventId = "";
  toast("로그 원본 기록을 저장했습니다.");
  await saveAndRender();
}

function readHandlingInput(selector: string): number {
  const value = root.querySelector<HTMLInputElement>(selector)?.value.trim() ?? "";
  if (!/^\d{1,3}$/.test(value)) throw new Error("작업 시간은 0~999분으로 입력하세요. 0분은 적용 취소입니다.");
  return Number(value);
}

let handlingSaveInProgress = false;
async function saveHandlingControl(button: HTMLButtonElement, zoneId: string, cancel: boolean): Promise<void> {
  if (!currentDay || handlingSaveInProgress) return;
  const minutes = cancel ? 0 : readHandlingInput("#handling-minutes");
  const countId = button.dataset.countInput ?? "";
  const countDraft = document.getElementById(countId) as HTMLInputElement | null;
  const draft = countDraft?.value;
  const next = setHandlingMinutes(currentDay, { zoneId, minutes });
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
  const disabledStates = buttons.map((element) => element.disabled);
  handlingSaveInProgress = true;
  buttons.forEach((element) => { element.disabled = true; });
  try {
    await savePreparedSnapshot("handling-before", { kind: "date", date: currentDay.date });
    await store.saveDay(next);
    currentDay = next;
    await refreshHistory();
    render();
    const restored = document.getElementById(countId) as HTMLInputElement | null;
    if (restored && draft !== undefined) restored.value = draft;
    toast(minutes > 0 ? `별도 작업 ${minutes}분을 기록했습니다.` : "별도 작업 시간 적용을 취소했습니다.");
  } finally {
    handlingSaveInProgress = false;
    buttons.forEach((element, index) => { element.disabled = disabledStates[index]!; });
  }
}

async function saveLogIncidentEdit(event: TimelineEvent): Promise<void> {
  if (!currentDay) return;
  const payload = event.payload && typeof event.payload === "object" ? { ...(event.payload as Record<string, unknown>) } : {};
  const baseId = `log-edit-${event.id}`;
  const at = readRequiredDigitTimeInput(`${baseId}-time`, "이벤트 시각", event.at);
  if (!at) return;
  if (isHandlingEvent(event) && event.zoneId) {
    const minutes = readHandlingInput(`#${baseId}-minutes`);
    let next = setHandlingMinutes(currentDay, { zoneId: event.zoneId, minutes });
    next = updateEvent(next, event.id, { at });
    await savePreparedSnapshot("log-inline-before", { kind: "date", date: currentDay.date });
    currentDay = withLogInlineAdjustment(next, event.id, "log_inline_handling_edit", `${HANDLING_TITLE} ${minutes}분`);
    activeLogEditEventId = "";
    await saveAndRender();
    toast(minutes > 0 ? `별도 작업 ${minutes}분으로 수정했습니다.` : "별도 작업 시간 적용을 취소했습니다.");
    return;
  }
  const title = readText(`#${baseId}-title`, typeof payload.title === "string" ? payload.title : "기타");
  const minutesInput = readLimitedNumberField(`#${baseId}-minutes`, 3);
  const scope = readText(`#${baseId}-scope`, typeof payload.scope === "string" ? payload.scope : "work");
  const zoneId = scope.startsWith("zone:") ? scope.slice("zone:".length) : undefined;
  payload.title = title;
  payload.scope = zoneId ? `zone:${zoneId}` : "work";
  if (minutesInput.hasValue) {
    payload.minutes = minutesInput.value;
  } else {
    delete payload.minutes;
  }
  await savePreparedSnapshot("log-inline-before", { kind: "date", date: currentDay.date });
  currentDay = updateEvent(currentDay, event.id, { at, zoneId, payload, note: readText(`#${baseId}-note`, "") || undefined });
  currentDay = withLogInlineAdjustment(currentDay, event.id, "log_inline_incident_edit", `${title} 이벤트 수정`);
  activeLogEditEventId = "";
  toast("이벤트 원본 기록을 저장했습니다.");
  await saveAndRender();
}

async function saveLogZoneEventEdit(event: TimelineEvent): Promise<void> {
  if (!currentDay || !event.zoneId) return;
  const zoneId = event.zoneId;
  const start = latestZoneEvent(zoneId, "zone_start");
  const deliveryStart = latestZoneEvent(zoneId, "delivery_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const baseId = `log-edit-${event.id}`;

  const nextStartAt = event.type === "zone_start" ? readRequiredDigitTimeInput(`${baseId}-time`, "구역 시작 시각", start?.at ?? event.at) : start?.at;
  const nextDeliveryStartAt = event.type === "delivery_start" ? readRequiredDigitTimeInput(`${baseId}-time`, "배송 시작 시각", deliveryStart?.at ?? event.at) : deliveryStart?.at;
  const nextSortingStartAt = event.type === "sorting_start" ? readRequiredDigitTimeInput(`${baseId}-time`, "정리 시작 시각", sortingStart?.at ?? event.at) : sortingStart?.at;
  const nextSortingEndAt = event.type === "sorting_end" ? readRequiredDigitTimeInput(`${baseId}-time`, "정리 완료 시각", sortingEnd?.at ?? event.at) : sortingEnd?.at;
  const nextEndAt = event.type === "zone_end" ? readRequiredDigitTimeInput(`${baseId}-time`, "구역 완료 시각", end?.at ?? event.at) : end?.at;
  if ((event.type === "zone_start" && !nextStartAt) || (event.type === "delivery_start" && !nextDeliveryStartAt) || (event.type === "sorting_start" && !nextSortingStartAt) || (event.type === "sorting_end" && !nextSortingEndAt) || (event.type === "zone_end" && !nextEndAt)) {
    return;
  }

  const updateInput: Parameters<typeof applyCompletedZoneEdit>[1] = { zoneId, reason: "log_inline_zone_edit" };
  const handlingMinutes = event.type === "zone_end" && hasHandlingControl(zoneId)
    ? readHandlingInput(`#${baseId}-handling`) : undefined;
  if (event.type === "zone_start") updateInput.startAt = nextStartAt;
  if (event.type === "delivery_start") updateInput.deliveryStartAt = nextDeliveryStartAt;
  if (event.type === "sorting_start") updateInput.sortingStartAt = nextSortingStartAt;
  if (event.type === "sorting_end") updateInput.sortingEndAt = nextSortingEndAt;
  if (event.type === "zone_end") {
    const deliveredInput = readLimitedNumberField(`#${baseId}-delivered`, 5);
    if (!deliveredInput.hasValue) {
      toast("배송 수량을 입력하세요. 0개도 입력할 수 있습니다.");
      return;
    }
    updateInput.endAt = nextEndAt;
    updateInput.delivered = deliveredInput.value;
    updateInput.failed = readLimitedNumber(`#${baseId}-failed`, 5);
    updateInput.extra = readLimitedNumber(`#${baseId}-extra`, 5);
  }

  await savePreparedSnapshot("log-inline-before", { kind: "date", date: currentDay.date });
  currentDay = applyCompletedZoneEdit(currentDay, updateInput);
  if (handlingMinutes !== undefined && handlingMinutes !== readHandlingMinutes(findHandlingEvent(currentDay, zoneId))) {
    currentDay = setHandlingMinutes(currentDay, { zoneId, minutes: handlingMinutes, at: nextEndAt });
  }
  ensureDeliveryStartBeforeZoneEnd(zoneId, nextEndAt);
  const axisIssue = validateTimeAxis(currentDay)[0];
  currentDay = withLogInlineAdjustment(
    currentDay,
    event.id,
    "log_inline_zone_edit",
    axisIssue
      ? `${event.type} 수정 · 시간축 경고: ${axisIssue.message}`
      : `${event.type} 수정 · 로그 현장 정정`,
  );
  activeLogEditEventId = "";
  toast(axisIssue ? "로그 정정을 저장했습니다. 시간 순서는 정정 이력에서 확인하세요." : "로그 원본 기록을 저장했습니다.");
  await saveAndRender();
}

function withLogInlineAdjustment(dayRecord: DayRecord, eventId: string, reason: string, note: string): DayRecord {
  const createdAt = nowIso();
  return {
    ...dayRecord,
    adjustments: [
      ...dayRecord.adjustments,
      { id: `${reason}-${crypto.randomUUID()}`, eventId, reason, note, createdAt },
    ],
    meta: {
      ...dayRecord.meta,
      updatedAt: createdAt,
      recoveryStatus: dayRecord.meta.recoveryStatus === "none" ? "needsReview" : dayRecord.meta.recoveryStatus,
    },
  };
}

function resolveCorrectionDelivered(zoneId: string, entered: number, hasValue: boolean): number | undefined {
  const mode = readText("#correction-zone-quantity-mode", "actual");
  if (mode !== "cumulative") {
    return resolveValidatedDelivered(zoneId, entered, hasValue, { mode: "actual", riskContext: "block" });
  }
  return resolveValidatedDelivered(zoneId, entered, hasValue, { mode: "cumulative", riskContext: "block" });
}

function resolveCorrectionZoneName(kind: string, enteredName: string): string {
  if (kind === "miju") return "미주";
  if (kind === "hils") return "힐스테이트";
  if (kind === "alt") return enteredName.trim() || "대체배송";
  return enteredName.trim() || "추가구역";
}

async function convertCompletedZoneToHelper(zoneId: string, kind: "free_received" | "paid_received"): Promise<void> {
  if (!currentDay) return;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  const end = latestZoneEvent(zoneId, "zone_end");
  const payload = end?.payload as Record<string, unknown> | undefined;
  const quantity = typeof payload?.delivered === "number" ? payload.delivered : 0;
  if (!zone || !end || quantity <= 0) {
    toast("전환할 완료 기록을 찾지 못했습니다.");
    return;
  }
  const label = getHelperKindLabel(kind);
  if (!confirm(`${zone.name} ${quantity}개를 ${label}으로 전환할까요? 전환 전 백업을 먼저 만듭니다.`)) return;
  await savePreparedSnapshot("helper-convert-before", { kind: "date", date: currentDay.date });
  const sourceZoneSnapshot = captureHelperZone(currentDay, zone);
  const linkedEventIds = sourceZoneSnapshot.timeline.map(event => event.id);
  const removedIds = new Set(linkedEventIds);
  const removedHelpers = new Set(sourceZoneSnapshot.helpers.map(helper => helper.id));
  const at = end.at;
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.filter((event) => !removedIds.has(event.id)),
    helpers: currentDay.helpers.filter(helper => !removedHelpers.has(helper.id)),
    zones: currentDay.zones.filter((candidate) => candidate.id !== zoneId),
    adjustments: [
      ...currentDay.adjustments,
      {
        id: `helper-convert-${crypto.randomUUID()}`,
        eventId: end.id,
        reason: "completed_zone_to_helper",
        note: `${zone.name} ${quantity} -> ${label}`,
        createdAt: nowIso(),
      },
    ],
    meta: {
      ...currentDay.meta,
      updatedAt: nowIso(),
      recoveryStatus: currentDay.meta.recoveryStatus === "none" ? "needsReview" : currentDay.meta.recoveryStatus,
    },
  };
  normalizeZoneOrders();
  addReceivedHelperRecord({
    kind,
    quantity,
    at,
    name: label,
    memo: `${zone.name} 완료 기록에서 전환`,
    sourceZoneId: zoneId,
    sourceZoneSnapshot,
    previousEventIds: linkedEventIds,
  });
  toast(`${label}으로 전환했습니다.`);
  await saveAndRender();
}

async function saveHelperCorrection(helperId?: string): Promise<void> {
  if (!currentDay || !helperId) return;
  const helper = currentDay.helpers.find((candidate) => candidate.id === helperId);
  if (!helper) {
    toast("수정할 도우미 기록을 찾지 못했습니다.");
    return;
  }
  const kind = readHelperCorrectionKind(helperId);
  const quantity = readHelperCorrectionQuantity(helperId);
  const at = readHelperCorrectionAt(helperId);
  const linkedIds = new Set(helper.linkedEventIds);
  const helperEvent = currentDay.timeline.find((event) => event.type === "helper_add" && linkedIds.has(event.id));
  const isZoneContribution = hasHelperSourceZone(helperEvent);
  if (!kind) {
    toast("도우미 종류를 선택하세요.");
    return;
  }
  if (quantity <= 0 && !isZoneContribution) {
    toast("도우미 배송 수량을 입력하세요.");
    return;
  }
  if (!at) {
    toast("도우미 기록 시각을 입력하세요.");
    return;
  }
  const label = getHelperKindLabel(kind);
  await savePreparedSnapshot("helper-correction-before", { kind: "date", date: currentDay.date });
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.map((event) => {
      if (event.type !== "helper_add" || !linkedIds.has(event.id)) return event;
      const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
      const nextPayload: Record<string, unknown> = {
        ...payload,
        name: label,
        helperKind: kind,
        countsForEfficiency: kind === "paid_received",
      };
      if (quantity > 0) {
        nextPayload.quantity = quantity;
      } else {
        delete nextPayload.quantity;
      }
      return {
        ...event,
        at,
        payload: nextPayload,
      };
    }),
    helpers: currentDay.helpers.map((candidate) => candidate.id === helperId
      ? {
          ...candidate,
          name: label,
          kind,
          quantity: quantity > 0 ? quantity : undefined,
          countsForEfficiency: kind === "paid_received",
          memo: candidate.memo
            ? `${candidate.memo} / 재수정: ${label}${quantity > 0 ? ` ${quantity}개` : " 수량 미기록"}`
            : `재수정: ${label}${quantity > 0 ? ` ${quantity}개` : " 수량 미기록"}`,
        }
      : candidate),
    adjustments: [
      ...currentDay.adjustments,
      {
        id: `helper-correction-${crypto.randomUUID()}`,
        eventId: helper.linkedEventIds[0],
        reason: "helper_record_correction",
        note: `${helper.name} -> ${label}${quantity > 0 ? ` ${quantity}개` : " 수량 미기록"}`,
        createdAt: nowIso(),
      },
    ],
    meta: {
      ...currentDay.meta,
      updatedAt: nowIso(),
      recoveryStatus: currentDay.meta.recoveryStatus === "none" ? "needsReview" : currentDay.meta.recoveryStatus,
    },
  };
  toast(`${label}${quantity > 0 ? ` ${quantity}개` : " 수량 미기록"}로 다시 저장했습니다.`);
  await saveAndRender();
}

async function addCorrectionHelper(): Promise<void> {
  if (!currentDay) return;
  const kind = normalizeReceivedHelperKind(readText("#correction-helper-kind", "free_received"));
  const quantityInput = readLimitedNumberField("#correction-helper-quantity", 3);
  const at = readOptionalTimeInput("#correction-helper-at")
    ?? currentDay.timeline.find((event) => event.type === "day_close")?.at
    ?? currentDay.timeline.at(-1)?.at
    ?? nowIso();
  if (!kind) {
    toast("도우미 종류를 선택하세요.");
    return;
  }
  if (!quantityInput.hasValue || quantityInput.value <= 0) {
    toast("누락 도우미 수량을 입력하세요.");
    return;
  }
  const label = getHelperKindLabel(kind);
  await savePreparedSnapshot("helper-add-correction-before", { kind: "date", date: currentDay.date });
  addReceivedHelperRecord({
    kind,
    quantity: quantityInput.value,
    at,
    name: label,
    memo: readText("#correction-helper-note", "기록 정정에서 추가"),
  });
  activeCorrectionTargetId = "";
  toast(`${label} ${quantityInput.value}개를 추가했습니다.`);
  await saveAndRender();
}

async function restoreHelperToZone(helperId?: string): Promise<void> {
  if (!currentDay || !helperId) return;
  const helper = currentDay.helpers.find((candidate) => candidate.id === helperId);
  if (!helper) {
    toast("복구할 도우미 기록을 찾지 못했습니다.");
    return;
  }
  const linkedIds = new Set(helper.linkedEventIds);
  const event = currentDay.timeline.find((candidate) => candidate.type === "helper_add" && linkedIds.has(candidate.id));
  const payload = event?.payload as Record<string, unknown> | undefined;
  const quantity = typeof helper.quantity === "number"
    ? helper.quantity
    : typeof payload?.quantity === "number"
      ? payload.quantity
      : 0;
  if (!event || quantity <= 0) {
    toast("복구할 수량 기록을 찾지 못했습니다.");
    return;
  }
  const target = readHelperZoneRestoreTarget(helperId) ?? "alt";
  const zoneId = createRestoredZoneId(target);
  const zoneName = getRestoredZoneName(target);
  if (!confirm(`${helper.name} ${quantity}개를 ${zoneName} 구역 기록으로 복구할까요? 복구 전 백업을 먼저 만듭니다.`)) return;
  await savePreparedSnapshot("helper-restore-before", { kind: "date", date: currentDay.date });
  const restored = restoreConvertedHelperZone(currentDay, helper, event, target === "miju" ? "miju" : target === "hils" ? "hils" : "alt", quantity);
  if (restored) {
    assertDayRecord(restored, "복구할 구역 원본");
    currentDay = restored;
    normalizeZoneOrdersByActualStart();
    activeCorrectionTargetId = `zone:${(payload?.sourceZoneSnapshot as HelperZoneSnapshot).zone.id}`;
    toast("원래 구역의 시간과 상세 기록을 복구했습니다.");
    await saveAndRender();
    return;
  }
  const endAt = event.at;
  // Old helpers have no original interval. Keep efficiency unknown until edited.
  const startAt = endAt;
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.filter((candidate) => !linkedIds.has(candidate.id)),
    helpers: currentDay.helpers.filter((candidate) => candidate.id !== helperId),
    adjustments: [
      ...currentDay.adjustments,
      {
        id: `helper-restore-${crypto.randomUUID()}`,
        eventId: event.id,
        reason: "helper_to_zone_restore",
        note: `${helper.name} ${quantity}개 -> ${zoneName}`,
        createdAt: nowIso(),
      },
    ],
    meta: {
      ...currentDay.meta,
      updatedAt: nowIso(),
      recoveryStatus: "needsReview",
    },
  };
  const zone = ensureZone(zoneId, zoneName, getNextZoneOrder());
  currentDay = createEvent(currentDay, { type: "zone_start", zoneId: zone.id, at: startAt });
  currentDay = createEvent(currentDay, { type: "delivery_start", zoneId: zone.id, at: startAt });
  currentDay = createEvent(currentDay, {
    type: "zone_end",
    zoneId: zone.id,
    at: endAt,
    payload: {
      delivered: quantity,
      failed: 0,
      extra: 0,
      reviewedLater: true,
      restoredFromHelperId: helperId,
    },
    note: "원본 시작 시각이 없는 도우미 기록에서 복구됨. 로그에서 실제 시작 시각 정정 필요.",
  });
  normalizeZoneOrdersByActualStart();
  toast(`${zoneName} ${quantity}개를 복구했습니다. 원본 시작 시각이 없어 효율은 미확정입니다. 로그에서 시작 시각을 고쳐주세요.`);
  await saveAndRender();
}

function addReceivedHelperRecord(input: {
  kind: "free_received" | "paid_received";
  quantity?: number;
  at: string;
  name: string;
  memo?: string;
  sourceZoneId?: string;
  sourceZoneSnapshot?: HelperZoneSnapshot;
  previousEventIds?: string[];
}): void {
  if (!currentDay) return;
  const helperId = `helper-${input.kind}-${crypto.randomUUID()}`;
  const helperEventId = `helper-event-${input.kind}-${crypto.randomUUID()}`;
  currentDay = createEvent(currentDay, {
    id: helperEventId,
    type: "helper_add",
    at: input.at,
    payload: {
      helperId,
      name: input.name,
      action: "add",
      helperKind: input.kind,
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      countsForEfficiency: input.kind === "paid_received",
      sourceZoneId: input.sourceZoneId,
      ...(input.sourceZoneSnapshot ? { sourceZoneSnapshot: input.sourceZoneSnapshot } : {}),
    },
    note: input.memo || undefined,
  });
  currentDay.helpers = [
    ...currentDay.helpers,
    {
      id: helperId,
      name: input.name,
      linkedEventIds: [helperEventId, ...(input.previousEventIds ?? [])],
      memo: input.memo,
      kind: input.kind,
      quantity: input.quantity,
      countsForEfficiency: input.kind === "paid_received",
    },
  ];
}

function saveMijuCheckpoint(zoneId = getCurrentWorkZone()?.id ?? "miju"): void {
  if (!currentDay) return;
  const parts = readMijuInputParts();
  if (parts.one + parts.two + parts.three <= 0) {
    toast("1/2/3동 수량을 먼저 입력하세요.");
    return;
  }
  const aTotal = parts.one + parts.two + parts.three;
  currentDay = createEvent(currentDay, {
    type: "manual_adjust",
    at: nowIso(),
    zoneId,
    payload: {
      reason: "miju_a_checkpoint",
      building1Total: parts.one,
      building2Total: parts.two,
      building3Total: parts.three,
      restTotal: parts.rest,
      aTotal,
      total: aTotal + parts.rest,
    },
  });
  toast(`A구간 저장: ${aTotal}개`);
}

function clearMijuCheckpoint(zoneId = getCurrentWorkZone()?.id ?? "miju"): void {
  if (!currentDay) return;
  formDrafts.clearFields(renderedFormKey, ["#miju-1-count", "#miju-2-count", "#miju-3-count"]);
  root.querySelectorAll<HTMLInputElement>(".building-grid input").forEach(input => { input.value = ""; });
  currentDay = createEvent(currentDay, {
    type: "manual_adjust",
    at: nowIso(),
    zoneId,
    payload: {
      reason: "miju_a_checkpoint_clear",
    },
  });
  toast("A구간 저장값을 초기화했습니다.");
}

function addZoneEvent(type: "sorting_start" | "sorting_end", zoneId: string): void {
  if (!currentDay || hasZoneEvent(zoneId, type)) return;
  ensureZone(zoneId);
  currentDay = createEvent(currentDay, { type, at: resolveZoneEventAt(type, zoneId), zoneId });
  linkLatestEvent(zoneId, type, type === "sorting_start" ? "sortingStartEventId" : "sortingEndEventId");
  if (type === "sorting_end" && !hasZoneEvent(zoneId, "delivery_start")) {
    currentDay = createEvent(currentDay, { type: "delivery_start", at: latestZoneEvent(zoneId, "sorting_end")!.at, zoneId, payload: { afterSorting: true } });
    linkLatestEvent(zoneId, "delivery_start", "deliveryStartEventId");
  }
}

function ensureDeliveryStartBeforeZoneEnd(zoneId: string, endAt: string | undefined): void {
  if (!currentDay || !endAt || hasZoneEvent(zoneId, "delivery_start")) return;

  const resolution = resolveMissingDeliveryStart({
    endAt,
    sortingEndAt: latestZoneEvent(zoneId, "sorting_end")?.at,
    previousEndAt: getPreviousZoneEndAt(zoneId),
    zoneStartAt: latestZoneEvent(zoneId, "zone_start")?.at,
    arriveAt: currentDay.timeline.find((event) => event.type === "arrive_cheongnyangni")?.at,
  });

  currentDay = createEvent(currentDay, {
    type: "delivery_start",
    at: resolution.at,
    zoneId,
    payload: { autoCorrected: true, correctionReason: resolution.correctionReason },
    note: "배송 시작 누락 자동 보정",
  });
  linkLatestEvent(zoneId, "delivery_start", "deliveryStartEventId");
}

function addDeliveryStart(zoneId: string): void {
  if (!currentDay || hasZoneEvent(zoneId, "delivery_start")) return;
  ensureZone(zoneId);
  currentDay = createEvent(currentDay, { type: "delivery_start", at: nowIso(), zoneId });
  linkLatestEvent(zoneId, "delivery_start", "deliveryStartEventId");
}

async function addZoneEnd(zoneId: string): Promise<void> {
  if (!currentDay || hasZoneEnded(zoneId)) return;
  if (!validateWorkDigits()) return;
  ensureZone(zoneId);
  if (!isMijuZone(zoneId) && !hasZoneEvent(zoneId, "sorting_start") && !hasZoneEvent(zoneId, "delivery_start")) {
    toast("정리 시작 또는 바로 배송 시작을 먼저 선택하세요.");
    return;
  }
  if (hasZoneEvent(zoneId, "sorting_start") && !hasZoneEvent(zoneId, "sorting_end")) {
    toast("정리 완료를 먼저 기록해야 합니다.");
    return;
  }

  const mijuInput = isMijuZone(zoneId) ? readMijuInputParts() : undefined;
  const deliveredInput = isMijuZone(zoneId) ? undefined : readZoneDelivered(zoneId);
  if (isMijuZone(zoneId) && mijuInput?.hasDetail && !mijuInput.totalHasValue) {
    toast("미주 전체 수량을 입력해야 나머지를 자동 계산할 수 있습니다.");
    return;
  }
  const rawDelivered = mijuInput?.total ?? deliveredInput?.value ?? 0;
  const hasValue = mijuInput ? mijuInput.totalHasValue || mijuInput.hasDetail : Boolean(deliveredInput?.hasValue);
  const delivered = resolveValidatedDelivered(zoneId, rawDelivered, hasValue, { mijuInput, mode: "cumulative" });
  if (delivered === undefined) return;
  completeZoneEnd(zoneId, delivered, { mijuInput });
}

function completeZoneEnd(
  zoneId: string,
  delivered: number,
  options: { mijuInput?: MijuInputParts; overrideReason?: string; enteredQuantity?: number } = {},
): void {
  if (!currentDay) return;
  const endAt = nowIso();
  const zone = ensureZone(zoneId);
  const mijuInput = options.mijuInput;
  const mijuParts = mijuInput ? buildMijuPartsFromZoneTotal(mijuInput, delivered) : undefined;
  if (mijuParts?.ok === false) {
    toast(mijuParts.message ?? "미주 수량을 확인하세요.");
    return;
  }
  ensureDeliveryStartBeforeZoneEnd(zoneId, endAt);
  currentDay = createEvent(currentDay, {
    type: "zone_end",
    at: endAt,
    zoneId,
    payload: {
      total: delivered,
      delivered,
      failed: 0,
      extra: 0,
      zoneName: zone.name,
      ...(options.overrideReason
        ? {
            quantityOverride: true,
            quantityOverrideReason: options.overrideReason,
            enteredQuantity: options.enteredQuantity,
          }
        : {}),
      ...(mijuParts
        ? {
            building1Total: mijuParts.one,
            building2Total: mijuParts.two,
            building3Total: mijuParts.three,
            restTotal: mijuParts.rest,
            aTotal: mijuParts.aTotal,
            bTotal: mijuParts.rest,
            detailMode: mijuParts.hasDetail,
          }
        : {}),
    },
  });
  linkLatestEvent(zoneId, "zone_end", "endEventId");
  pendingQuantityRisk = null;
}

async function applyPendingQuantityRisk(mode: "adjusted" | "actual" | "override"): Promise<void> {
  if (!currentDay || !pendingQuantityRisk) return;
  const risk = pendingQuantityRisk;
  const value = mode === "adjusted" ? risk.adjustedValue : risk.entered;
  if (value === undefined || value <= 0) {
    toast("저장할 수량을 다시 확인하세요.");
    return;
  }
  completeZoneEnd(risk.zoneId, value, {
    mijuInput: risk.mijuInput,
    enteredQuantity: risk.entered,
    overrideReason: mode === "override"
      ? `위험 수량 예외 저장: ${risk.warning}`
      : mode === "actual"
        ? `위험 수량 실제 수량 확인 저장: ${risk.warning}`
        : undefined,
  });
  await saveAndRender();
}

async function correctCleanup(zoneId?: string): Promise<void> {
  if (!currentDay || !zoneId) return;
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  if (!sortingStart) return;
  const minutes = readNumber("#cleanup-input", 30);
  const result = applyMissingCleanupCorrection(currentDay, {
    zoneId,
    closeAt: addMinutes(sortingStart.at, minutes),
    minutes,
    source: "zone_close_prompt",
  });
  currentDay = result.dayRecord;
  const delivery = latestZoneEvent(zoneId, "delivery_start");
  if (delivery) currentDay = applyLinkedEventTime(currentDay, delivery.id, result.sortingEndAt);
  else {
    currentDay = createEvent(currentDay, { type: "delivery_start", at: result.sortingEndAt, zoneId, payload: { afterSorting: true } });
    linkLatestEvent(zoneId, "delivery_start", "deliveryStartEventId");
  }
  await saveAndRender();
}

async function saveCompletedZoneEdit(zoneId: string): Promise<void> {
  if (!currentDay) return;
  const mijuEditInput = isMijuZone(zoneId) ? readMijuEditInputParts(zoneId) : undefined;
  const deliveredInput = isMijuZone(zoneId) ? undefined : readLimitedNumberField(`#edit-${zoneId}-delivered`, 3);
  const rawDelivered = mijuEditInput?.total ?? deliveredInput?.value ?? 0;
  const hasValue = mijuEditInput ? mijuEditInput.totalHasValue || mijuEditInput.hasDetail : Boolean(deliveredInput?.hasValue);
  const delivered = resolveValidatedDelivered(zoneId, rawDelivered, hasValue, { riskContext: "block" });
  if (delivered === undefined) return;
  const editParts = mijuEditInput ? buildMijuPartsFromZoneTotal(mijuEditInput, delivered) : undefined;
  if (editParts?.ok === false) {
    toast(editParts.message ?? "수정 수량을 확인하세요.");
    return;
  }
  const start = latestZoneEvent(zoneId, "zone_start");
  const deliveryStart = latestZoneEvent(zoneId, "delivery_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const startAt = readOptionalTimeInput(`#edit-${zoneId}-start`, start?.at);
  const deliveryStartAt = deliveryStart?.at;
  const endAt = readOptionalTimeInput(`#edit-${zoneId}-end`, end?.at);
  const sortingStartAt = readOptionalTimeInput(`#edit-${zoneId}-sorting-start`, sortingStart?.at);
  const sortingEndAt = readOptionalTimeInput(`#edit-${zoneId}-sorting-end`, sortingEnd?.at);
  const timeError = validateZoneEditTimes(zoneId, { startAt, deliveryStartAt, endAt, sortingStartAt, sortingEndAt });
  if (timeError) {
    toast(timeError);
    return;
  }
  await savePreparedSnapshot("zone-edit-before", { kind: "date", date: currentDay.date });
  currentDay = applyCompletedZoneEdit(currentDay, {
    zoneId,
    startAt,
    deliveryStartAt,
    endAt,
    sortingStartAt,
    sortingEndAt,
    delivered,
    failed: readLimitedNumber(`#edit-${zoneId}-failed`, 3),
    extra: readLimitedNumber(`#edit-${zoneId}-extra`, 3),
    miju1: editParts?.hasDetail ? editParts.one : undefined,
    miju2: editParts?.hasDetail ? editParts.two : undefined,
    miju3: editParts?.hasDetail ? editParts.three : undefined,
    mijuRest: editParts?.hasDetail ? editParts.rest : undefined,
    reason: "completed_zone_edit_from_app",
  });
  ensureDeliveryStartBeforeZoneEnd(zoneId, endAt);
  toast("완료 구역 수정이 저장됐습니다.");
  await saveAndRender();
}

function validateZoneEditTimes(zoneId: string, input: {
  startAt?: string;
  deliveryStartAt?: string;
  endAt?: string;
  sortingStartAt?: string;
  sortingEndAt?: string;
}): string | undefined {
  // Validate the linked candidate, never the stale counterpart still in the form.
  if (currentDay) {
    let candidate: DayRecord;
    try { candidate = applyCompletedZoneEdit(currentDay, {
      zoneId,
      startAt: input.startAt,
      deliveryStartAt: input.deliveryStartAt,
      sortingStartAt: input.sortingStartAt,
      sortingEndAt: input.sortingEndAt,
      endAt: input.endAt,
      reason: "time_axis_preview",
    }); } catch (error) { return error instanceof Error ? error.message : "연결된 시각을 확인하세요."; }
    const axisIssue = validateTimeAxis(candidate)[0];
    if (axisIssue) return axisIssue.message;
  }
  return undefined;
}

function isAfter(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return new Date(left).getTime() > new Date(right).getTime();
}

function isBefore(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return new Date(left).getTime() < new Date(right).getTime();
}

function getPreviousZoneEndAt(zoneId: string): string | undefined {
  if (!currentDay) return undefined;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return undefined;
  const previousZone = [...currentDay.zones]
    .filter((candidate) => candidate.order < zone.order)
    .sort((a, b) => b.order - a.order)[0];
  return previousZone ? latestZoneEvent(previousZone.id, "zone_end")?.at : undefined;
}

function getNextZoneStartAt(zoneId: string): string | undefined {
  if (!currentDay) return undefined;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return undefined;
  const nextZone = [...currentDay.zones]
    .filter((candidate) => candidate.order > zone.order)
    .sort((a, b) => a.order - b.order)[0];
  return nextZone ? latestZoneEvent(nextZone.id, "zone_start")?.at : undefined;
}

function removeMissingCleanup(zoneId?: string): void {
  if (!currentDay || !zoneId) return;
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  if (!sortingStart) return;
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.filter((event) => event.id !== sortingStart.id),
    zones: currentDay.zones.map((zone) =>
      zone.id === zoneId
        ? { ...zone, sortingStartEventId: undefined, sortingEndEventId: undefined }
        : zone,
    ),
  };
}

function mustCorrectCleanupBeforeClose(): boolean {
  if (!currentDay) return false;
  return currentDay.zones.some((zone) => hasMissingCleanupFinish(currentDay!, zone.id));
}

function ensureZone(zoneId: string, name = getZoneName(zoneId), order = getDefaultZoneOrder(zoneId)): ZoneRecord {
  if (!currentDay) throw new Error("No current day");
  const existing = currentDay.zones.find((zone) => zone.id === zoneId);
  if (existing) return existing;
  const zone = { id: zoneId, name, order };
  currentDay.zones.push(zone);
  return zone;
}

function linkLatestEvent(
  zoneId: string,
  type: TimelineEventType,
  field: "startEventId" | "sortingStartEventId" | "sortingEndEventId" | "deliveryStartEventId" | "endEventId",
): void {
  if (!currentDay) return;
  const event = latestZoneEvent(zoneId, type);
  currentDay.zones = currentDay.zones.map((zone) => zone.id === zoneId && event ? { ...zone, [field]: event.id } : zone);
}

function latestZoneEvent(zoneId: string, type: TimelineEventType): TimelineEvent | undefined {
  if (!currentDay) return undefined;
  return [...currentDay.timeline].reverse().find((event) => event.zoneId === zoneId && event.type === type);
}

function hasEvent(type: TimelineEventType): boolean {
  return currentDay?.timeline.some((event) => event.type === type) ?? false;
}

function hasZoneEvent(zoneId: string, type: TimelineEventType): boolean {
  return currentDay?.timeline.some((event) => event.zoneId === zoneId && event.type === type) ?? false;
}

function hasZoneStarted(zoneId: string): boolean {
  return hasZoneEvent(zoneId, "zone_start");
}

function hasAnyZoneStarted(): boolean {
  return currentDay?.zones.some((zone) => hasZoneStarted(zone.id)) ?? false;
}

function hasZoneEnded(zoneId: string): boolean {
  return hasZoneEvent(zoneId, "zone_end");
}

function isUnpaidHelperDay(dayRecord: DayRecord): boolean {
  const depart = dayRecord.timeline.find((event) => event.type === "depart_jinjeop");
  return Boolean(
    depart &&
      typeof depart.payload === "object" &&
      depart.payload &&
      (depart.payload as Record<string, unknown>).total === 0,
  );
}

function diffMinutesFromIso(start: string, end: string): number | undefined {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;
  return Math.round((endMs - startMs) / 60000);
}

function findLatestZoneCloseAt(dayRecord: DayRecord, zoneId: string): string | undefined {
  return [...dayRecord.timeline].reverse().find((event) => event.zoneId === zoneId && event.type === "zone_end")?.at;
}

function resolveZoneEventAt(type: "sorting_start" | "sorting_end", zoneId: string): string {
  if (type === "sorting_end") {
    const sortingStart = latestZoneEvent(zoneId, "sorting_start");
    const now = nowIso();
    return sortingStart && Date.parse(sortingStart.at) > Date.parse(now) ? sortingStart.at : now;
  }
  if (isMijuZone(zoneId)) return nowIso();
  const previousEndAt = getPreviousZoneEndAt(zoneId);
  if (!previousEndAt) return nowIso();
  const previousEnd = new Date(previousEndAt);
  if (Number.isNaN(previousEnd.getTime())) return nowIso();
  const diffMinutes = (Date.now() - previousEnd.getTime()) / 60000;
  return diffMinutes < 1 ? addMinutes(previousEndAt, 5) : nowIso();
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}

async function saveAndRender(): Promise<void> {
  if (!currentDay) return;
  currentDay.meta.updatedAt = nowIso();
  await store.saveDay(currentDay);
  await refreshHistory();
  if (["save-log-edit", "save-zone-edit", "apply-zone-correction"].includes(currentAction)) discardFormDraft();
  if (currentAction === "add-event") {
    formDrafts.capture(root, renderedFormKey);
    formDrafts.clearFields(renderedFormKey, ["#event-title", "#event-scope", "#event-at", "#event-minutes", "#event-note"]);
    discardDraftOnRender = true;
  }
  render();
}

async function refreshHistory(): Promise<void> {
  const summaries = await store.listDates();
  historyReadErrors = [];
  const days = await Promise.all(summaries.map(async (summary) => {
    try { return await store.getDay(summary.date); }
    catch { historyReadErrors.push(summary.date); return undefined; }
  }));
  historyDays = days.filter((day): day is DayRecord => Boolean(day));
}

async function importFieldBackupFile(): Promise<void> {
  const file = await platform.pickTextFile();
  if (!file) return;

  let recognizedDays = 0;
  let snapshotCreated = false;
  let receipt: ImportFeedback | null = null;
  try {
    const data = readJsonText(file.text);
    const migration = buildFieldAppMigrationBackup(data, { appVersion: APP_VERSION });
    recognizedDays = migration.backup.days.length;
    if (recognizedDays === 0) {
      lastImportFeedback = {
        fileName: file.name,
        recognizedDays,
        importedCount: 0,
        skippedCount: 0,
        importedDates: [],
        skippedDates: [],
        message: "현장앱 백업에서 가져올 날짜를 찾지 못했습니다.",
        snapshotCreated: false,
        backupExported: false,
      };
      render();
      return;
    }

    const firstDate = migration.backup.days[0]?.date ?? "-";
    const lastDate = migration.backup.days.at(-1)?.date ?? "-";
    const ok = confirm(
      `현장앱 백업에서 ${recognizedDays}일치를 찾았습니다.\n기간: ${firstDate} ~ ${lastDate}\n\n가져오기 전후 안전 스냅샷은 앱 내부에 자동 보관합니다.\n빈 오늘 기록은 가져온 기록으로 자동 보정하고, 실제 기록이 있는 날짜는 복사본으로 보호합니다.`,
    );
    if (!ok) {
      lastImportFeedback = {
        fileName: file.name,
        recognizedDays,
        importedCount: 0,
        skippedCount: 0,
        importedDates: [],
        skippedDates: [],
        message: "사용자가 가져오기를 취소했습니다.",
        snapshotCreated: false,
        backupExported: false,
      };
      render();
      return;
    }

    const beforeBackup = await store.createBackup({ kind: "all" });
    await platform.saveJsonSnapshot(beforeBackup, buildBackupFilename("before-import"));

    snapshotCreated = true;
    const result = await applyFieldImportWithAutoCorrection(migration.backup.days);
    result.importedDates.forEach((date) => formDrafts.clearDate(date));
    discardDraftOnRender = true;
    receipt = { fileName: file.name, recognizedDays, importedCount: result.importedDates.length, skippedCount: result.protectedDates.length, importedDates: result.importedDates, skippedDates: result.protectedDates, message: "기록 반영 완료", snapshotCreated: true, backupExported: false };
    await loadToday();

    const afterBackup = await store.createBackup({ kind: "all" });
    await platform.saveJsonSnapshot(afterBackup, buildBackupFilename("after-import"));

    lastImportFeedback = {
      fileName: file.name,
      recognizedDays,
      importedCount: result.importedDates.length,
      skippedCount: result.protectedDates.length,
      importedDates: result.importedDates,
      skippedDates: result.protectedDates,
      message: result.importedDates.length > 0
        ? "현장앱 백업을 개발앱 기록으로 가져왔습니다. 빈 오늘 기록은 자동으로 보정했습니다."
        : "가져온 기록이 없습니다. 파일 형식을 확인하세요.",
      snapshotCreated: true,
      backupExported: true,
      activeDate: currentDay?.date,
    };
    toast(`현장앱 백업 가져오기 완료: ${result.importedDates.length}일`);
    render();
  } catch (error) {
    if (receipt) {
      lastImportFeedback = { ...receipt, message: "기록 반영은 완료됐습니다. 후속 화면 갱신/안전 사본 확인 필요: " + (error instanceof Error ? error.message : "후속 처리 실패") };
      render();
      toast("기록은 반영됐습니다. 복구 결과의 확인 필요 항목을 확인하세요.");
      return;
    }
    lastImportFeedback = {
      fileName: file.name,
      recognizedDays,
      importedCount: 0,
      skippedCount: 0,
      importedDates: [],
      skippedDates: [],
      message: error instanceof Error ? error.message : "현장앱 백업 가져오기 실패",
      snapshotCreated,
      backupExported: false,
    };
    render();
    toast(error instanceof Error ? error.message : "현장앱 백업 가져오기 실패");
  }
}

async function importPhoneInstallBackupFile(): Promise<void> {
  const file = await platform.pickTextFile();
  if (!file) return;

  let recognizedDays = 0;
  let snapshotCreated = false;
  let receipt: ImportFeedback | null = null;
  try {
    const data = readJsonText(file.text);
    assertPhoneInstallBackup(data);
    const backup = normalizePhoneInstallBackup(data);
    recognizedDays = backup.days.length;
    if (recognizedDays === 0) {
      lastImportFeedback = {
        title: "개발앱 백업 복구 결과",
        fileName: file.name,
        recognizedDays,
        importedCount: 0,
        skippedCount: 0,
        importedDates: [],
        skippedDates: [],
        message: "개발앱 백업에서 복구할 날짜를 찾지 못했습니다.",
        snapshotCreated: false,
        backupExported: false,
      };
      render();
      return;
    }

    const storedDates = new Set((await store.listDates()).map((item) => item.date));
    const existingDates = backup.days.filter((day) => storedDates.has(day.date)).map((day) => day.date);
    const firstDate = backup.days[0]?.date ?? "-";
    const lastDate = backup.days.at(-1)?.date ?? "-";
    const ok = confirm(
      `개발앱 백업에서 ${recognizedDays}일치를 찾았습니다.\n기간: ${firstDate} ~ ${lastDate}\n\n복구 전후 안전 스냅샷은 앱 내부에 자동 보관합니다.`,
    );
    if (!ok) {
      lastImportFeedback = {
        title: "개발앱 백업 복구 결과",
        fileName: file.name,
        recognizedDays,
        importedCount: 0,
        skippedCount: 0,
        importedDates: [],
        skippedDates: [],
        message: "사용자가 복구를 취소했습니다.",
        snapshotCreated: false,
        backupExported: false,
      };
      render();
      return;
    }

    const overwrite = existingDates.length > 0
      ? confirm(
        `이미 있는 날짜가 있습니다.\n\n${existingDates.join(", ")}\n\n확인: 기존 날짜 덮어쓰기\n취소: 기존 날짜는 유지하고 없는 날짜만 가져오기`,
      )
      : false;
    const mode = overwrite ? "overwrite" : "skip";

    const beforeBackup = await store.createBackup({ kind: "all" });
    await platform.saveJsonSnapshot(beforeBackup, buildBackupFilename(`before-phone-${mode}`));

    snapshotCreated = true;
    const result = await store.importBackup(backup, { mode });
    result.imported.forEach((item) => formDrafts.clearDate(item.date));
    discardDraftOnRender = true;
    receipt = { title: "인스톨 앱 복구 결과", fileName: file.name, recognizedDays, importedCount: result.imported.length, skippedCount: result.skipped.length, importedDates: result.imported.map((item) => item.date), skippedDates: result.skipped.map((item) => item.date), message: "기록 반영 완료", snapshotCreated: true, backupExported: false };
    await loadToday();

    const afterBackup = await store.createBackup({ kind: "all" });
    await platform.saveJsonSnapshot(afterBackup, buildBackupFilename(`after-phone-${mode}`));

    lastImportFeedback = {
      title: "개발앱 백업 복구 결과",
      fileName: file.name,
      recognizedDays,
      importedCount: result.imported.length,
      skippedCount: result.skipped.length,
      importedDates: result.imported.map((item) => item.date),
      skippedDates: result.skipped.map((item) => `${item.date}: ${item.reason}`),
      message: mode === "overwrite"
        ? "개발앱 백업을 기존 날짜에 덮어써 복구했습니다."
        : "기존 날짜는 유지하고 없는 날짜만 가져왔습니다.",
      snapshotCreated: true,
      backupExported: true,
      activeDate: currentDay?.date,
    };
    toast(`개발앱 백업 복구 완료: ${result.imported.length}일`);
    render();
  } catch (error) {
    if (receipt) {
      lastImportFeedback = { ...receipt, message: "기록 반영은 완료됐습니다. 후속 화면 갱신/안전 사본 확인 필요: " + (error instanceof Error ? error.message : "후속 처리 실패") };
      render();
      toast("기록은 반영됐습니다. 복구 결과의 확인 필요 항목을 확인하세요.");
      return;
    }
    lastImportFeedback = {
      title: "개발앱 백업 복구 결과",
      fileName: file.name,
      recognizedDays,
      importedCount: 0,
      skippedCount: 0,
      importedDates: [],
      skippedDates: [],
      message: error instanceof Error ? error.message : "개발앱 백업 복구 실패",
      snapshotCreated,
      backupExported: false,
    };
    render();
    toast(error instanceof Error ? error.message : "개발앱 백업 복구 실패");
  }
}

interface AutoImportResult {
  importedDates: string[];
  protectedDates: string[];
}

async function applyFieldImportWithAutoCorrection(days: DayRecord[]): Promise<AutoImportResult> {
  const planned: DayRecord[] = [];
  const protectedDates: string[] = [];
  const reserved = new Set<string>();
  for (const incoming of days) {
    let unreadable = false;
    const existing = await store.getDay(incoming.date).catch(() => { unreadable = true; return null; });
    if ((!existing && !unreadable) || (existing && isAutoReplaceableEmptyDay(existing))) {
      planned.push({ ...incoming, meta: { ...incoming.meta, updatedAt: nowIso(), recoveryStatus: existing ? "needsReview" : incoming.meta.recoveryStatus } });
      reserved.add(incoming.date);
      continue;
    }
    const copy = createBackupCopyDay(incoming);
    const base = copy.date;
    let suffix = 1;
    const storedDates = new Set((await store.listDates()).map((item) => item.date));
    while (reserved.has(copy.date) || storedDates.has(copy.date)) {
      copy.date = base + "_" + suffix++;
      copy.id = "day-" + copy.date;
    }
    reserved.add(copy.date);
    planned.push(copy);
    protectedDates.push(incoming.date + " -> " + copy.date);
  }
  const backup = normalizePhoneInstallBackup({
    schemaVersion: 1, app: "delivery-master-phone-install", backupType: "day-record-store",
    exportedAt: nowIso(), scope: { kind: "all" }, days: planned,
  });
  const result = await store.importBackup(backup, { mode: "overwrite" });
  return { importedDates: result.imported.map((item) => item.date), protectedDates };
}

function isAutoReplaceableEmptyDay(day: DayRecord): boolean {
  return day.status === "draft"
    && day.timeline.length === 0
    && day.zones.length === 0
    && day.helpers.length === 0
    && day.adjustments.length === 0;
}

async function loadCorrectionDate(): Promise<void> {
  const date = readText("#correction-date", currentDay?.date ?? todayKey());
  const day = await store.getDay(date);
  if (!day) {
    toast(`${date} 저장 기록이 없습니다.`);
    return;
  }
  currentDay = day;
  historicalEditing = day.date !== todayKey();
  activeTab = "backup";
  activeCorrectionTargetId = "";
  activeLogEditEventId = "";
  await refreshHistory();
  render();
  toast(`${date} 기록을 불러왔습니다.`);
}



async function savePreparedSnapshot(
  label: string,
  scope: Parameters<typeof preparePhoneInstallUpdate>[1] = { kind: "all" },
): Promise<void> {
  const plan = await preparePhoneInstallUpdate(store, scope);
  await platform.saveJsonSnapshot(plan.snapshot, buildBackupFilename(label));
}

function buildBackupFilename(label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return PHONE_INSTALL_BACKUP_FILENAME.replace(/\.json$/i, `_${label}_${stamp}.json`);
}

function readJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON.parse(repairKnownFieldJson(text)) as unknown;
  }
}

function repairKnownFieldJson(text: string): string {
  return text.replace(/^(\s*)"([^"\r\n]*?):\s*([{\[])/gm, '$1"$2": $3');
}

function createEmptyDay(date: string): DayRecord {
  const now = nowIso();
  return {
    schemaVersion: 1,
    id: `day-${date}`,
    date,
    status: "draft",
    timeline: [],
    zones: [],
    helpers: [],
    adjustments: [],
    meta: {
      createdAt: now,
      updatedAt: now,
      appVersion: APP_VERSION,
      recoveryStatus: "none",
    },
  };
}

function getOrderedZones(): ZoneRecord[] {
  if (!currentDay) return [];
  return [...currentDay.zones].sort((a, b) => a.order - b.order);
}

function getExtraZones(): ZoneRecord[] {
  if (!currentDay) return [];
  return currentDay.zones
    .filter((zone) => !BASE_ZONE_IDS.includes(zone.id as (typeof BASE_ZONE_IDS)[number]))
    .sort((a, b) => a.order - b.order);
}

function isExtraZone(zoneId: string): boolean {
  return !BASE_ZONE_IDS.includes(zoneId as (typeof BASE_ZONE_IDS)[number]);
}

function getActiveExtraZone(): ZoneRecord | undefined {
  return getExtraZones().find((zone) => hasZoneStarted(zone.id) && !hasZoneEnded(zone.id));
}

function getCurrentWorkZone(): ZoneRecord | undefined {
  if (!currentDay) return undefined;
  const active = getOrderedZones().find(z => hasZoneStarted(z.id) && !hasZoneEnded(z.id));
  if (active) return active;
  return [...currentDay.zones]
    .sort((a, b) => a.order - b.order)
    .find((zone) => !hasZoneEnded(zone.id));
}

function shouldOfferExtraZoneBefore(zone: ZoneRecord): boolean {
  return hasAnyZoneStarted() && !hasZoneStarted(zone.id);
}

function getExtraZoneInsertOrder(): number {
  const current = getCurrentWorkZone();
  if (current && !hasZoneStarted(current.id)) return current.order;
  return getNextZoneOrder();
}

function getDefaultEventScope(): string {
  const current = getCurrentWorkZone();
  if (current && hasZoneStarted(current.id)) return `zone:${current.id}`;
  const previous = getPreviousCompletedZone();
  if (previous && current && !hasZoneStarted(current.id)) return `between:${previous.id}:${current.id}`;
  if (current) return `zone:${current.id}`;
  return "work";
}

function getEventScopeOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: "work", label: "전체 업무" }];
  const ordered = getOrderedZones();
  for (let index = 0; index < ordered.length; index += 1) {
    const zone = ordered[index];
    options.push({ value: `zone:${zone.id}`, label: `${zone.name} 진행 중` });
    const next = ordered[index + 1];
    if (next) {
      options.push({ value: `between:${zone.id}:${next.id}`, label: `${zone.name} → ${next.name} 사이` });
    }
  }
  options.push({ value: "custom", label: "사용자 지정" });
  return options;
}

function getPreviousCompletedZone(): ZoneRecord | undefined {
  if (!currentDay) return undefined;
  return [...currentDay.zones]
    .filter((zone) => hasZoneEnded(zone.id))
    .sort((a, b) => b.order - a.order)[0];
}

function getMijuCheckpoint(zoneId = getCurrentWorkZone()?.id ?? "miju"): { one: number; two: number; three: number; rest: number; aTotal: number } | undefined {
  if (!currentDay) return undefined;
  return getMijuCheckpointForDay(currentDay, zoneId);
}

function getMijuCheckpointForDay(dayRecord: DayRecord, zoneId = "miju"): { one: number; two: number; three: number; rest: number; aTotal: number } | undefined {
  const event = [...dayRecord.timeline]
    .reverse()
    .find((candidate) =>
      candidate.type === "manual_adjust" &&
      candidate.zoneId === zoneId &&
      typeof candidate.payload === "object" &&
      candidate.payload &&
      ["miju_a_checkpoint", "miju_a_checkpoint_clear"].includes(
        String((candidate.payload as Record<string, unknown>).reason),
      ),
    );
  const payload = event?.payload as Record<string, unknown> | undefined;
  if (!payload) return undefined;
  if (payload.reason === "miju_a_checkpoint_clear") return undefined;
  const one = numberOrZero(payload.building1Total);
  const two = numberOrZero(payload.building2Total);
  const three = numberOrZero(payload.building3Total);
  const rest = numberOrZero(payload.restTotal);
  if (one + two + three + rest === 0) return undefined;
  return {
    one,
    two,
    three,
    rest,
    aTotal: one + two + three,
  };
}

function getZoneName(zoneId: string): string {
  const existing = currentDay?.zones.find((zone) => zone.id === zoneId)?.name;
  if (existing) return existing;
  if (zoneId === "miju") return "미주";
  if (zoneId === "hils") return "힐스테이트";
  if (zoneId.startsWith("alt-")) return "대체배송";
  return "추가 구역";
}

function getHelperKindLabel(kind: "free_received" | "paid_received"): string {
  return kind === "free_received" ? "도우미 배송 무료" : "도우미 배송 유료";
}

function normalizeReceivedHelperKind(value: unknown): "free_received" | "paid_received" | undefined {
  if (value === "free_received" || value === "paid_received") return value;
  return undefined;
}

function createRestoredZoneId(target: string): string {
  const safeTarget = ["miju", "hils", "alt", "custom"].includes(target) ? target : "alt";
  return `${safeTarget}-restored-${Date.now()}`;
}

function getRestoredZoneName(target: string): string {
  if (target === "miju") return "미주";
  if (target === "hils") return "힐스테이트";
  if (target === "custom") return "추가구역";
  return "대체배송";
}

function getDefaultZoneOrder(zoneId: string): number {
  if (zoneId === "miju") return 1;
  if (zoneId === "hils") return 2;
  return getNextZoneOrder();
}

function getNextZoneOrder(): number {
  if (!currentDay || currentDay.zones.length === 0) return 3;
  return Math.max(2, ...currentDay.zones.map((zone) => zone.order)) + 1;
}

function getNextAltZoneName(): string {
  const count = getExtraZones().filter((zone) => zone.id.startsWith("alt-")).length + 1;
  return count === 1 ? "대체배송" : `대체배송 ${count}`;
}

function createExtraZoneId(kind: "alt" | "custom"): string {
  return `${kind}-${Date.now().toString(36)}`;
}

function statusLabel(status: DayRecord["status"]): string {
  if (status === "draft") return "대기";
  if (status === "active") return "진행";
  if (status === "closed") return "완료";
  return "확인 필요";
}

function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getIsoWeekKey(date: string): string {
  const parsed = new Date(date + "T00:00:00Z");
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((parsed.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readHelperCloseAt(): string {
  const value = document.querySelector<HTMLInputElement>("#helper-close-at")?.value;
  if (!value) return nowIso();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

function readOptionalTimeInput(selector: string, existingIso?: string): string | undefined {
  const value = document.querySelector<HTMLInputElement>(selector)?.value;
  if (!value) return undefined;
  if (value.includes("T")) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return mergeCurrentDateAndTime(value, existingIso);
}

function readChangedTimeInput(selector: string, existingIso?: string): string | undefined {
  const value = document.querySelector<HTMLInputElement>(selector)?.value;
  if (!value) return undefined;
  if (existingIso && value === formatIsoForTimeInput(existingIso)) return undefined;
  return readOptionalTimeInput(selector, existingIso);
}

function mergeCurrentDateAndTime(value: string, existingIso?: string): string | undefined {
  if (!currentDay) return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const existing = existingIso ? new Date(existingIso) : undefined;
  if (existing && !Number.isNaN(existing.getTime()) && formatTimeOnlyValue(existing) === value) {
    return existingIso;
  }
  const [year, month, day] = existing && !Number.isNaN(existing.getTime())
    ? [existing.getFullYear(), existing.getMonth() + 1, existing.getDate()]
    : currentDay.date.split("-").map(Number);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!year || !month || !day || hour > 23 || minute > 59) return undefined;
  const second = existing && !Number.isNaN(existing.getTime()) ? existing.getSeconds() : 0;
  const millisecond = existing && !Number.isNaN(existing.getTime()) ? existing.getMilliseconds() : 0;
  return new Date(year, month - 1, day, hour, minute, second, millisecond).toISOString();
}

function formatIsoForTimeInput(iso?: string): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : formatTimeOnlyValue(parsed);
}

function getDigitTimeValues(iso?: string): { hour: string; minute: string } {
  const value = formatIsoForTimeInput(iso);
  if (!value) return { hour: "", minute: "" };
  const [hour = "", minute = ""] = value.split(":");
  return { hour, minute };
}

function renderDigitTimeFields(inputId: string, label: string, iso?: string): string {
  const { hour, minute } = getDigitTimeValues(iso);
  return `
    <label>${label}
      <span class="digit-time-fields">
        <input id="${escapeAttribute(`${inputId}-hour`)}" type="text" inputmode="numeric" maxlength="2" data-numeric-limit="2" value="${escapeAttribute(hour)}">
        <span>:</span>
        <input id="${escapeAttribute(`${inputId}-minute`)}" type="text" inputmode="numeric" maxlength="2" data-numeric-limit="2" value="${escapeAttribute(minute)}">
      </span>
    </label>
  `;
}

function renderHelperDigitTimeFields(helperId: string, label: string, iso?: string): string {
  const { hour, minute } = getDigitTimeValues(iso);
  return `
    <label>${label}
      <span class="digit-time-fields">
        <input data-helper-at-hour="${escapeAttribute(helperId)}" type="text" inputmode="numeric" maxlength="2" data-numeric-limit="2" value="${escapeAttribute(hour)}">
        <span>:</span>
        <input data-helper-at-minute="${escapeAttribute(helperId)}" type="text" inputmode="numeric" maxlength="2" data-numeric-limit="2" value="${escapeAttribute(minute)}">
      </span>
    </label>
  `;
}

function readRequiredDigitTimeInput(inputId: string, label: string, existingIso?: string): string | undefined {
  const hour = readDigitTimeToken(`#${inputId}-hour`);
  const minute = readDigitTimeToken(`#${inputId}-minute`);
  return buildDigitTimeIso(hour, minute, label, existingIso);
}

function readHelperDigitTimeInput(helperId: string, label: string, existingIso?: string): string | undefined {
  const hourInput = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-helper-at-hour]"))
    .find((candidate) => candidate.dataset.helperAtHour === helperId);
  const minuteInput = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-helper-at-minute]"))
    .find((candidate) => candidate.dataset.helperAtMinute === helperId);
  if (!hourInput && !minuteInput) return undefined;
  const hour = normalizeDigitToken(hourInput);
  const minute = normalizeDigitToken(minuteInput);
  return buildDigitTimeIso(hour, minute, label, existingIso);
}

function readDigitTimeToken(selector: string): string {
  return normalizeDigitToken(document.querySelector<HTMLInputElement>(selector));
}

function normalizeDigitToken(input?: HTMLInputElement | null): string {
  const cleaned = (input?.value ?? "").replace(/\D/g, "").slice(0, 2);
  if (input && input.value !== cleaned) input.value = cleaned;
  return cleaned;
}

function buildDigitTimeIso(hourToken: string, minuteToken: string, label: string, existingIso?: string): string | undefined {
  if (!hourToken && !minuteToken) {
    toast(`${label}을 입력하세요.`);
    return undefined;
  }
  if (!hourToken || !minuteToken) {
    toast(`${label} 시와 분을 모두 입력하세요.`);
    return undefined;
  }
  const hour = Number(hourToken);
  const minute = Number(minuteToken);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    toast(`${label} 값을 다시 확인하세요.`);
    return undefined;
  }
  return mergeCurrentDateAndTime(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, existingIso);
}

function formatIsoForInput(iso?: string): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : formatTimeInputValue(parsed);
}

function formatTimeInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatTimeOnlyValue(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function readZoneDelivered(zoneId: string): { value: number; hasValue: boolean } {
  if (isMijuZone(zoneId)) {
    const parts = readMijuPayloadParts();
    return { value: parts.delivered, hasValue: parts.totalHasValue || parts.hasDetail };
  }
  if (getZoneKind(currentDay?.zones.find(z => z.id === zoneId)) === "hils") return readLimitedNumberField("#hils-count", 5);
  return readLimitedNumberField("#extra-count", 5);
}

function readMijuPayloadParts(): MijuParts {
  const input = readMijuInputParts();
  return buildMijuPartsFromZoneTotal(input, input.total);
}

function readMijuInputParts(): MijuInputParts {
  const one = readLimitedNumberField("#miju-1-count", 3);
  const two = readLimitedNumberField("#miju-2-count", 3);
  const three = readLimitedNumberField("#miju-3-count", 3);
  const rest = readLimitedNumberField("#miju-rest-count", 3);
  const checkpoint = getMijuCheckpoint();
  const resolved = {
    one: one.hasValue ? one.value : checkpoint?.one || 0,
    two: two.hasValue ? two.value : checkpoint?.two || 0,
    three: three.hasValue ? three.value : checkpoint?.three || 0,
    rest: rest.hasValue ? rest.value : checkpoint?.rest || 0,
  };
  const total = readLimitedNumberField("#miju-total-count", 5);
  return {
    total: total.value,
    totalHasValue: total.hasValue,
    one: resolved.one,
    two: resolved.two,
    three: resolved.three,
    rest: resolved.rest,
    restHasValue: rest.hasValue || Boolean(checkpoint?.rest),
    hasDetail: resolved.one + resolved.two + resolved.three > 0 || rest.hasValue || Boolean(checkpoint?.rest),
  };
}

function readMijuEditInputParts(zoneId: string): MijuInputParts {
  const one = readLimitedNumberField(`#edit-${zoneId}-1`, 3);
  const two = readLimitedNumberField(`#edit-${zoneId}-2`, 3);
  const three = readLimitedNumberField(`#edit-${zoneId}-3`, 3);
  const rest = readLimitedNumberField(`#edit-${zoneId}-rest`, 3);
  const total = readLimitedNumberField(`#edit-${zoneId}-total`, 3);
  return {
    total: total.value,
    totalHasValue: total.hasValue,
    one: one.value,
    two: two.value,
    three: three.value,
    rest: rest.value,
    restHasValue: rest.hasValue,
    hasDetail: one.hasValue || two.hasValue || three.hasValue || rest.hasValue,
  };
}

function buildMijuPartsFromZoneTotal(input: MijuInputParts, zoneDelivered: number): MijuParts {
  return toMijuParts(resolveMijuDetailQuantity({
    total: zoneDelivered,
    totalHasValue: input.totalHasValue,
    one: input.one,
    two: input.two,
    three: input.three,
    rest: input.rest,
    restHasValue: input.restHasValue,
  }), input.totalHasValue);
}

function resolveValidatedDelivered(
  zoneId: string,
  entered: number,
  hasValue: boolean,
  options: { mode?: "auto" | "actual" | "cumulative"; mijuInput?: MijuInputParts; riskContext?: "zone-end" | "block" } = {},
): number | undefined {
  if (!currentDay) return undefined;
  const zoneName = getZoneName(zoneId);
  const mode = options.mode ?? "auto";
  const previousDelivered = getPreviousZoneDeliveredTotal(zoneId);
  const shouldSubtractCumulative =
    ((mode === "cumulative" && previousDelivered > 0) || (mode === "auto" && previousDelivered > 0 && entered > previousDelivered)) &&
    hasValue;
  if (shouldSubtractCumulative) {
    const adjusted = entered - previousDelivered;
    if (adjusted <= 0) {
      toast(`${zoneName} ${entered}개에서 앞 구역 ${previousDelivered}개를 빼면 0개 이하입니다. 수량을 확인하세요.`);
      return undefined;
    }
    const adjustedResult = validateZoneQuantity({
      zoneName,
      entered: adjusted,
      hasValue,
      expectedTotal: getExpectedTotal(),
      completedOther: previousDelivered,
      maxReasonable: MAX_REASONABLE_ZONE,
    });
    if (!adjustedResult.ok) {
      toast(adjustedResult.message ?? `${zoneName} 수량을 확인하세요.`);
      return undefined;
    }
    if (adjustedResult.warning) {
      if (options.riskContext === "block") {
        toast(`${adjustedResult.warning} 수량을 다시 확인하세요.`);
        return undefined;
      }
      setPendingQuantityRisk({
        zoneId,
        zoneName,
        entered,
        saveValue: adjusted,
        previousDelivered,
        expectedTotal: getExpectedTotal(),
        warning: adjustedResult.warning,
        adjustedValue: adjusted,
        mijuInput: options.mijuInput,
      });
      return undefined;
    }
    toast(`${zoneName} 누적 ${entered}개에서 앞 구역 ${previousDelivered}개를 빼 ${adjusted}개로 저장합니다.`);
    return adjusted;
  }
  const result = validateZoneQuantity({
    zoneName,
    entered,
    hasValue,
    expectedTotal: getExpectedTotal(),
    completedOther: previousDelivered,
    maxReasonable: MAX_REASONABLE_ZONE,
  });

  if (!result.ok) {
    toast(result.message ?? `${zoneName} 수량을 확인하세요.`);
    return undefined;
  }

  if (result.suggestedValue !== undefined) {
    toast(`${zoneName} ${entered}개에서 앞 구역 ${previousDelivered}개를 빼 ${result.suggestedValue}개로 저장합니다.`);
    return result.suggestedValue;
  }

  if (result.warning) {
    if (options.riskContext === "block") {
      toast(`${result.warning} 수량을 다시 확인하세요.`);
      return undefined;
    }
    const adjustedValue = previousDelivered > 0 && entered - previousDelivered > 0
      ? entered - previousDelivered
      : undefined;
    setPendingQuantityRisk({
      zoneId,
      zoneName,
      entered,
      saveValue: entered,
      previousDelivered,
      expectedTotal: getExpectedTotal(),
      warning: result.warning,
      adjustedValue,
      mijuInput: options.mijuInput,
    });
    return undefined;
  }

  return result.value;
}

function setPendingQuantityRisk(risk: PendingQuantityRisk): void {
  pendingQuantityRisk = risk;
  toast("수량이 비정상적으로 커서 저장을 멈췄습니다. 화면의 선택지를 확인하세요.");
}

function getPreviousZoneDeliveredTotal(zoneId: string): number {
  if (!currentDay) return 0;
  const zone = currentDay.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return 0;
  const previousZoneIds = new Set(
    currentDay.zones
      .filter((candidate) => candidate.order < zone.order)
      .map((candidate) => candidate.id),
  );
  return currentDay.timeline.reduce((sum, event) => {
    if (event.type !== "zone_end" || !event.zoneId || !previousZoneIds.has(event.zoneId)) return sum;
    const payload = event.payload as { delivered?: unknown } | undefined;
    return sum + (typeof payload?.delivered === "number" ? payload.delivered : 0);
  }, 0);
}

function getExpectedTotal(): number | undefined {
  const depart = currentDay?.timeline.find((event) => event.type === "depart_jinjeop");
  const payload = depart?.payload as { total?: unknown } | undefined;
  return typeof payload?.total === "number" && payload.total > 0 ? payload.total : undefined;
}

function getCompletedDeliveredTotal(excludingZoneId?: string): number {
  if (!currentDay) return 0;
  const zoneTotal = currentDay.timeline.reduce((sum, event) => {
    if (event.type !== "zone_end" || event.zoneId === excludingZoneId) return sum;
    const payload = event.payload as { delivered?: unknown } | undefined;
    return sum + (typeof payload?.delivered === "number" ? payload.delivered : 0);
  }, 0);
  return zoneTotal + getReceivedHelperQuantityTotal();
}

function getReceivedHelperQuantityTotal(): number {
  if (!currentDay) return 0;
  return currentDay.timeline.reduce((sum, event) => {
    if (event.type !== "helper_add" || !event.payload) return sum;
    const payload = event.payload as { helperKind?: unknown; quantity?: unknown; unpaid?: unknown };
    if (payload.unpaid === true) return sum;
    if (payload.helperKind !== "free_received" && payload.helperKind !== "paid_received") return sum;
    if (hasHelperSourceZone(event)) return sum;
    return sum + (typeof payload.quantity === "number" ? payload.quantity : 0);
  }, 0);
}

function hasHelperSourceZone(event?: TimelineEvent): boolean {
  const payload = event?.payload as { sourceZoneId?: unknown } | undefined;
  return typeof payload?.sourceZoneId === "string" && Boolean(currentDay?.zones.some(zone => zone.id === payload.sourceZoneId));
}

function toMijuParts(
  result: ReturnType<typeof resolveMijuDetailQuantity>,
  totalHasValue: boolean,
): MijuParts {
  return {
    ok: result.ok,
    message: result.message,
    one: result.one,
    two: result.two,
    three: result.three,
    rest: result.rest,
    aTotal: result.aTotal,
    detailTotal: result.detailTotal,
    delivered: result.delivered,
    hasDetail: result.hasDetail,
    totalHasValue,
  };
}

interface MijuParts {
  ok: boolean;
  message?: string;
  one: number;
  two: number;
  three: number;
  rest: number;
  aTotal: number;
  detailTotal: number;
  delivered: number;
  hasDetail: boolean;
  totalHasValue: boolean;
}

interface MijuInputParts {
  total: number;
  totalHasValue: boolean;
  one: number;
  two: number;
  three: number;
  rest: number;
  restHasValue: boolean;
  hasDetail: boolean;
}

function readDeliveredPayload(event?: TimelineEvent): number {
  const payload = event?.payload as { delivered?: unknown } | undefined;
  return typeof payload?.delivered === "number" ? payload.delivered : 0;
}

function readNumber(selector: string, fallback = 0): number {
  const raw = document.querySelector<HTMLInputElement>(selector)?.value ?? "";
  const value = parseInt(raw.replace(/\D/g, ""), 10);
  return Number.isFinite(value) ? value : fallback;
}

function readLimitedNumber(selector: string, maxDigits: number, fallback = 0): number {
  const input = document.querySelector<HTMLInputElement>(selector);
  const cleaned = (input?.value ?? "").replace(/\D/g, "").slice(0, maxDigits);
  if (input && input.value !== cleaned) input.value = cleaned;
  const value = parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : fallback;
}

function readLimitedNumberField(selector: string, maxDigits: number): { value: number; hasValue: boolean } {
  const input = document.querySelector<HTMLInputElement>(selector);
  const cleaned = (input?.value ?? "").replace(/\D/g, "").slice(0, maxDigits);
  if (input && input.value !== cleaned) input.value = cleaned;
  const value = parseInt(cleaned, 10);
  return {
    value: Number.isFinite(value) ? value : 0,
    hasValue: cleaned.length > 0,
  };
}

function bindNumericLimits(): void {
  root.querySelectorAll<HTMLInputElement>("[data-numeric-limit]").forEach((input) => {
    input.addEventListener("input", () => {
      const maxDigits = parseInt(input.dataset.numericLimit ?? "3", 10);
      if (input.closest(".quantity-input,.building-grid")) {
        input.setCustomValidity(input.value === "" || new RegExp("^\\d{1," + maxDigits + "}$").test(input.value) ? "" : "0 이상의 정수로 입력하세요.");
        return;
      }
      input.value = input.value.replace(/\D/g, "").slice(0, maxDigits);
    });
  });
}

function bindStatsDateInput(): void {
  const input = root.querySelector<HTMLInputElement>("#stats-date-input");
  if (!input) return;
  input.addEventListener("change", () => {
    if (!input.value) return;
    statsSelectedDate = input.value;
    render();
  });
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function confirmLargeNumber(value: number, limit: number, label: string): boolean {
  if (value <= limit) return true;
  return confirm(`${label} ${value}개가 입력됐습니다. 너무 큰 값일 수 있습니다. 그대로 저장할까요?`);
}

function readText(selector: string, fallback: string): string {
  const value = document.querySelector<HTMLInputElement>(selector)?.value.trim();
  return value || fallback;
}

function readZoneCorrectionKind(zoneId: string): "free_received" | "paid_received" | undefined {
  const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select[data-zone-correction]"))
    .find((candidate) => candidate.dataset.zoneCorrection === zoneId);
  return normalizeReceivedHelperKind(select?.value);
}

function readHelperCorrectionKind(helperId: string): "free_received" | "paid_received" | undefined {
  const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select[data-helper-kind]"))
    .find((candidate) => candidate.dataset.helperKind === helperId);
  return normalizeReceivedHelperKind(select?.value);
}

function readHelperCorrectionQuantity(helperId: string): number {
  const input = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-helper-quantity]"))
    .find((candidate) => candidate.dataset.helperQuantity === helperId);
  const cleaned = (input?.value ?? "").replace(/\D/g, "").slice(0, 3);
  if (input && input.value !== cleaned) input.value = cleaned;
  const value = parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : 0;
}

function readHelperCorrectionAt(helperId: string): string | undefined {
  const helper = currentDay?.helpers.find((candidate) => candidate.id === helperId);
  const helperEvent = currentDay?.timeline.find((event) => event.type === "helper_add" && helper?.linkedEventIds.includes(event.id));
  const digitValue = readHelperDigitTimeInput(helperId, "도우미 기록 시각", helperEvent?.at);
  if (digitValue !== undefined) return digitValue;

  const input = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-helper-at]"))
    .find((candidate) => candidate.dataset.helperAt === helperId);
  const value = input?.value;
  if (!value) return undefined;
  if (value.includes("T")) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return mergeCurrentDateAndTime(value, helperEvent?.at);
}

function readHelperZoneRestoreTarget(helperId: string): string | undefined {
  const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select[data-helper-zone-restore]"))
    .find((candidate) => candidate.dataset.helperZoneRestore === helperId);
  return select?.value;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatMin(value?: number): string {
  return formatDuration(value);
}

function formatEff(value?: number): string {
  return value === undefined ? "-" : `${Math.round(value)}개/시간`;
}

function formatDuration(value?: number): string {
  if (value === undefined) return "-";
  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

function isMijuZone(zoneId: string): boolean {
  return getZoneKind(currentDay?.zones.find(z => z.id === zoneId)) === "miju";
}
function validateWorkDigits(): boolean {
  const invalid = [...root.querySelectorAll<HTMLInputElement>(".quantity-input input,.building-grid input")]
    .find(input => input.value !== "" && !new RegExp("^\\d{1," + (input.dataset.numericLimit ?? "5") + "}$").test(input.value));
  if (!invalid) return true;
  toast("수량은 0 이상의 정수로 입력하세요. 잘못 입력한 값은 그대로 남겼습니다.");
  invalid.focus();
  return false;
}
function getWorkCountInputId(zone: ZoneRecord): string {
  const kind = getZoneKind(zone);
  return kind === "miju" ? "miju-total-count" : kind === "hils" ? "hils-count" : "extra-count";
}
function renderRouteHeading(zone: ZoneRecord): string {
  return `<p class="step">${zone.order}구역</p><div class="route-heading"><h2>${escapeHtml(zone.name)}</h2><button class="kind-edit" data-action="open-route-editor" data-zone="${zone.id}" title="구역 변경">${getZoneKind(zone) === "alt" ? "대체배송" : "내 구역"}${fieldIcon("edit")}</button></div>`;
}
function renderWorkQuantity(zone: ZoneRecord): string {
  return `<label class="quantity-label" for="${getWorkCountInputId(zone)}">오늘 누적 수량</label><div class="quantity-input"><input id="${getWorkCountInputId(zone)}" type="text" inputmode="numeric" maxlength="5" data-numeric-limit="5" placeholder="0"><span>개</span></div>
  <div class="quantity-results"><div><small>이전 완료</small><strong data-preview="previous">-</strong></div><div><small>이번 구역</small><strong data-preview="current">-</strong></div><div><small>${getZoneKind(zone) === "miju" ? "나머지 동" : "오늘 누적"}</small><strong data-preview="last">-</strong></div></div><p class="quantity-error" data-preview="error" role="status" hidden></p>`;
}
function updateQuantityPreview(): void {
  const zone = getCurrentWorkZone();
  if (!zone) return;
  const input = root.querySelector<HTMLInputElement>("#" + getWorkCountInputId(zone));
  if (!input) return;
  const previous = getPreviousZoneDeliveredTotal(zone.id);
  const valid = /^\d+$/.test(input.value);
  const total = valid ? Number(input.value) : undefined;
  const count = total === undefined ? undefined : total - previous;
  const aTotal = isMijuZone(zone.id) ? ["#miju-1-count", "#miju-2-count", "#miju-3-count"].reduce((sum, id) => sum + Number(root.querySelector<HTMLInputElement>(id)?.value || 0), 0) : 0;
  const set = (key: string, value: number | undefined) => { const element = root.querySelector("[data-preview=" + key + "]"); if (element) element.textContent = value === undefined ? "-" : value + "개"; };
  set("previous", previous);
  set("current", count);
  set("last", isMijuZone(zone.id) ? count === undefined ? undefined : count - aTotal : total);
  const error = root.querySelector<HTMLElement>("[data-preview=error]");
  if (error) {
    const text = count !== undefined && count <= 0 ? "누적 수량이 이전 완료 " + previous + "개보다 커야 합니다." : count !== undefined && count < aTotal ? "이번 구역 수량보다 동별 합계가 큽니다." : "";
    error.textContent = text; error.hidden = !text;
  }
}
function bindRouteSheet(): void {
  const dialog = root.querySelector<HTMLDialogElement>(".route-sheet");
  if (!dialog || !routeSheet) return;
  dialog.showModal();
  dialog.addEventListener("cancel", event => { event.preventDefault(); routeSheet = null; render(); });
  dialog.addEventListener("click", event => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientY < r.top || event.clientX < r.left || event.clientX > r.right)) { routeSheet = null; render(); }
  });
  const rememberName = () => { if (routeSheet) routeSheet.name = root.querySelector<HTMLInputElement>("#route-name")?.value ?? routeSheet.name; };
  root.querySelectorAll<HTMLInputElement>('[name="route-mode"]').forEach(input => input.addEventListener("change", () => {
    rememberName();
    if (!routeSheet) return;
    routeSheet.kind = input.value === "alt" ? "alt" : "miju";
    routeSheet.name = input.value === "alt" ? "대체배송" : "미주";
    render();
  }));
  root.querySelector<HTMLSelectElement>("#route-place")?.addEventListener("change", event => {
    rememberName();
    if (!routeSheet) return;
    routeSheet.kind = (event.target as HTMLSelectElement).value as ZoneKind;
    routeSheet.name = routeSheet.kind === "miju" ? "미주" : routeSheet.kind === "hils" ? "힐스테이트" : "";
    render();
  });
}
async function handleRouteAction(action: string, zoneId?: string): Promise<boolean> {
  if (!currentDay) return false;
  if (action === "close-route-sheet") { routeSheet = null; render(); return true; }
  if (action === "open-route-plans" || action === "open-close-day") {
    routeSheet = { mode: action === "open-route-plans" ? "plans" : "close", kind: "alt", name: "" };
    render(); return true;
  }
  if (action === "open-route-editor") {
    const zone = currentDay.zones.find(z => z.id === zoneId);
    routeSheet = { mode: "edit", zoneId: zone?.id, kind: zone ? getZoneKind(zone) : "alt", name: zone?.name ?? "대체배송" };
    render(); return true;
  }
  if (action === "select-next-zone" && zoneId) {
    if (hasZoneStarted(zoneId)) return true;
    const pending = getOrderedZones().filter(z => !hasZoneStarted(z.id));
    const target = pending.find(z => z.id === zoneId);
    if (target) {
      const slots = pending.map(z => z.order);
      const reordered = [target, ...pending.filter(z => z.id !== zoneId)];
      const orders = new Map(reordered.map((z, i) => [z.id, slots[i]!]));
      currentDay.zones = currentDay.zones.map(z => orders.has(z.id) ? { ...z, order: orders.get(z.id)! } : z);
    }
    routeSheet = null; await saveAndRender(); return true;
  }
  if (action === "remove-planned-zone" && routeSheet?.zoneId) {
    skipZone(routeSheet.zoneId);
    routeSheet = { mode: "plans", kind: "alt", name: "" };
    await saveAndRender(); return true;
  }
  if (action === "confirm-close-day") {
    if (getOrderedZones().some(z => hasZoneStarted(z.id) && !hasZoneEnded(z.id))) { toast("진행 구역을 먼저 완료하세요."); return true; }
    routeSheet = null;
    const proxy = document.createElement("button");
    proxy.dataset.action = "close-day";
    await handleAction(proxy); return true;
  }
  if (action !== "save-route-editor" || !routeSheet) return false;
  const { kind } = routeSheet;
  const id = routeSheet.zoneId;
  const name = kind === "miju" ? "미주" : kind === "hils" ? "힐스테이트" : readText("#route-name", "").trim();
  if (!name) { toast("구역 이름을 입력하세요."); return true; }
  const workZone = getCurrentWorkZone();
  const oldInputId = workZone ? getWorkCountInputId(workZone) : "";
  const rawCount = root.querySelector<HTMLInputElement>("#" + (oldInputId || "no-count"))?.value;
  if (id) {
    const existing = currentDay.zones.find(z => z.id === id);
    if (!existing) { toast("수정할 구역을 찾지 못했습니다."); return true; }
    if (hasZoneStarted(id)) await savePreparedSnapshot("route-edit-before", { kind: "date", date: currentDay.date });
    const note = existing.name + " -> " + name;
    currentDay = {
      ...currentDay,
      zones: currentDay.zones.map(z => z.id === id ? { ...z, name, kind } : z),
      timeline: currentDay.timeline.map(e => e.zoneId === id && (e.type === "zone_start" || e.type === "zone_end") ? { ...e, payload: { ...e.payload, zoneName: name }, updatedAt: nowIso() } : e),
      adjustments: [...currentDay.adjustments, { id: "route-" + crypto.randomUUID(), reason: "route_identity_edit", note, createdAt: nowIso() }],
    };
  } else {
    const order = Math.max(0, ...currentDay.zones.map(z => z.order)) + 1;
    currentDay.zones.push({ id: "visit-" + crypto.randomUUID(), name, kind, order });
  }
  routeSheet = null;
  pendingQuantityRisk = null;
  await saveAndRender();
  if (rawCount !== undefined && workZone && workZone.id === id) {
    const updated = currentDay.zones.find(z => z.id === id)!;
    const newId = getWorkCountInputId(updated);
    formDrafts.moveField(renderedFormKey, "#" + oldInputId, "#" + newId, rawCount);
    const input = root.querySelector<HTMLInputElement>("#" + newId);
    if (input) input.value = rawCount;
    updateQuantityPreview();
  }
  toast(id ? "구역 변경을 저장했습니다." : "예정 구역에 추가했습니다.");
  return true;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function toast(message: string): void {
  document.querySelectorAll(".toast").forEach(previous => previous.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

