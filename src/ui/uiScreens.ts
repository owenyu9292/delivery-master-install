import { calculateDay } from "../domain/deliveryCalc";
import { deriveLog } from "../domain/eventTimeline";
import type {
  CalculationWarning,
  DayCalculation,
  DayRecord,
  DayStatus,
  LogEntry,
  RecoveryStatus,
  ReportResult,
} from "../domain/types";
import { buildDailyReport, buildPreviewModel, type ReportPreview } from "../domain/reportBuilder";
import { createDateSummary, type DateSummary } from "../storage/dayStore";

export type UiScreenKey =
  | "work"
  | "logs"
  | "report"
  | "dates"
  | "stats"
  | "settings"
  | "backup";

export interface UiNavigationItem {
  key: UiScreenKey;
  label: string;
  detail: string;
}

export interface UiScreensInput {
  dayRecord: DayRecord;
  history?: DayRecord[];
  dateSummaries?: DateSummary[];
  selectedDate?: string;
  monthKey?: string;
}

export interface UiScreensBundle {
  navigation: UiNavigationItem[];
  work: WorkScreenModel;
  logs: LogScreenModel;
  report: ReportScreenModel;
  dates: DateIndexScreenModel;
  stats: MonthlyStatsScreenModel;
  settings: SettingsScreenModel;
  backup: BackupRecoveryScreenModel;
}

export interface WorkScreenModel {
  title: string;
  day: {
    date: string;
    status: DayStatus;
    recoveryStatus: RecoveryStatus;
    eventCount: number;
    zoneCount: number;
    helperCount: number;
  };
  stage: WorkStage;
  summary: string;
  quickActions: string[];
}

export type WorkStage =
  | "ready"
  | "working"
  | "sorting"
  | "delivering"
  | "closing"
  | "closed";

export interface LogScreenModel {
  title: string;
  entries: LogEntry[];
  sourceEventIds: string[];
  emptyState: string;
}

export interface ReportScreenModel {
  title: string;
  preview: ReportPreview;
  report: ReportResult;
  warnings: CalculationWarning[];
  actions: string[];
}

export interface DateIndexScreenModel {
  title: string;
  selectedDate?: string;
  items: DateSummary[];
  statusCounts: Record<DayStatus, number>;
}

export interface MonthlyStatsScreenModel {
  title: string;
  monthKey: string;
  dayCount: number;
  statusCounts: Record<DayStatus, number>;
  recoveryStatusCounts: Record<RecoveryStatus, number>;
  totals: DayCalculation["totals"];
  averageEfficiencyPerHour?: number;
  quantityComparison: ZoneQuantityComparison;
}

export interface WeeklyStatsScreenModel {
  title: string;
  weekKey: string;
  dayCount: number;
  statusCounts: Record<DayStatus, number>;
  recoveryStatusCounts: Record<RecoveryStatus, number>;
  totals: DayCalculation["totals"];
  averageEfficiencyPerHour?: number;
  quantityComparison: ZoneQuantityComparison;
}

export interface ZoneQuantityComparison {
  basis: "deliveredCount";
  totalQuantity: number;
  ratioLabel: string;
  buckets: ZoneQuantityBucket[];
}

export interface ZoneQuantityBucket {
  key: "miju" | "hils" | "alternate";
  label: string;
  quantity: number;
  ratioPart: number;
  percent: number;
}

export interface SettingsScreenModel {
  title: string;
  installMode: "phoneInstall";
  appVersion?: string;
  recoveryStatus: RecoveryStatus;
  storageMode: "offline-first";
  safetyRules: string[];
}

export interface BackupRecoveryScreenModel {
  title: string;
  recoveryStatus: RecoveryStatus;
  backupHint: string;
  safetyRules: string[];
  actions: string[];
}

