import { applyMissingCleanupCorrection, hasMissingCleanupFinish } from "../domain/cleanupCorrection";
import { applyCompletedZoneEdit } from "../domain/zoneEdit";
import { createEvent } from "../domain/eventTimeline";
import { calculateDay } from "../domain/deliveryCalc";
import { buildDailyReport } from "../domain/reportBuilder";
import { resolveMijuDetailQuantity, validateZoneQuantity } from "../domain/zoneValidation";
import type { DayCalculation, DayRecord, ReportResult, TimelineEvent, TimelineEventType, ZoneRecord } from "../domain/types";
import { buildPhoneInstallDashboard, preparePhoneInstallUpdate } from "../install/phoneInstall";
import {
  PHONE_INSTALL_BACKUP_FILENAME,
  buildFieldAppMigrationBackup,
  createBackupCopyDay,
} from "../storage/backupImportExport";
import { IndexedDbDayStore } from "../storage/indexedDbAdapter";
import type { ZoneQuantityComparison } from "../ui/uiScreens";
import { APP_VERSION, SETTINGS_VERSION_LABEL, TOPBAR_VERSION_LABEL } from "./version";

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
const store = new IndexedDbDayStore({
  dbName: "delivery-master-install",
  storeName: "dayRecords",
  appVersion: APP_VERSION,
});

let currentDay: DayRecord | null = null;
let historyDays: DayRecord[] = [];
let lastImportFeedback: ImportFeedback | null = null;
let activeTab: AppTab = "work";
let activeStatsTab: StatsTab = "week";
let statsWeekOffset = 0;
let statsMonthOffset = 0;
let statsSelectedDate = todayKey();

type AppTab = "work" | "log" | "report" | "stats" | "backup";
type StatsTab = "week" | "month" | "date";

