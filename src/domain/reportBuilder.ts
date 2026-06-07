import type { DayCalculation, DayRecord, ReportResult, TimelineEvent, ZoneCalculation } from "./types";

export interface ReportOptions {
  title?: string;
  includeWarnings?: boolean;
}

export interface ReportPreview {
  date: string;
  status: DayRecord["status"];
  zoneCount: number;
  totalCount: number;
  deliveredCount: number;
  failedCount: number;
  deliveryMinutes?: number;
  efficiencyPerHour?: number;
  sourceEventIds: string[];
}

export function buildDailyReport(
  dayRecord: DayRecord,
  calculation: DayCalculation,
  options: ReportOptions = {},
): ReportResult {
  const sourceEventIds = dayRecord.timeline.map((event) => event.id);
  const expected = getExpectedTotal(dayRecord);
  const scanMiss = expected === undefined ? undefined : calculation.totals.totalCount - expected;
  const depart = firstEvent(dayRecord, "depart_jinjeop");
  const arrive = firstEvent(dayRecord, "arrive_cheongnyangni");
  const close = lastEvent(dayRecord, "day_close");
  const driveMinutes = diffMinutes(depart?.at, arrive?.at);
  const regularEfficiency = calculation.totals.efficiencyPerHour;
  const title = options.title ?? "일일 택배 마스터 Report";

  const lines = [
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    `📦 ${title}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    `날짜: ${formatKoreanDate(dayRecord.date)}`,
    `기록 키: ${dayRecord.date}`,
    "",
    "[통합 분석]",
    `총 배송 수량: ${calculation.totals.totalCount}개`,
    `예상 수량:   ${expectedText(expected, scanMiss)}`,
    ...buildHelperSummaryLines(calculation),
    `전체 업무:   진접 ${formatClock(depart?.at)} 출발`,
    `             최종 종료 ${formatClock(close?.at)}`,
    `순수 운전:   진접→청량리 ${formatMinutes(driveMinutes)}`,
    `전체 평균:   시간당 ${formatWholeEfficiency(regularEfficiency)}`,
    "",
    "[구역별 상세]",
    ...calculation.zones.flatMap((zone, index) => buildZoneDetailLines(dayRecord, zone, index)),
    "",
    "[상세 효율]",
    ...calculation.zones.flatMap((zone, index) => buildZoneEfficiencyLines(dayRecord, zone, index)),
    "",
    "[정규 효율 (대체배송 제외)]",
    `  시간당 ${formatWholeEfficiency(regularEfficiency)}`,
  ];

  const incidents = dayRecord.timeline.filter((event) => event.type === "incident");
  if (incidents.length > 0) {
    lines.push("", "[이벤트]");
    for (const event of incidents) {
      const payload = event.payload as { title?: unknown; minutes?: unknown } | undefined;
      const titleText = typeof payload?.title === "string" ? payload.title : "이벤트";
      const minutesText = typeof payload?.minutes === "number" ? `${payload.minutes}분` : "시간 미입력";
      const zoneName = event.zoneId ? getZoneName(dayRecord, event.zoneId) : "전체";
      lines.push(`  ${formatClock(event.at)} ${titleText} ${minutesText} · ${zoneName}`);
    }
  }

  if (options.includeWarnings !== false && calculation.warnings.length > 0) {
    lines.push("", "[확인 필요]");
    for (const warning of calculation.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");

  return {
    date: dayRecord.date,
    text: lines.join("\n"),
    sourceEventIds,
    warnings: calculation.warnings,
  };
}

function buildHelperSummaryLines(calculation: DayCalculation): string[] {
  const free = calculation.totals.helperFreeCount ?? 0;
  const paid = calculation.totals.helperPaidCount ?? 0;
  if (free <= 0 && paid <= 0) return [];
  const lines = ["도우미 배송:"];
  if (free > 0) lines.push(`             무료 ${free}개 (효율 제외)`);
  if (paid > 0) lines.push(`             유료 ${paid}개 (효율 포함)`);
  return lines;
}

export function buildPreviewModel(
  dayRecord: DayRecord,
  calculation: DayCalculation,
): ReportPreview {
  return {
    date: dayRecord.date,
    status: dayRecord.status,
    zoneCount: calculation.zones.length,
    totalCount: calculation.totals.totalCount,
    deliveredCount: calculation.totals.deliveredCount,
    failedCount: calculation.totals.failedCount,
    deliveryMinutes: calculation.totals.deliveryMinutes,
    efficiencyPerHour: calculation.totals.efficiencyPerHour,
    sourceEventIds: dayRecord.timeline.map((event) => event.id),
  };
}

function buildZoneDetailLines(dayRecord: DayRecord, zone: ZoneCalculation, index: number): string[] {
  const zoneName = getZoneName(dayRecord, zone.zoneId);
  const start = firstZoneEvent(dayRecord, zone.zoneId, "zone_start");
  const end = firstZoneEvent(dayRecord, zone.zoneId, "zone_end");
  const sortingStart = firstZoneEvent(dayRecord, zone.zoneId, "sorting_start");
  const sortingEnd = firstZoneEvent(dayRecord, zone.zoneId, "sorting_end");
  const payload = end?.payload as Record<string, unknown> | undefined;
  const lines = [
    `${index + 1}구역 (${zoneName})`,
    `  시작 ${formatClock(start?.at)} ~ 종료 ${formatClock(end?.at)}`,
    `  실제 배송 소요: ${formatMinutes(zone.deliveryMinutes)}`,
    `  배송 수량: ${zone.counts.delivered}개`,
  ];

  if (zone.zoneId === "miju") {
    const aTotal = numberOr(payload?.aTotal, sumNumbers(payload?.building1Total, payload?.building2Total, payload?.building3Total));
    const bTotal = numberOr(payload?.restTotal, numberOr(payload?.bTotal, Math.max(0, zone.counts.delivered - aTotal)));
    lines.push(`  A구간(1,2,3동): ${aTotal}개`);
    lines.push(`  B구간(5,6,7,8동): ${bTotal}개`);
  }

  if (sortingStart || sortingEnd) {
    lines.push(`  정리: ${formatClock(sortingStart?.at)} ~ ${formatClock(sortingEnd?.at)} (${formatMinutes(zone.sortingMinutes)})`);
  }

  lines.push(`  실제 효율: 시간당 ${formatWholeEfficiency(zone.efficiencyPerHour)}`);
  lines.push(`  전체 효율: 시간당 ${formatWholeEfficiency(calculateEfficiency(zone.counts.delivered, zone.elapsedMinutes))}`);
  if (zone.eventMinutes && zone.eventMinutes > 0) {
    lines.push(`  이벤트: ${formatMinutes(zone.eventMinutes)}`);
  }

  return lines;
}

function buildZoneEfficiencyLines(dayRecord: DayRecord, zone: ZoneCalculation, index: number): string[] {
  const zoneName = getZoneName(dayRecord, zone.zoneId);
  return [
    `${index + 1}구역 ${zoneName}:`,
    `  실제 배송 효율:  시간당 ${formatWholeEfficiency(zone.efficiencyPerHour)}`,
    `  전체 업무 효율:  시간당 ${formatWholeEfficiency(calculateEfficiency(zone.counts.delivered, zone.elapsedMinutes))}`,
    `  이벤트 보정 효율: 시간당 ${formatWholeEfficiency(zone.efficiencyPerHour)}`,
  ];
}

function getExpectedTotal(dayRecord: DayRecord): number | undefined {
  const depart = firstEvent(dayRecord, "depart_jinjeop");
  const payload = depart?.payload as { total?: unknown } | undefined;
  return typeof payload?.total === "number" ? payload.total : undefined;
}

function expectedText(expected: number | undefined, scanMiss: number | undefined): string {
  if (expected === undefined) return "미입력";
  if (scanMiss === undefined || scanMiss === 0) return `${expected}개`;
  return `${expected}개 (스캔미스 ${scanMiss > 0 ? "+" : ""}${scanMiss}개)`;
}

function getZoneName(dayRecord: DayRecord, zoneId: string): string {
  return dayRecord.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId;
}

function firstEvent(dayRecord: DayRecord, type: TimelineEvent["type"]): TimelineEvent | undefined {
  return [...dayRecord.timeline].sort(compareEvents).find((event) => event.type === type);
}

function lastEvent(dayRecord: DayRecord, type: TimelineEvent["type"]): TimelineEvent | undefined {
  return [...dayRecord.timeline].sort(compareEvents).reverse().find((event) => event.type === type);
}

function firstZoneEvent(dayRecord: DayRecord, zoneId: string, type: TimelineEvent["type"]): TimelineEvent | undefined {
  return [...dayRecord.timeline].sort(compareEvents).find((event) => event.zoneId === zoneId && event.type === type);
}

function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  return Date.parse(a.at) - Date.parse(b.at);
}

function diffMinutes(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) return undefined;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;
  return (endMs - startMs) / 60000;
}

function calculateEfficiency(count: number, minutes: number | undefined): number | undefined {
  if (minutes === undefined || minutes < 1) return undefined;
  return count / (minutes / 60);
}

function formatMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "-";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}분`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

function formatClock(iso: string | undefined): string {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatKoreanDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatWholeEfficiency(efficiency: number | undefined): string {
  if (efficiency === undefined) return "-";
  return `${Math.round(efficiency)}개`;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sumNumbers(...values: unknown[]): number {
  return values.reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
}