export function buildUiScreens(input: UiScreensInput): UiScreensBundle {
  const history = input.history ?? [input.dayRecord];
  const calculation = calculateDay(input.dayRecord);
  const report = buildDailyReport(input.dayRecord, calculation);
  const preview = buildPreviewModel(input.dayRecord, calculation);
  const logEntries = deriveLog(input.dayRecord);
  const dateSummaries = input.dateSummaries ?? history.map((dayRecord) => createDateSummary(dayRecord));
  const monthKey = input.monthKey ?? input.dayRecord.date.slice(0, 7);
  const monthRecords = history.filter((dayRecord) => dayRecord.date.startsWith(monthKey));

  return {
    navigation: buildNavigation(calculation, report, dateSummaries, monthRecords.length),
    work: buildWorkScreen(input.dayRecord, calculation),
    logs: buildLogScreen(logEntries),
    report: buildReportScreen(report, preview, calculation),
    dates: buildDateIndexScreen(dateSummaries, input.selectedDate),
    stats: buildMonthlyStatsScreen(monthRecords, monthKey),
    settings: buildSettingsScreen(input.dayRecord),
    backup: buildBackupRecoveryScreen(input.dayRecord, dateSummaries.length),
  };
}

export function buildWorkScreen(dayRecord: DayRecord, calculation?: DayCalculation): WorkScreenModel {
  const derived = calculation ?? calculateDay(dayRecord);

  return {
    title: "Work",
    day: {
      date: dayRecord.date,
      status: dayRecord.status,
      recoveryStatus: dayRecord.meta.recoveryStatus,
      eventCount: dayRecord.timeline.length,
      zoneCount: derived.zones.length,
      helperCount: dayRecord.helpers.length,
    },
    stage: inferWorkStage(dayRecord),
    summary: summarizeWork(dayRecord, derived),
    quickActions: ["add_event", "open_logs", "open_report", "open_backup"],
  };
}

export function buildLogScreen(entries: LogEntry[]): LogScreenModel {
  return {
    title: "Logs",
    entries,
    sourceEventIds: entries.map((entry) => entry.eventId),
    emptyState: entries.length > 0 ? "" : "No timeline events yet.",
  };
}

export function buildReportScreen(
  report: ReportResult,
  preview: ReportPreview,
  calculation?: DayCalculation,
): ReportScreenModel {
  return {
    title: "Report",
    preview,
    report,
    warnings: calculation?.warnings ?? report.warnings,
    actions: ["copy_report", "open_logs", "review_warnings"],
  };
}

export function buildDateIndexScreen(
  items: DateSummary[],
  selectedDate?: string,
): DateIndexScreenModel {
  const sorted = [...items].sort((left, right) => right.date.localeCompare(left.date));

  return {
    title: "Date Index",
    selectedDate,
    items: sorted,
    statusCounts: countStatuses(sorted),
  };
}

export function buildMonthlyStatsScreen(
  history: DayRecord[],
  monthKey: string,
): MonthlyStatsScreenModel {
  const monthDays = history.filter((dayRecord) => dayRecord.date.startsWith(monthKey));
  const calculations = monthDays.map((dayRecord) => calculateDay(dayRecord));
  const totalCount = calculations.reduce((sum, calculation) => sum + calculation.totals.totalCount, 0);
  const deliveredCount = calculations.reduce((sum, calculation) => sum + calculation.totals.deliveredCount, 0);
  const failedCount = calculations.reduce((sum, calculation) => sum + calculation.totals.failedCount, 0);
  const extraCount = calculations.reduce((sum, calculation) => sum + calculation.totals.extraCount, 0);
  const totalElapsedMinutes = sumOptional(
    calculations.map((calculation) => calculation.totals.totalElapsedMinutes),
  );
  const deliveryMinutes = sumOptional(calculations.map((calculation) => calculation.totals.deliveryMinutes));
  const efficiencyPerHour = calculateAverageEfficiency(calculations);

  return {
    title: "Monthly Stats",
    monthKey,
    dayCount: monthDays.length,
    statusCounts: countStatuses(monthDays.map((dayRecord) => createDateSummary(dayRecord))),
    recoveryStatusCounts: countRecoveryStatuses(monthDays.map((dayRecord) => createDateSummary(dayRecord))),
    totals: {
      totalCount,
      deliveredCount,
      failedCount,
      extraCount,
      totalElapsedMinutes,
      deliveryMinutes,
      efficiencyPerHour,
    },
    averageEfficiencyPerHour: efficiencyPerHour,
    quantityComparison: buildZoneQuantityComparison(monthDays),
  };
}