interface ImportFeedback {
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

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Missing #app root");
const root: HTMLDivElement = appRoot;

void boot();

async function boot(): Promise<void> {
  await registerServiceWorker();
  await loadToday();
  render();
}

async function loadToday(): Promise<void> {
  const date = todayKey();
  currentDay = await store.getDay(date);
  if (!currentDay) {
    currentDay = createEmptyDay(date);
    await store.saveDay(currentDay);
  }
  await refreshHistory();
}

function render(): void {
  if (!currentDay) return;

  const calculation = calculateDay(currentDay);
  const report = buildDailyReport(currentDay, calculation, { title: "Delivery Master Install Report" });
  const pendingZone = currentDay.zones.find((zone) => hasMissingCleanupFinish(currentDay!, zone.id));
  const history = historyDays.length > 0 ? historyDays : [currentDay];

  root.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">phoneInstall alpha · ${TOPBAR_VERSION_LABEL}</p>
          <h1>배송마스터</h1>
        </div>
        <button class="icon-btn" data-action="refresh" title="새로고침">새로고침</button>
      </header>

      <section class="status-band">
        <div><span class="label">날짜</span><strong>${currentDay.date}</strong></div>
        <div><span class="label">상태</span><strong>${statusLabel(currentDay.status)}</strong></div>
        <div><span class="label">기록</span><strong>${currentDay.timeline.length}</strong></div>
      </section>

      ${renderTabs()}
      ${renderActiveTabContent(calculation, report, history, pendingZone)}
    </main>
  `;

  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => void handleAction(button));
  });
  bindNumericLimits();
  bindStatsDateInput();
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
        <button class="${activeTab === tab.key ? "active" : ""}" data-action="set-tab" data-tab="${tab.key}">${tab.label}</button>
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
  return `
    ${renderCurrentStep()}
    ${pendingZone ? renderCleanupCorrectionPanel(pendingZone.id) : ""}
    ${renderEventPanel()}
    <section class="panel">
      <h2>오늘 요약</h2>
      <div class="summary">
        <span>총 ${calculation.totals.totalCount}개</span>
        <span>완료 ${calculation.totals.deliveredCount}개</span>
        <span>배송 ${formatMin(calculation.totals.deliveryMinutes)}</span>
        <span>효율 ${formatEff(calculation.totals.efficiencyPerHour)}</span>
      </div>
    </section>
    <section class="panel">
      <h2>구역 현황</h2>
      ${renderZoneCards()}
    </section>
  `;
}

function renderLogTab(calculation: DayCalculation): string {
  return `
    <section class="panel">
      <h2>로그</h2>
      <p class="hint">현장에서 평소 확인하는 시간순 기록입니다. 이 화면만 보고 하루 흐름을 복구할 수 있어야 합니다.</p>
      <div class="timeline-log">
        ${buildLogEntries(calculation).map((entry) => `
          <article class="timeline-entry ${entry.kind}">
            <div>
              <strong>${entry.title}</strong>
              <time>${entry.time}</time>
              ${entry.detail ? `<p>${entry.detail}</p>` : ""}
            </div>
          </article>
        `).join("")}
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
      <p class="hint">비율카드를 먼저 보고, 필요하면 주간·월간·날짜별 흐름을 아래에서 확인합니다.</p>
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
      <button class="secondary" data-action="stats-week-prev">이전 주</button>
      <strong>${formatDateRange(range.start, range.end)}</strong>
      <button class="secondary" data-action="stats-week-next" ${statsWeekOffset >= 0 ? "disabled" : ""}>다음 주</button>
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
      <button class="secondary" data-action="stats-month-prev">이전 달</button>
      <strong>${formatMonthTitle(range.start)}</strong>
      <button class="secondary" data-action="stats-month-next" ${statsMonthOffset >= 0 ? "disabled" : ""}>다음 달</button>
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
  const efficiencies = deliveryPairs
    .map((pair) => pair.calculation.totals.efficiencyPerHour)
    .filter((value): value is number => typeof value === "number" && value > 0 && value < 300);
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
    averageEfficiencyPerHour: efficiencies.length > 0
      ? efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length
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
  const zones = new Map<string, { label: string; quantity: number; deliveryMinutes: number; efficiencies: number[] }>();

  for (const pair of pairs) {
    for (const zone of pair.calculation.zones) {
      const label = getZoneNameFromDay(pair.dayRecord, zone.zoneId);
      const current = zones.get(label) ?? { label, quantity: 0, deliveryMinutes: 0, efficiencies: [] };
      current.quantity += zone.counts.delivered;
      current.deliveryMinutes += zone.deliveryMinutes ?? 0;
      if (zone.efficiencyPerHour !== undefined && zone.efficiencyPerHour > 0 && zone.efficiencyPerHour < 300) {
        current.efficiencies.push(zone.efficiencyPerHour);
      }
      zones.set(label, current);
    }
  }

  return [...zones.values()]
    .filter((zone) => zone.quantity > 0 || zone.deliveryMinutes > 0)
    .map((zone) => ({
      label: zone.label,
      quantity: zone.quantity,
      deliveryMinutes: zone.deliveryMinutes > 0 ? zone.deliveryMinutes : undefined,
      efficiencyPerHour: zone.efficiencies.length > 0
        ? zone.efficiencies.reduce((sum, value) => sum + value, 0) / zone.efficiencies.length
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
        <button class="danger" data-action="reset-confirm">오늘 초기화</button>
      </div>
      ${renderRecordCorrectionPanel()}
    </section>
  `;
}

function renderRecordCorrectionPanel(): string {
  if (!currentDay) return "";
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
    .filter((item) => item.event && item.kind && item.quantity > 0);

  return `
    <section class="record-correction">
      <h3>기록 정정</h3>
      <p class="hint">로그 화면은 보기 전용입니다. 잘못 누른 기록은 여기서 다시 고칩니다. 도우미 무료/유료는 여러 번 재수정할 수 있습니다.</p>
      ${completed.length === 0 && helpers.length === 0 ? `<p class="empty-state">정정할 기록이 없습니다.</p>` : ""}
      ${completed.length === 0 ? "" : `
        <div class="correction-list">
          ${completed.map(({ zone, delivered }) => `
            <article>
              <strong>${escapeHtml(zone.name)}</strong>
              <p>${delivered}개 · ${zone.order}구역 완료 기록</p>
              <label>정정 종류
                <select data-zone-correction="${escapeAttribute(zone.id)}">
                  <option value="free_received">도우미 배송 무료로 전환</option>
                  <option value="paid_received">도우미 배송 유료로 전환</option>
                </select>
              </label>
              <button data-action="apply-zone-correction" data-zone="${escapeAttribute(zone.id)}">정정 저장</button>
            </article>
          `).join("")}
        </div>
      `}
      ${helpers.length === 0 ? "" : `
        <div class="correction-list">
          ${helpers.map(({ helper, event, kind, quantity }) => `
            <article>
              <strong>${escapeHtml(helper.name)}</strong>
              <p>${quantity}개 · ${kind === "free_received" ? "효율 제외" : "효율 포함"}</p>
              <label>도우미 종류
                <select data-helper-kind="${escapeAttribute(helper.id)}">
                  <option value="free_received"${kind === "free_received" ? " selected" : ""}>도우미 배송 무료</option>
                  <option value="paid_received"${kind === "paid_received" ? " selected" : ""}>도우미 배송 유료</option>
                </select>
              </label>
              <label>수량
                <input data-helper-quantity="${escapeAttribute(helper.id)}" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${quantity}">
              </label>
              <label>시각
                <input data-helper-at="${escapeAttribute(helper.id)}" type="datetime-local" value="${formatIsoForInput(event!.at)}">
              </label>
              <button data-action="save-helper-correction" data-helper="${escapeAttribute(helper.id)}">도우미 기록 수정 저장</button>
              <label>구역으로 되돌리기
                <select data-helper-zone-restore="${escapeAttribute(helper.id)}">
                  <option value="alt">대체배송</option>
                  <option value="hils">힐스테이트</option>
                  <option value="miju">미주</option>
                  <option value="custom">추가구역</option>
                </select>
              </label>
              <button data-action="restore-helper-zone" data-helper="${escapeAttribute(helper.id)}">구역 기록으로 복구</button>
            </article>
          `).join("")}
        </div>
      `}
    </section>
  `;
}

function getViewportInfoLabel(): string {
  if (typeof window === "undefined") return "확인 불가";
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  return `${window.innerWidth}x${window.innerHeight} / DPR ${dpr}`;
}


interface LogViewEntry {
  title: string;
  time: string;
  detail?: string;
  kind: "depart" | "arrive" | "zone" | "sorting" | "done" | "event";
}

function buildLogEntries(calculation: DayCalculation): LogViewEntry[] {
  if (!currentDay) return [];
  return buildLogEntriesForDay(currentDay, calculation);
}

function buildLogEntriesForDay(dayRecord: DayRecord, calculation: DayCalculation): LogViewEntry[] {
  const entries: LogViewEntry[] = [];
  const zoneCalcs = new Map(calculation.zones.map((zone) => [zone.zoneId, zone]));
  const orderedEvents = [...dayRecord.timeline].sort(compareLogEventOrder);

  for (const event of orderedEvents) {
    const zoneName = event.zoneId ? getZoneNameFromDay(dayRecord, event.zoneId) : undefined;
    const zoneCalc = event.zoneId ? zoneCalcs.get(event.zoneId) : undefined;
    const payload = event.payload as Record<string, unknown> | undefined;
    const time = formatTime(event.at);

    if (event.type === "depart_jinjeop") {
      const total = typeof payload?.total === "number" ? `예상 수량: ${payload.total}개` : "예상 수량 없음";
      entries.push({ title: "진접 출발", time, detail: total, kind: "depart" });
    } else if (event.type === "arrive_cheongnyangni") {
      entries.push({ title: "청량리 도착", time, detail: `운전: ${formatMin(getDriveMinutesForDay(dayRecord))}`, kind: "arrive" });
    } else if (event.type === "zone_start") {
      const detail = event.zoneId === "miju" ? buildMijuStartDetailForDay(dayRecord) : buildMovementDetail(zoneCalc);
      entries.push({ title: `${getZoneOrderLabelForDay(dayRecord, event.zoneId)} 시작 · ${zoneName}`, time, detail, kind: "zone" });
    } else if (event.type === "delivery_start") {
      entries.push({ title: "바로 배송 시작", time, detail: zoneName ? `${zoneName} 진행 중` : undefined, kind: "zone" });
    } else if (event.type === "sorting_start") {
      entries.push({ title: "정리 시작", time, detail: buildMovementDetail(zoneCalc), kind: "sorting" });
    } else if (event.type === "sorting_end") {
      entries.push({ title: "정리 완료", time, detail: `정리: ${formatMin(zoneCalc?.sortingMinutes)}`, kind: "sorting" });
    } else if (event.type === "zone_end") {
      const delivered = typeof payload?.delivered === "number" ? `${payload.delivered}개` : "수량 없음";
      const delivery = zoneCalc?.deliveryMinutes !== undefined ? ` · ${formatMin(zoneCalc.deliveryMinutes)}` : "";
      const efficiency = zoneCalc?.efficiencyPerHour !== undefined ? ` · ${Math.round(zoneCalc.efficiencyPerHour)}개/시간` : "";
      entries.push({ title: `${zoneName} 완료`, time, detail: `${delivered}${delivery}${efficiency}`, kind: "done" });
    } else if (event.type === "incident") {
      const title = typeof payload?.title === "string" ? payload.title : "이벤트";
      const minutes = typeof payload?.minutes === "number" ? `${payload.minutes}분` : "시간 미입력";
      entries.push({ title, time, detail: `${minutes}${zoneName ? ` / ${zoneName}` : ""}`, kind: "event" });
    } else if (event.type === "helper_add") {
      entries.push({ title: getHelperEventTitle(payload), time, detail: getHelperEventDetail(payload), kind: "event" });
    } else if (event.type === "day_close") {
      entries.push({ title: "업무 종료", time, detail: "오늘 업무가 종료됐습니다.", kind: "done" });
    }
  }

  if (entries.length === 0) {
    entries.push({ title: "업무 시작 전", time: "-", detail: "진접 출발 버튼을 눌러 시작하세요.", kind: "event" });
  }

  return entries;
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

function compareLogEventOrder(a: TimelineEvent, b: TimelineEvent): number {
  const byMinute = minuteTimestamp(a.at) - minuteTimestamp(b.at);
  if (byMinute !== 0) return byMinute;

  const byAdjacentZoneFlow = adjacentZoneFlowPriority(a) - adjacentZoneFlowPriority(b);
  if (byAdjacentZoneFlow !== 0) return byAdjacentZoneFlow;

  const byPriority = logEventPriority(a) - logEventPriority(b);
  if (byPriority !== 0) return byPriority;

  const byTime = Date.parse(a.at) - Date.parse(b.at);
  if (byTime !== 0) return byTime;

  return a.id.localeCompare(b.id);
}

function adjacentZoneFlowPriority(event: TimelineEvent): number {
  if (event.type === "zone_end") return 0;
  if (event.type === "zone_start") return 1;
  return 0;
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
  const rule = kind === "free_received"
    ? "효율 제외"
    : kind === "paid_received"
      ? "효율 포함"
      : "";
  return [quantity, rule].filter(Boolean).join(" · ") || "시간 기록";
}

function buildMijuStartDetail(): string | undefined {
  if (!currentDay) return undefined;
  return buildMijuStartDetailForDay(currentDay);
}

function buildMijuStartDetailForDay(dayRecord: DayRecord): string | undefined {
  const checkpoint = getMijuCheckpointForDay(dayRecord);
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
  if (currentDay.zones.length === 0) return renderWorkOrderStep();

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
  const orderEditor = hasAnyZoneStarted() ? "" : renderZoneOrderEditor();
  return `
    <section class="panel focus">
      <p class="step">${zone.order} / ${escapeHtml(zone.name)}</p>
      <h2>${escapeHtml(zone.name)} 시작</h2>
      <p class="hint">${zone.id === "miju" ? "미주는 1,2,3동과 나머지 수량을 나눠 입력합니다." : "배송 수량과 정리 시작/완료를 분리해서 기록합니다."}</p>
      <div class="segmented">
        <button data-action="zone-start" data-zone="${zone.id}">${escapeHtml(zone.name)} 시작</button>
        ${isExtraZone(zone.id) ? `<button class="secondary" data-action="skip-zone" data-zone="${zone.id}">${escapeHtml(zone.name)} 없음</button>` : ""}
      </div>
      ${orderEditor}
    </section>
  `;
}

function renderZoneOrderEditor(): string {
  const zones = getOrderedZones();
  return `
    <div class="order-editor">
      <strong>오늘 작업 순서</strong>
      <p class="hint">작업 시작 전에는 화살표로 순서를 바꿀 수 있습니다.</p>
      ${zones.map((zone, index) => `
        <div class="order-row">
          <span>${index + 1}. ${escapeHtml(zone.name)}</span>
          <div>
            <button data-action="move-zone-up" data-zone="${zone.id}" ${index === 0 ? "disabled" : ""} title="위로">▲</button>
            <button data-action="move-zone-down" data-zone="${zone.id}" ${index === zones.length - 1 ? "disabled" : ""} title="아래로">▼</button>
          </div>
        </div>
      `).join("")}
      <div class="segmented">
        <button data-action="add-alt-zone-to-order">대체배송 추가</button>
        <button data-action="add-custom-zone-to-order">추가구역 추가</button>
      </div>
      <label>추가구역 이름<input id="custom-zone-name" type="text" maxlength="24" placeholder="예: 상가 추가"></label>
    </div>
  `;
}

function renderZoneWorkStep(zone: ZoneRecord): string {
  if (zone.id === "miju") return renderMijuWorkStep();
  if (zone.id === "hils") return renderHilsWorkStep();
  return renderExtraZoneWorkStep(zone);
}

function renderMijuWorkStep(): string {
  const checkpoint = getMijuCheckpoint();
  const savedText = checkpoint
    ? `A구간 저장됨: 1동 ${checkpoint.one} / 2동 ${checkpoint.two} / 3동 ${checkpoint.three} / 합계 ${checkpoint.aTotal}`
    : "1/2/3동을 먼저 기록한 뒤 미주 전체 수량을 넣으면 나머지는 자동 계산됩니다.";
  return `
    <section class="panel focus">
      <p class="step">3 / 미주</p>
      <h2>미주 수량 입력</h2>
      <p class="hint">${savedText}</p>
      <div class="form-grid compact-grid">
        <label>1동<input id="miju-1-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.one ?? ""}" placeholder="예: 44"></label>
        <label>2동<input id="miju-2-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.two ?? ""}" placeholder="예: 55"></label>
        <label>3동<input id="miju-3-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" value="${checkpoint?.three ?? ""}" placeholder="예: 54"></label>
      </div>
      <button data-action="save-miju-detail" data-zone="miju">1/2/3동 기록</button>
      ${checkpoint ? '<button class="secondary" data-action="clear-miju-detail" data-zone="miju">1/2/3동 기록 초기화</button>' : ""}
      <label>미주 전체 수량<input id="miju-total-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" placeholder="예: 321"></label>
      <div class="miju-preview">
        <strong>저장 기준</strong>
        <span>나머지는 미주 전체 수량에서 1/2/3동 합계를 빼서 자동 계산됩니다.</span>
      </div>
      <button data-action="zone-end" data-zone="miju">미주 완료</button>
    </section>
  `;
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
  const extraCount = getExtraZones().length;
  return `
    <section class="panel focus">
      <p class="step">5 / 추가 구역</p>
      <h2>대체배송 또는 구역 추가</h2>
      <p class="hint">힐스 이후에 생긴 대체배송, 임시 구역, 추가 물량을 여기에 붙입니다. 없으면 바로 업무 종료로 넘어가면 됩니다.</p>
      <div class="segmented">
        <button data-action="add-alt-zone">대체배송 추가</button>
        <button data-action="close-day">추가 없이 종료</button>
      </div>
      <div class="form-grid extra-zone-form">
        <label>구역 이름<input id="custom-zone-name" type="text" maxlength="24" placeholder="예: 상가 추가"></label>
        <button data-action="add-custom-zone">구역 추가</button>
      </div>
      ${extraCount > 0 ? `<p class="hint">오늘 추가 구역 ${extraCount}개가 기록됐습니다.</p>` : ""}
    </section>
  `;
}

function renderExtraZoneWorkStep(zone: ZoneRecord): string {
  return renderGenericZoneWorkStep(zone.id, {
    step: `추가 / ${zone.name}`,
    title: `${zone.name} 입력`,
    countInputId: "extra-count",
    endLabel: `${zone.name} 완료`,
  });
}

function renderGenericZoneWorkStep(
  zoneId: string,
  options: { step: string; title: string; countInputId: string; endLabel: string },
): string {
  const sortingStarted = hasZoneEvent(zoneId, "sorting_start");
  const sortingEnded = hasZoneEvent(zoneId, "sorting_end");
  const deliveryStarted = hasZoneEvent(zoneId, "delivery_start");
  const isReadyForCount = deliveryStarted || sortingEnded;

  return `
    <section class="panel focus">
      <p class="step">${options.step}</p>
      <h2>${options.title}</h2>
      ${!sortingStarted && !deliveryStarted ? `
        <div class="field-actions">
          <button data-action="sorting-start" data-zone="${zoneId}">정리 시작</button>
          <button class="secondary" data-action="delivery-start" data-zone="${zoneId}">바로 배송 시작</button>
        </div>
        <p class="hint">기본 흐름은 정리 시작입니다. 정리 없이 바로 배송할 때만 보조 버튼을 누릅니다.</p>
      ` : ""}
      ${sortingStarted && !sortingEnded ? `
        <button data-action="sorting-end" data-zone="${zoneId}">정리 완료</button>
        <p class="hint">정리가 끝나면 바로 정리 완료를 누르고 수량 입력으로 넘어갑니다.</p>
      ` : ""}
      ${isReadyForCount ? `
        <label>전체 수량<input id="${options.countInputId}" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" placeholder="예: 560"></label>
        <button data-action="zone-end" data-zone="${zoneId}">${options.endLabel}</button>
        <p class="hint">뒤 구역에서는 당일 전체 수량을 넣어도 됩니다. 이전 완료 수량은 앱이 자동으로 뺍니다.</p>
      ` : ""}
    </section>
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
        <label>도우미 배송 수량<input id="helper-received-count" type="text" inputmode="numeric" maxlength="3" data-numeric-limit="3" placeholder="예: 13"></label>
        <div class="segmented">
          <button data-action="add-helper-free">도우미 배송 무료</button>
          <button data-action="add-helper-paid">도우미 배송 유료</button>
        </div>
        <p class="hint">무료는 총수량에는 포함하고 효율에서는 제외합니다. 유료는 총수량과 효율에 모두 포함합니다.</p>
      </div>
    </section>
  `;
}

function renderFinishedStep(): string {
  return `
    <section class="panel focus">
      <p class="step">완료</p>
      <h2>오늘 업무가 종료됐습니다</h2>
      <p class="hint">리포트를 복사하거나, 아래 완료 구역 수정에서 잘못 찍은 값을 고칠 수 있습니다.</p>
    </section>
  `;
}

function renderCleanupCorrectionPanel(zoneId: string): string {
  return `
    <section class="warning">
      <strong>정리 완료가 비어 있습니다.</strong>
      <p>${getZoneName(zoneId)} 정리 시간을 입력하면 종료 시각 기준으로 보정합니다.</p>
      <div class="form-grid">
        <label>정리 시간<input id="cleanup-input" type="number" inputmode="numeric" min="1" value="30"></label>
        <label>처리 방식<input value="종료시각 - 입력분" readonly></label>
      </div>
      <div class="segmented">
        <button data-action="fix-cleanup" data-zone="${zoneId}">보정 적용</button>
        <button data-action="skip-cleanup" data-zone="${zoneId}">정리 없음</button>
      </div>
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
  const showSorting = zoneId !== "miju";
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
  const quantitySummary = zoneId === "miju"
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
      <div class="form-grid edit-count-grid ${zoneId === "miju" ? "miju-edit-grid" : "generic-edit-grid"}">
        ${zoneId === "miju"
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
  const id = zoneId.toLowerCase();
  const name = getZoneNameFromDay(dayRecord, zoneId);
  if (id === "miju" || id.includes("miju") || name.includes("미주")) return "miju";
  if (id === "hils" || id.includes("hils") || name.includes("힐스")) return "hils";
  return "alternate";
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
      <strong>현장앱 백업 가져오기 결과</strong>
      <p>${escapeHtml(lastImportFeedback.message)}</p>
      <ul>
        <li>파일: ${escapeHtml(lastImportFeedback.fileName)}</li>
        <li>인식한 날짜: ${lastImportFeedback.recognizedDays}일</li>
        <li>가져온 기록: ${lastImportFeedback.importedCount}일 (${escapeHtml(imported)})</li>
        <li>복사/건너뜀: ${lastImportFeedback.skippedCount}일 (${escapeHtml(skipped)})</li>
        <li>사전 스냅샷: ${lastImportFeedback.snapshotCreated ? "생성됨" : "없음"}</li>
        <li>백업 파일: ${lastImportFeedback.backupExported ? "내보내기 시도됨" : "없음"}</li>
        ${lastImportFeedback.activeDate ? `<li>현재 표시 날짜: ${escapeHtml(lastImportFeedback.activeDate)}</li>` : ""}
      </ul>
    </aside>
  `;
}

async function handleAction(button: HTMLButtonElement): Promise<void> {
  if (!currentDay) return;

  const action = button.dataset.action ?? "";
  const zoneId = button.dataset.zone;

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
    await loadToday();
    render();
    return;
  }
  if (action === "copy-report") {
    const report = buildDailyReport(currentDay, calculateDay(currentDay), { title: "Delivery Master Install Report" });
    await navigator.clipboard.writeText(report.text);
    toast("리포트를 복사했습니다.");
    return;
  }
  if (action === "snapshot") {
    const backup = await store.createBackup({ kind: "all" });
    downloadJsonFile(backup, buildBackupFilename("manual"));
    toast("백업 파일 내보내기를 시작했습니다.");
    return;
  }
  if (action === "import-field-backup") {
    await importFieldBackupFile();
    return;
  }
  if (action === "reset-confirm") {
    if (!confirm("오늘 기록을 초기화할까요? 먼저 스냅샷을 만든 뒤 진행합니다.")) return;
    await downloadPreparedSnapshot("reset-before", { kind: "date", date: currentDay.date });
    currentDay = createEmptyDay(currentDay.date);
    await store.saveDay(currentDay);
    await refreshHistory();
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
    saveMijuCheckpoint();
    await saveAndRender();
    return;
  }
  if (action === "clear-miju-detail") {
    clearMijuCheckpoint();
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
  if (action === "apply-zone-correction" && zoneId) {
    await applyZoneCorrection(zoneId);
    return;
  }
  if (action === "save-helper-correction") {
    await saveHelperCorrection(button.dataset.helper);
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
  if (action === "zone-start" && zoneId) addZoneStart(zoneId);
  if (action === "sorting-start" && zoneId) addZoneEvent("sorting_start", zoneId);
  if (action === "sorting-end" && zoneId) addZoneEvent("sorting_end", zoneId);
  if (action === "delivery-start" && zoneId) addDeliveryStart(zoneId);
  if (action === "zone-end" && zoneId) await addZoneEnd(zoneId);
  if (action === "close-day-now" && isUnpaidHelperDay(currentDay)) {
    const closeAt = nowIso();
    addUnpaidHelperEvent(closeAt);
    addEvent("day_close", undefined, closeAt);
    await saveAndRender();
    await downloadFullBackup(PHONE_INSTALL_BACKUP_FILENAME);
    toast("업무 종료 저장 완료. 전체 백업 내보내기를 시작했습니다.");
    return;
  }
  if (action === "close-day") {
    const closeAt = isUnpaidHelperDay(currentDay) ? readHelperCloseAt() : nowIso();
    if (isUnpaidHelperDay(currentDay)) addUnpaidHelperEvent(closeAt);
    addEvent("day_close", undefined, closeAt);
    await saveAndRender();
    await downloadFullBackup(PHONE_INSTALL_BACKUP_FILENAME);
    toast("업무 종료 저장 완료. 전체 백업 내보내기를 시작했습니다.");
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
  ensureZone(id, defaultName, getNextZoneOrder());
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
  ensureZone(createExtraZoneId("alt"), "대체배송", 3);
}

function addZoneToOrder(kind: "alt" | "custom", requestedName?: string): void {
  if (!currentDay || hasAnyZoneStarted()) return;
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

function moveZone(zoneId: string, direction: -1 | 1): void {
  if (!currentDay || hasAnyZoneStarted()) return;
  const ordered = getOrderedZones();
  const index = ordered.findIndex((zone) => zone.id === zoneId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
  const next = [...ordered];
  const [item] = next.splice(index, 1);
  if (!item) return;
  next.splice(targetIndex, 0, item);
  currentDay.zones = next.map((zone, orderIndex) => ({ ...zone, order: orderIndex + 1 }));
}

function normalizeZoneOrders(): void {
  if (!currentDay) return;
  currentDay.zones = getOrderedZones().map((zone, index) => ({ ...zone, order: index + 1 }));
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
  const quantity = readLimitedNumber("#helper-received-count", 3);
  if (quantity <= 0) {
    toast("도우미 배송 수량을 입력하세요.");
    return;
  }
  const label = getHelperKindLabel(kind);
  addReceivedHelperRecord({
    kind,
    quantity,
    at: readOptionalTimeInput("#event-at") ?? nowIso(),
    name: label,
    memo: readText("#event-note", ""),
  });
  toast(`${label} ${quantity}개를 기록했습니다.`);
}

async function applyZoneCorrection(zoneId: string): Promise<void> {
  const kind = readZoneCorrectionKind(zoneId);
  if (!kind) {
    toast("정정 종류를 선택하세요.");
    return;
  }
  await convertCompletedZoneToHelper(zoneId, kind);
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
  await downloadPreparedSnapshot("helper-convert-before", { kind: "date", date: currentDay.date });
  const linkedEventIds = currentDay.timeline
    .filter((event) => event.zoneId === zoneId)
    .map((event) => event.id);
  const at = end.at;
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.filter((event) => event.zoneId !== zoneId),
    zones: currentDay.zones.filter((candidate) => candidate.id !== zoneId),
    adjustments: [
      ...currentDay.adjustments,
      {
        id: `helper-convert-${Date.now()}`,
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
  if (!kind) {
    toast("도우미 종류를 선택하세요.");
    return;
  }
  if (quantity <= 0) {
    toast("도우미 배송 수량을 입력하세요.");
    return;
  }
  if (!at) {
    toast("도우미 기록 시각을 입력하세요.");
    return;
  }
  const label = getHelperKindLabel(kind);
  await downloadPreparedSnapshot("helper-correction-before", { kind: "date", date: currentDay.date });
  const linkedIds = new Set(helper.linkedEventIds);
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.map((event) => {
      if (event.type !== "helper_add" || !linkedIds.has(event.id)) return event;
      const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
      return {
        ...event,
        at,
        payload: {
          ...payload,
          name: label,
          helperKind: kind,
          quantity,
          countsForEfficiency: kind === "paid_received",
        },
      };
    }),
    helpers: currentDay.helpers.map((candidate) => candidate.id === helperId
      ? {
          ...candidate,
          name: label,
          kind,
          quantity,
          countsForEfficiency: kind === "paid_received",
          memo: candidate.memo ? `${candidate.memo} / 재수정: ${label} ${quantity}개` : `재수정: ${label} ${quantity}개`,
        }
      : candidate),
    adjustments: [
      ...currentDay.adjustments,
      {
        id: `helper-correction-${Date.now()}`,
        eventId: helper.linkedEventIds[0],
        reason: "helper_record_correction",
        note: `${helper.name} -> ${label} ${quantity}개`,
        createdAt: nowIso(),
      },
    ],
    meta: {
      ...currentDay.meta,
      updatedAt: nowIso(),
      recoveryStatus: currentDay.meta.recoveryStatus === "none" ? "needsReview" : currentDay.meta.recoveryStatus,
    },
  };
  toast(`${label} ${quantity}개로 다시 저장했습니다.`);
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
  await downloadPreparedSnapshot("helper-restore-before", { kind: "date", date: currentDay.date });
  const startAt = addMinutes(event.at, -5);
  const endAt = event.at;
  currentDay = {
    ...currentDay,
    timeline: currentDay.timeline.filter((candidate) => !linkedIds.has(candidate.id)),
    helpers: currentDay.helpers.filter((candidate) => candidate.id !== helperId),
    adjustments: [
      ...currentDay.adjustments,
      {
        id: `helper-restore-${Date.now()}`,
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
    note: "도우미 기록에서 구역으로 복구됨. 시간/상세 검토 필요.",
  });
  normalizeZoneOrders();
  toast(`${zoneName} ${quantity}개 구역 기록으로 복구했습니다. 시간은 검토 필요로 남겼습니다.`);
  await saveAndRender();
}

function addReceivedHelperRecord(input: {
  kind: "free_received" | "paid_received";
  quantity: number;
  at: string;
  name: string;
  memo?: string;
  sourceZoneId?: string;
  previousEventIds?: string[];
}): void {
  if (!currentDay) return;
  const helperId = `helper-${input.kind}-${Date.now()}`;
  const helperEventId = `helper-event-${input.kind}-${Date.now()}`;
  currentDay = createEvent(currentDay, {
    id: helperEventId,
    type: "helper_add",
    at: input.at,
    payload: {
      helperId,
      name: input.name,
      action: "add",
      helperKind: input.kind,
      quantity: input.quantity,
      countsForEfficiency: input.kind === "paid_received",
      sourceZoneId: input.sourceZoneId,
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

function saveMijuCheckpoint(): void {
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
    zoneId: "miju",
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

function clearMijuCheckpoint(): void {
  if (!currentDay) return;
  currentDay = createEvent(currentDay, {
    type: "manual_adjust",
    at: nowIso(),
    zoneId: "miju",
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
}

function addDeliveryStart(zoneId: string): void {
  if (!currentDay || hasZoneEvent(zoneId, "delivery_start")) return;
  ensureZone(zoneId);
  currentDay = createEvent(currentDay, { type: "delivery_start", at: nowIso(), zoneId });
  linkLatestEvent(zoneId, "delivery_start", "deliveryStartEventId");
}

async function addZoneEnd(zoneId: string): Promise<void> {
  if (!currentDay || hasZoneEnded(zoneId)) return;
  const zone = ensureZone(zoneId);
  if (zoneId !== "miju" && !hasZoneEvent(zoneId, "sorting_start") && !hasZoneEvent(zoneId, "delivery_start")) {
    toast("정리 시작 또는 바로 배송 시작을 먼저 선택하세요.");
    return;
  }
  if (zoneId !== "miju" && hasZoneEvent(zoneId, "sorting_start") && !hasZoneEvent(zoneId, "sorting_end")) {
    toast("정리 완료를 먼저 기록해야 합니다.");
    return;
  }

  const mijuInput = zoneId === "miju" ? readMijuInputParts() : undefined;
  const deliveredInput = zoneId === "miju" ? undefined : readZoneDelivered(zoneId);
  if (zoneId === "miju" && mijuInput?.hasDetail && !mijuInput.totalHasValue) {
    toast("미주 전체 수량을 입력해야 나머지를 자동 계산할 수 있습니다.");
    return;
  }
  const rawDelivered = mijuInput?.total ?? deliveredInput?.value ?? 0;
  const hasValue = mijuInput ? mijuInput.totalHasValue || mijuInput.hasDetail : Boolean(deliveredInput?.hasValue);
  const delivered = resolveValidatedDelivered(zoneId, rawDelivered, hasValue);
  if (delivered === undefined) return;
  const mijuParts = mijuInput ? buildMijuPartsFromZoneTotal(mijuInput, delivered) : undefined;
  if (mijuParts?.ok === false) {
    toast(mijuParts.message ?? "미주 수량을 확인하세요.");
    return;
  }
  currentDay = createEvent(currentDay, {
    type: "zone_end",
    at: nowIso(),
    zoneId,
    payload: {
      total: delivered,
      delivered,
      failed: 0,
      extra: 0,
      zoneName: zone.name,
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
}

async function correctCleanup(zoneId?: string): Promise<void> {
  if (!currentDay || !zoneId) return;
  const result = applyMissingCleanupCorrection(currentDay, {
    zoneId,
    closeAt: findLatestZoneCloseAt(currentDay, zoneId) ?? nowIso(),
    minutes: readNumber("#cleanup-input", 30),
    source: "zone_close_prompt",
  });
  currentDay = result.dayRecord;
  await saveAndRender();
}

async function saveCompletedZoneEdit(zoneId: string): Promise<void> {
  if (!currentDay) return;
  const mijuEditInput = zoneId === "miju" ? readMijuEditInputParts(zoneId) : undefined;
  const deliveredInput = zoneId === "miju" ? undefined : readLimitedNumberField(`#edit-${zoneId}-delivered`, 3);
  const rawDelivered = mijuEditInput?.total ?? deliveredInput?.value ?? 0;
  const hasValue = mijuEditInput ? mijuEditInput.totalHasValue || mijuEditInput.hasDetail : Boolean(deliveredInput?.hasValue);
  const delivered = resolveValidatedDelivered(zoneId, rawDelivered, hasValue);
  if (delivered === undefined) return;
  const editParts = mijuEditInput ? buildMijuPartsFromZoneTotal(mijuEditInput, delivered) : undefined;
  if (editParts?.ok === false) {
    toast(editParts.message ?? "수정 수량을 확인하세요.");
    return;
  }
  const start = latestZoneEvent(zoneId, "zone_start");
  const end = latestZoneEvent(zoneId, "zone_end");
  const sortingStart = latestZoneEvent(zoneId, "sorting_start");
  const sortingEnd = latestZoneEvent(zoneId, "sorting_end");
  const startAt = readOptionalTimeInput(`#edit-${zoneId}-start`, start?.at);
  const endAt = readOptionalTimeInput(`#edit-${zoneId}-end`, end?.at);
  const sortingStartAt = readOptionalTimeInput(`#edit-${zoneId}-sorting-start`, sortingStart?.at);
  const sortingEndAt = readOptionalTimeInput(`#edit-${zoneId}-sorting-end`, sortingEnd?.at);
  const timeError = validateZoneEditTimes(zoneId, { startAt, endAt, sortingStartAt, sortingEndAt });
  if (timeError) {
    toast(timeError);
    return;
  }
  await downloadPreparedSnapshot("zone-edit-before", { kind: "date", date: currentDay.date });
  currentDay = applyCompletedZoneEdit(currentDay, {
    zoneId,
    startAt,
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
  toast("완료 구역 수정이 저장됐습니다.");
  await saveAndRender();
}

function validateZoneEditTimes(zoneId: string, input: {
  startAt?: string;
  endAt?: string;
  sortingStartAt?: string;
  sortingEndAt?: string;
}): string | undefined {
  if (isAfter(input.startAt, input.endAt)) return "구역 시작 시각이 종료 시각보다 늦습니다.";
  if (isAfter(input.sortingStartAt, input.sortingEndAt)) return "정리 시작 시각이 정리 완료 시각보다 늦습니다.";
  if (isAfter(input.startAt, input.sortingStartAt)) return "정리 시작 시각이 구역 시작보다 빠를 수 없습니다.";
  if (isAfter(input.sortingEndAt, input.endAt)) return "정리 완료 시각이 구역 종료보다 늦을 수 없습니다.";
  const arrive = currentDay?.timeline.find((event) => event.type === "arrive_cheongnyangni");
  if (isBefore(input.startAt, arrive?.at)) return "구역 시작은 청량리 도착보다 빠를 수 없습니다.";

  const previousEndAt = getPreviousZoneEndAt(zoneId);
  if (isBefore(input.startAt, previousEndAt)) return "구역 시작은 이전 구역 완료보다 빠를 수 없습니다.";

  const nextStartAt = getNextZoneStartAt(zoneId);
  if (isAfter(input.endAt, nextStartAt)) return "구역 종료는 다음 구역 시작보다 늦을 수 없습니다.";

  const dayClose = currentDay?.timeline.find((event) => event.type === "day_close");
  if (isAfter(input.endAt, dayClose?.at)) return "구역 종료는 업무 종료보다 늦을 수 없습니다.";
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
  if (zoneId === "miju") return nowIso();
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
  await buildPhoneInstallDashboard(store);
  await refreshHistory();
  render();
}

async function refreshHistory(): Promise<void> {
  const summaries = await store.listDates();
  const days = await Promise.all(summaries.map((summary) => store.getDay(summary.date)));
  historyDays = days.filter((day): day is DayRecord => Boolean(day));
}

async function importFieldBackupFile(): Promise<void> {
  const file = await pickJsonFile();
  if (!file) return;

  try {
    const data = await readJsonFile(file);
    const migration = buildFieldAppMigrationBackup(data, { appVersion: APP_VERSION });
    const recognizedDays = migration.backup.days.length;
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

    const dates = migration.backup.days.map((day) => day.date).join(", ");
    const ok = confirm(
      `현장앱 백업에서 ${recognizedDays}일치를 찾았습니다.\n\n${dates}\n\n가져오기 전에 전체 백업 파일을 내보냅니다.\n빈 오늘 기록은 가져온 기록으로 자동 보정하고, 실제 기록이 있는 날짜는 복사본으로 보호합니다.`,
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
    downloadJsonFile(beforeBackup, buildBackupFilename("before-import"));

    const result = await applyFieldImportWithAutoCorrection(migration.backup.days);
    await refreshHistory();
    currentDay = await pickDayToDisplayAfterImport(result.importedDates) ?? currentDay;

    const afterBackup = await store.createBackup({ kind: "all" });
    downloadJsonFile(afterBackup, buildBackupFilename("after-import"));

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
    lastImportFeedback = {
      fileName: file.name,
      recognizedDays: 0,
      importedCount: 0,
      skippedCount: 0,
      importedDates: [],
      skippedDates: [],
      message: error instanceof Error ? error.message : "현장앱 백업 가져오기 실패",
      snapshotCreated: false,
      backupExported: false,
    };
    render();
    toast(error instanceof Error ? error.message : "현장앱 백업 가져오기 실패");
  }
}

interface AutoImportResult {
  importedDates: string[];
  protectedDates: string[];
}

async function applyFieldImportWithAutoCorrection(days: DayRecord[]): Promise<AutoImportResult> {
  const importedDates: string[] = [];
  const protectedDates: string[] = [];

  for (const incoming of days) {
    const existing = await store.getDay(incoming.date);

    if (!existing || isAutoReplaceableEmptyDay(existing)) {
      await store.saveDay({
        ...incoming,
        meta: {
          ...incoming.meta,
          updatedAt: nowIso(),
          recoveryStatus: existing ? "needsReview" : incoming.meta.recoveryStatus,
        },
      });
      importedDates.push(incoming.date);
      continue;
    }

    const copy = createBackupCopyDay(incoming);
    await store.saveDay(copy);
    importedDates.push(copy.date);
    protectedDates.push(`${incoming.date} -> ${copy.date}`);
  }

  return { importedDates, protectedDates };
}

function isAutoReplaceableEmptyDay(day: DayRecord): boolean {
  return day.status === "draft"
    && day.timeline.length === 0
    && day.zones.length === 0
    && day.helpers.length === 0
    && day.adjustments.length === 0;
}

async function pickDayToDisplayAfterImport(importedDates: string[]): Promise<DayRecord | null> {
  const today = todayKey();
  if (importedDates.includes(today)) return store.getDay(today);
  const firstDate = importedDates[0];
  return firstDate ? store.getDay(firstDate) : store.getDay(today);
}

function downloadJsonFile(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadFullBackup(filename: string): Promise<void> {
  const backup = await store.createBackup({ kind: "all" });
  downloadJsonFile(backup, filename);
}

async function downloadPreparedSnapshot(
  label: string,
  scope: Parameters<typeof preparePhoneInstallUpdate>[1] = { kind: "all" },
): Promise<void> {
  const plan = await preparePhoneInstallUpdate(store, scope);
  downloadJsonFile(plan.snapshot, buildBackupFilename(label));
}

function buildBackupFilename(label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return PHONE_INSTALL_BACKUP_FILENAME.replace(/\.json$/i, `_${label}_${stamp}.json`);
}

function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.click();
  });
}

async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
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
  return [...currentDay.zones]
    .sort((a, b) => a.order - b.order)
    .find((zone) => !hasZoneEnded(zone.id));
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

function getMijuCheckpoint(): { one: number; two: number; three: number; rest: number; aTotal: number } | undefined {
  if (!currentDay) return undefined;
  return getMijuCheckpointForDay(currentDay);
}

function getMijuCheckpointForDay(dayRecord: DayRecord): { one: number; two: number; three: number; rest: number; aTotal: number } | undefined {
  const event = [...dayRecord.timeline]
    .reverse()
    .find((candidate) =>
      candidate.type === "manual_adjust" &&
      candidate.zoneId === "miju" &&
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

function mergeCurrentDateAndTime(value: string, existingIso?: string): string | undefined {
  if (!currentDay) return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const existing = existingIso ? new Date(existingIso) : undefined;
  if (existing && !Number.isNaN(existing.getTime()) && formatTimeOnlyValue(existing) === value) {
    return existingIso;
  }
  const [year, month, day] = currentDay.date.split("-").map(Number);
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
  if (zoneId === "miju") {
    const parts = readMijuPayloadParts();
    return { value: parts.delivered, hasValue: parts.totalHasValue || parts.hasDetail };
  }
  if (zoneId === "hils") return readLimitedNumberField("#hils-count", 3);
  return readLimitedNumberField("#extra-count", 3);
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
  const total = readLimitedNumberField("#miju-total-count", 3);
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

function resolveValidatedDelivered(zoneId: string, entered: number, hasValue: boolean): number | undefined {
  if (!currentDay) return undefined;
  const zoneName = getZoneName(zoneId);
  const result = validateZoneQuantity({
    zoneName,
    entered,
    hasValue,
    expectedTotal: getExpectedTotal(),
    completedOther: getCompletedDeliveredTotal(zoneId),
    maxReasonable: MAX_REASONABLE_ZONE,
  });

  if (!result.ok) {
    toast(result.message ?? `${zoneName} 수량을 확인하세요.`);
    return undefined;
  }

  if (result.suggestedValue !== undefined) {
    toast(`${zoneName} ${entered}개에서 이전 완료 ${getCompletedDeliveredTotal(zoneId)}개를 빼 ${result.suggestedValue}개로 저장합니다.`);
    return result.suggestedValue;
  }

  if (result.warning) {
    const ok = confirm(`${result.warning}\n\n그대로 저장할까요?`);
    return ok ? entered : undefined;
  }

  return result.value;
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
    return sum + (typeof payload.quantity === "number" ? payload.quantity : 0);
  }, 0);
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
  const input = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-helper-at]"))
    .find((candidate) => candidate.dataset.helperAt === helperId);
  if (!input?.value) return undefined;
  const parsed = new Date(input.value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function toast(message: string): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker registration failed; app boot continues.", error);
  }
}