export function buildWeeklyStatsScreen(
  history: DayRecord[],
  weekKey: string,
): WeeklyStatsScreenModel {
  const weekDays = history.filter((dayRecord) => getIsoWeekKey(dayRecord.date) === weekKey);
  const calculations = weekDays.map((dayRecord) => calculateDay(dayRecord));
  const totalCount = calculations.reduce((sum, calculation) => sum + calculation.totals.totalCount, 0);
  const deliveredCount = calculations.reduce((sum, calculation) => sum + calculation.totals.deliveredCount, 0);
  const failedCount = calculations.reduce((sum, calculation) => sum + calculation.totals.failedCount, 0);
  const extraCount = calculations.reduce((sum, calculation) => sum + calculation.totals.extraCount, 0);
  const totalElapsedMinutes = sumOptional(
    calculations.map((calculation) => calculation.totals.totalElapsedMinutes),
  );
  const deliveryMinutes = sumOptional(calculations.map((calculation) => calculation.totals.deliveryMinutes));
  const efficiencyPerHour = calculateAverageEfficiency(calculations);

  return {
    title: "Weekly Stats",
    weekKey,
    dayCount: weekDays.length,
    statusCounts: countStatuses(weekDays.map((dayRecord) => createDateSummary(dayRecord))),
    recoveryStatusCounts: countRecoveryStatuses(weekDays.map((dayRecord) => createDateSummary(dayRecord))),
    totals: {
      totalCount,
      deliveredCount,
      failedCount,
      extraCount,
      totalElapsedMinutes,
      deliveryMinutes,
      efficiencyPerHour,
    },
    averageEfficiencyPerHour: efficiencyPerHour,
    quantityComparison: buildZoneQuantityComparison(weekDays),
  };
}

export function buildSettingsScreen(dayRecord: DayRecord): SettingsScreenModel {
  return {
    title: "Settings",
    installMode: "phoneInstall",
    appVersion: dayRecord.meta.appVersion,
    recoveryStatus: dayRecord.meta.recoveryStatus,
    storageMode: "offline-first",
    safetyRules: [
      "Automatic snapshots before destructive operations.",
      "Explicit reset only. No silent wipe on cancel, back, app switch, or restart.",
      "Recovery UI must stay available for interrupted work.",
    ],
  };
}

export function buildBackupRecoveryScreen(
  dayRecord: DayRecord,
  snapshotCount: number,
): BackupRecoveryScreenModel {
  return {
    title: "Backup & Recovery",
    recoveryStatus: dayRecord.meta.recoveryStatus,
    backupHint:
      snapshotCount > 1
        ? snapshotCount + " date snapshots available for recovery."
        : "Automatic snapshot required before any destructive change.",
    safetyRules: [
      "Automatic snapshots are required.",
      "Explicit reset only. No silent data loss on cancel, back, app switch, or restart.",
      "Recovery UI must be visible before any destructive reset path.",
    ],
    actions: ["export_backup", "import_backup", "open_recovery", "explicit_reset"],
  };
}

function buildNavigation(
  calculation: DayCalculation,
  report: ReportResult,
  items: DateSummary[],
  monthDayCount: number,
): UiNavigationItem[] {
  return [
    { key: "work", label: "Work", detail: calculation.zones.length + " zones" },
    { key: "logs", label: "Logs", detail: calculation.totals.totalCount + " items" },
    { key: "report", label: "Report", detail: report.text.length > 0 ? "ready" : "empty" },
    { key: "dates", label: "Dates", detail: items.length + " days" },
    { key: "stats", label: "Stats", detail: monthDayCount + " days this month" },
    { key: "settings", label: "Settings", detail: "phoneInstall" },
    { key: "backup", label: "Backup", detail: "snapshots on" },
  ];
}

function inferWorkStage(dayRecord: DayRecord): WorkStage {
  const eventTypes = new Set(dayRecord.timeline.map((event) => event.type));

  if (eventTypes.has("day_close")) {
    return "closed";
  }
  if (eventTypes.has("zone_end")) {
    return "closing";
  }
  if (eventTypes.has("delivery_start")) {
    return "delivering";
  }
  if (eventTypes.has("sorting_start") || eventTypes.has("sorting_end")) {
    return "sorting";
  }
  if (eventTypes.has("zone_start")) {
    return "working";
  }

  return "ready";
}

function summarizeWork(dayRecord: DayRecord, calculation: DayCalculation): string {
  return [
    "date=" + dayRecord.date,
    "status=" + dayRecord.status,
    "zones=" + calculation.zones.length,
    "events=" + dayRecord.timeline.length,
    "recovery=" + dayRecord.meta.recoveryStatus,
  ].join(" / ");
}

function countStatuses(items: Array<DateSummary | { status: DayStatus }>): Record<DayStatus, number> {
  return items.reduce<Record<DayStatus, number>>(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    {
      draft: 0,
      active: 0,
      closed: 0,
      reviewNeeded: 0,
    },
  );
}

function countRecoveryStatuses(
  items: Array<DateSummary | { recoveryStatus: RecoveryStatus }>,
): Record<RecoveryStatus, number> {
  return items.reduce<Record<RecoveryStatus, number>>(
    (counts, item) => {
      counts[item.recoveryStatus] += 1;
      return counts;
    },
    {
      none: 0,
      complete: 0,
      partial: 0,
      textOnly: 0,
      needsReview: 0,
      failed: 0,
    },
  );
}

function sumOptional(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number");
  if (defined.length === 0) {
    return undefined;
  }

  return defined.reduce((sum, value) => sum + value, 0);
}

function calculateAverageEfficiency(calculations: DayCalculation[]): number | undefined {
  const values = calculations
    .map((calculation) => calculation.totals.efficiencyPerHour)
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return undefined;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildZoneQuantityComparison(days: DayRecord[]): ZoneQuantityComparison {
  const quantities: Record<ZoneQuantityBucket["key"], number> = {
    miju: 0,
    hils: 0,
    alternate: 0,
  };

  for (const day of days) {
    const calculation = calculateDay(day);
    for (const zone of calculation.zones) {
      quantities[classifyZone(day, zone.zoneId)] += zone.counts.delivered;
    }
  }

  const ordered: Array<{ key: ZoneQuantityBucket["key"]; label: string }> = [
    { key: "miju", label: "미주" },
    { key: "hils", label: "힐스" },
    { key: "alternate", label: "대체배송지" },
  ];
  const divisor = gcdMany(ordered.map((item) => quantities[item.key]));
  const totalQuantity = ordered.reduce((sum, item) => sum + quantities[item.key], 0);
  const buckets = ordered.map<ZoneQuantityBucket>((item) => {
    const quantity = quantities[item.key];
    return {
      key: item.key,
      label: item.label,
      quantity,
      ratioPart: divisor > 0 ? quantity / divisor : 0,
      percent: totalQuantity > 0 ? roundTo((quantity / totalQuantity) * 100, 1) : 0,
    };
  });

  return {
    basis: "deliveredCount",
    totalQuantity,
    ratioLabel: buckets.map((bucket) => String(bucket.ratioPart)).join(":"),
    buckets,
  };
}

function classifyZone(dayRecord: DayRecord, zoneId: string): ZoneQuantityBucket["key"] {
  const zone = dayRecord.zones.find((item) => item.id === zoneId);
  const id = zoneId.toLowerCase();
  const name = (zone?.name || "").toLowerCase();

  if (id === "miju" || id.includes("miju") || name.includes("미주")) {
    return "miju";
  }
  if (id === "hils" || id.includes("hils") || name.includes("힐스")) {
    return "hils";
  }
  return "alternate";
}

function gcdMany(values: number[]): number {
  const positives = values.filter((value) => value > 0).map((value) => Math.round(value));
  if (positives.length === 0) {
    return 0;
  }
  return positives.reduce((current, value) => gcd(current, value));
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function getIsoWeekKey(date: string): string {
  const parsed = new Date(date + "T00:00:00Z");
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((parsed.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
