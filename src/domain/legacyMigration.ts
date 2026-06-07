import type {
  AdjustmentRecord,
  DayRecord,
  DayStatus,
  EventSource,
  HelperRecord,
  RecoveryStatus,
  TimelineEvent,
  TimelineEventPayload,
  TimelineEventType,
  ZoneRecord,
} from "./types";

export type MigrationStatus = "complete" | "partial" | "textOnly" | "needsReview" | "failed";

export interface LegacyInspection {
  candidateCount: number;
  detectedKinds: string[];
  dates: string[];
  confidence: number;
  issues: string[];
}

export interface MigrationWarning {
  code: string;
  message: string;
  date?: string;
  kind?: string;
}

export interface MigrationOptions {
  appVersion?: string;
  deviceId?: string;
}

export interface MigrationResult {
  days: DayRecord[];
  inspection: LegacyInspection;
  warnings: MigrationWarning[];
  statusCounts: Record<MigrationStatus, number>;
}

export interface MigrationReport {
  text: string;
  warnings: MigrationWarning[];
  sourceDateCount: number;
  migratedCount: number;
  statusCounts: Record<MigrationStatus, number>;
}

interface LegacyCandidate {
  raw: unknown;
  date?: string;
  kind: string;
  detectedKinds: string[];
}

interface NormalizedCandidate {
  date: string;
  kind: string;
  sourceKinds: string[];
  timeline: TimelineEvent[];
  zones: ZoneRecord[];
  helpers: HelperRecord[];
  adjustments: AdjustmentRecord[];
  textOnly: boolean;
  issues: string[];
}

const MIGRATION_APP_VERSION = "0.0.0-migration";

export function inspectLegacySource(source: unknown): LegacyInspection {
  const candidates = extractCandidates(source);
  const detectedKinds = new Set<string>();
  const dates = new Set<string>();
  const issues: string[] = [];

  for (const candidate of candidates) {
    candidate.detectedKinds.forEach((kind) => detectedKinds.add(kind));
    if (candidate.date) {
      dates.add(candidate.date);
    } else {
      issues.push("missing_date");
    }
  }

  if (candidates.length === 0) {
    issues.push("no_legacy_content");
  }

  const hasStructured = detectedKinds.has("structuredDay");
  const hasTimeline = detectedKinds.has("timeline") || detectedKinds.has("logs");
  let confidence = 0;
  if (hasStructured) {
    confidence = 0.9;
  } else if (hasTimeline) {
    confidence = 0.75;
  } else if (candidates.length > 0) {
    confidence = 0.35;
  }

  return {
    candidateCount: candidates.length,
    detectedKinds: Array.from(detectedKinds),
    dates: Array.from(dates).sort(),
    confidence,
    issues,
  };
}

export function migrateLegacySource(
  source: unknown,
  options: MigrationOptions = {},
): MigrationResult {
  const inspection = inspectLegacySource(source);
  const warnings: MigrationWarning[] = [];
  const statusCounts: Record<MigrationStatus, number> = {
    complete: 0,
    partial: 0,
    textOnly: 0,
    needsReview: 0,
    failed: 0,
  };

  const days: DayRecord[] = [];
  for (const candidate of extractCandidates(source)) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) {
      statusCounts.failed += 1;
      warnings.push({
        code: "candidate_failed",
        message: "Failed to migrate legacy candidate.",
        date: candidate.date,
        kind: candidate.kind,
      });
      continue;
    }

    const status = determineMigrationStatus(normalized);
    statusCounts[status] += 1;
    for (const issue of normalized.issues) {
      warnings.push({
        code: issue,
        message: describeIssue(issue, normalized.date),
        date: normalized.date,
        kind: normalized.kind,
      });
    }
    days.push(buildDayRecord(normalized, options));
  }

  if (days.length === 0 && inspection.candidateCount === 0) {
    statusCounts.failed = 1;
    warnings.push({
      code: "no_legacy_content",
      message: "No recognizable legacy data was found.",
    });
  }

  return {
    days,
    inspection,
    warnings,
    statusCounts,
  };
}

export function buildMigrationReport(result: MigrationResult): MigrationReport {
  const lines = [
    "Legacy migration report",
    "Candidates: " + result.inspection.candidateCount,
    "Dates: " + (result.inspection.dates.join(", ") || "none"),
    "Confidence: " + Math.round(result.inspection.confidence * 100) + "%",
    "Complete: " + result.statusCounts.complete,
    "Partial: " + result.statusCounts.partial,
    "Text only: " + result.statusCounts.textOnly,
    "Needs review: " + result.statusCounts.needsReview,
    "Failed: " + result.statusCounts.failed,
    "",
    "Warnings:",
  ];

  if (result.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of result.warnings) {
      lines.push("- " + warning.code + ": " + warning.message);
    }
  }

  return {
    text: lines.join("\n"),
    warnings: result.warnings,
    sourceDateCount: result.inspection.dates.length,
    migratedCount: result.days.length,
    statusCounts: result.statusCounts,
  };
}

function extractCandidates(source: unknown): LegacyCandidate[] {
  const out: LegacyCandidate[] = [];
  if (Array.isArray(source)) {
    for (const item of source) {
      out.push(...extractFromObject(item));
    }
    return out;
  }
  out.push(...extractFromObject(source));
  return out;
}

function extractFromObject(value: unknown): LegacyCandidate[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const obj = value as Record<string, unknown>;
  const out: LegacyCandidate[] = [];

  if (looksLikeDayRecord(obj)) {
    out.push({
      raw: obj,
      date: asString(obj.date),
      kind: "structuredDay",
      detectedKinds: ["structuredDay", "timeline"],
    });
    return out;
  }

  if (Array.isArray(obj.days)) {
    for (const item of obj.days) {
      out.push(...extractFromObject(item));
    }
  }
  if (Array.isArray(obj.records)) {
    for (const item of obj.records) {
      out.push(...extractFromObject(item));
    }
  }
  if (Array.isArray(obj.items)) {
    for (const item of obj.items) {
      out.push(...extractFromObject(item));
    }
  }
  if (Array.isArray(obj.storageItems)) {
    for (const item of obj.storageItems) {
      out.push(...extractFromObject(item));
    }
  }

  if (obj.logsByDate && typeof obj.logsByDate === "object") {
    for (const [date, logs] of Object.entries(obj.logsByDate as Record<string, unknown>)) {
      out.push({
        raw: logs,
        date,
        kind: "logsByDate",
        detectedKinds: ["logs", "logsByDate"],
      });
    }
  }

  if (Array.isArray(obj.logs)) {
    out.push({
      raw: obj.logs,
      date: inferDate(obj),
      kind: "logs",
      detectedKinds: ["logs"],
    });
  }

  if (obj.state && typeof obj.state === "object") {
    const state = obj.state as Record<string, unknown>;
    if (Array.isArray(state.results)) {
      out.push({
        raw: state.results,
        date: inferDate(obj),
        kind: "stateResults",
        detectedKinds: ["stateResults"],
      });
    }
    if (Array.isArray(state.logs)) {
      out.push({
        raw: state.logs,
        date: inferDate(obj),
        kind: "stateLogs",
        detectedKinds: ["logs", "stateLogs"],
      });
    }
    if (Array.isArray(state.events)) {
      out.push({
        raw: state.events,
        date: inferDate(obj),
        kind: "stateEvents",
        detectedKinds: ["timeline", "stateEvents"],
      });
    }
  }

  if (typeof obj.reportText === "string") {
    out.push({
      raw: obj,
      date: inferDate(obj) || inferDateFromLogsByDate(obj),
      kind: "reportTextOnly",
      detectedKinds: ["reportText"],
    });
  }

  if (out.length === 0 && typeof obj.date === "string") {
    out.push({
      raw: obj,
      date: asString(obj.date),
      kind: "fallbackObject",
      detectedKinds: ["unknown"],
    });
  }

  return out;
}

function determineMigrationStatus(candidate: NormalizedCandidate): MigrationStatus {
  if (candidate.textOnly) {
    return "textOnly";
  }
  if (candidate.issues.length > 0) {
    return "needsReview";
  }
  if (candidate.kind === "structuredDay" && candidate.timeline.length > 0) {
    return "complete";
  }
  if (candidate.timeline.length > 0 && candidate.zones.length > 0) {
    return "complete";
  }
  if (candidate.timeline.length > 0 || candidate.zones.length > 0 || candidate.helpers.length > 0 || candidate.adjustments.length > 0) {
    return "partial";
  }
  return "needsReview";
}

function buildDayRecord(
  candidate: NormalizedCandidate,
  options: MigrationOptions,
): DayRecord {
  const now = new Date().toISOString();
  const recoveryStatus = determineRecoveryStatus(candidate);
  return {
    schemaVersion: 1,
    id: "day-" + safeId(candidate.date),
    date: candidate.date,
    status: mapStatus(determineMigrationStatus(candidate)),
    timeline: candidate.timeline,
    zones: candidate.zones,
    helpers: candidate.helpers,
    adjustments: candidate.adjustments,
    meta: {
      createdAt: now,
      updatedAt: now,
      deviceId: options.deviceId,
      appVersion: options.appVersion || MIGRATION_APP_VERSION,
      migrationSource: candidate.sourceKinds.join(","),
      recoveryStatus,
    },
  };
}

function determineRecoveryStatus(candidate: NormalizedCandidate): RecoveryStatus {
  if (candidate.textOnly) {
    return "textOnly";
  }
  if (candidate.issues.length > 0) {
    return "needsReview";
  }
  if (candidate.kind === "structuredDay" && candidate.timeline.length > 0) {
    return "complete";
  }
  if (candidate.timeline.length > 0 || candidate.zones.length > 0 || candidate.helpers.length > 0 || candidate.adjustments.length > 0) {
    return "partial";
  }
  return "needsReview";
}

function normalizeTimeline(obj: Record<string, unknown>, date: string): TimelineEvent[] {
  if (Array.isArray(obj.timeline)) {
    return obj.timeline.flatMap((entry, index) => normalizeTimelineEntry(entry, date, index));
  }
  if (Array.isArray(obj.logs)) {
    return obj.logs.flatMap((entry, index) => normalizeTimelineEntry(entry, date, index));
  }
  if (Array.isArray(obj.events)) {
    return obj.events.flatMap((entry, index) => normalizeTimelineEntry(entry, date, index));
  }
  if (obj.state && typeof obj.state === "object") {
    const state = obj.state as Record<string, unknown>;
    if (Array.isArray(state.results)) {
      return state.results.flatMap((entry, index) => normalizeResultEntry(entry, date, index));
    }
    if (Array.isArray(state.logs)) {
      return state.logs.flatMap((entry, index) => normalizeTimelineEntry(entry, date, index));
    }
    if (Array.isArray(state.events)) {
      return state.events.flatMap((entry, index) => normalizeTimelineEntry(entry, date, index));
    }
  }
  return [];
}

function normalizeZones(obj: Record<string, unknown>, timeline: TimelineEvent[]): ZoneRecord[] {
  if (Array.isArray(obj.zones)) {
    return obj.zones
      .map((zone, index) => normalizeZone(zone, index, timeline))
      .filter((zone): zone is ZoneRecord => Boolean(zone));
  }

  const byZone = new Map<string, TimelineEvent[]>();
  for (const event of timeline) {
    if (!event.zoneId) {
      continue;
    }
    const current = byZone.get(event.zoneId) || [];
    current.push(event);
    byZone.set(event.zoneId, current);
  }

  return Array.from(byZone.entries()).map(([zoneId, events], index) => {
    return {
      id: zoneId,
      name: zoneId,
      order: index + 1,
      startEventId: findEventId(events, "zone_start"),
      sortingStartEventId: findEventId(events, "sorting_start"),
      sortingEndEventId: findEventId(events, "sorting_end"),
      deliveryStartEventId: findEventId(events, "delivery_start"),
      endEventId: findEventId(events, "zone_end"),
      counts: undefined,
      countsSourceEventIds: events.map((event) => event.id),
      countsCalculatedAt: events.length > 0 ? events[events.length - 1].updatedAt : undefined,
    };
  });
}

function normalizeZone(value: unknown, index: number, timeline: TimelineEvent[]): ZoneRecord | null {
  const obj = toObject(value);
  if (!obj) {
    return null;
  }
  const id = asString(obj.id) || asString(obj.zoneId) || "zone-" + (index + 1);
  return {
    id,
    name: asString(obj.name) || asString(obj.zoneName) || id,
    order: asNumber(obj.order) || index + 1,
    startEventId: asString(obj.startEventId),
    sortingStartEventId: asString(obj.sortingStartEventId),
    sortingEndEventId: asString(obj.sortingEndEventId),
    deliveryStartEventId: asString(obj.deliveryStartEventId),
    endEventId: asString(obj.endEventId),
    counts: normalizeCounts(obj.counts),
    countsSourceEventIds: Array.isArray(obj.countsSourceEventIds)
      ? obj.countsSourceEventIds.filter((item): item is string => typeof item === "string")
      : timeline.filter((event) => event.zoneId === id).map((event) => event.id),
    countsCalculatedAt: asString(obj.countsCalculatedAt),
    memo: asString(obj.memo),
  };
}

function normalizeHelpers(obj: Record<string, unknown>, timeline: TimelineEvent[]): HelperRecord[] {
  if (Array.isArray(obj.helpers)) {
    return obj.helpers
      .map((helper, index) => normalizeHelper(helper, index))
      .filter((helper): helper is HelperRecord => Boolean(helper));
  }

  return timeline
    .filter((event) => event.type === "helper_add")
    .map((event, index) => {
      const payload = toObject(event.payload);
      return {
        id: asString(payload?.helperId) || "helper-" + (index + 1),
        name: asString(payload?.name) || "helper-" + (index + 1),
        linkedEventIds: [event.id],
        memo: event.note,
      };
    });
}

function normalizeHelper(value: unknown, index: number): HelperRecord | null {
  const obj = toObject(value);
  if (!obj) {
    return null;
  }
  return {
    id: asString(obj.id) || asString(obj.helperId) || "helper-" + (index + 1),
    name: asString(obj.name) || asString(obj.helperName) || "helper-" + (index + 1),
    linkedEventIds: Array.isArray(obj.linkedEventIds)
      ? obj.linkedEventIds.filter((item): item is string => typeof item === "string")
      : [],
    memo: asString(obj.memo),
  };
}

function normalizeAdjustments(obj: Record<string, unknown>, timeline: TimelineEvent[]): AdjustmentRecord[] {
  if (Array.isArray(obj.adjustments)) {
    return obj.adjustments
      .map((adjustment, index) => normalizeAdjustment(adjustment, index))
      .filter((adjustment): adjustment is AdjustmentRecord => Boolean(adjustment));
  }

  return timeline
    .filter((event) => event.type === "manual_adjust")
    .map((event, index) => {
      const payload = toObject(event.payload);
      return {
        id: "adj-" + (index + 1),
        eventId: asString(payload?.targetEventId),
        reason: asString(payload?.reason) || event.note || "migration",
        note: event.note,
        createdAt: event.createdAt,
      };
    });
}

function normalizeAdjustment(value: unknown, index: number): AdjustmentRecord | null {
  const obj = toObject(value);
  if (!obj) {
    return null;
  }
  return {
    id: asString(obj.id) || "adj-" + (index + 1),
    eventId: asString(obj.eventId),
    reason: asString(obj.reason) || "migration",
    note: asString(obj.note),
    createdAt: asString(obj.createdAt) || new Date().toISOString(),
  };
}

function collectIssues(
  candidate: LegacyCandidate,
  timeline: TimelineEvent[],
  zones: ZoneRecord[],
  helpers: HelperRecord[],
  adjustments: AdjustmentRecord[],
  textOnly: boolean,
): string[] {
  const issues: string[] = [];
  if (textOnly) {
    issues.push("text_only");
  }
  if (candidate.detectedKinds.indexOf("logs") >= 0 && timeline.length === 0) {
    issues.push("unparsed_logs");
  }
  if (!textOnly && timeline.length === 0 && zones.length === 0 && helpers.length === 0 && adjustments.length === 0) {
    issues.push("no_timeline");
  }
  if (!candidate.date) {
    issues.push("missing_date");
  }
  return Array.from(new Set(issues));
}

function normalizeTimelineEntry(value: unknown, date: string, index: number): TimelineEvent[] {
  const obj = toObject(value);
  if (!obj) {
    return [];
  }

  const type = normalizeEventType(asString(obj.type) || asString(obj.eventType) || "incident");
  const at = asString(obj.at) || asString(obj.time) || asString(obj.timestamp) || deriveAt(date, index);
  const createdAt = asString(obj.createdAt) || at;
  const updatedAt = asString(obj.updatedAt) || createdAt;
  const payload = normalizePayload(obj.payload || obj.data || obj.detail);
  const zoneId = asString(obj.zoneId) || asString(obj.zone) || asString(obj.areaId);

  return [{
    id: asString(obj.id) || asString(obj.eventId) || type + "-" + (index + 1),
    type,
    at,
    zoneId,
    payload,
    note: asString(obj.note) || asString(obj.text) || asString(obj.message),
    source: normalizeSource(asString(obj.source)),
    createdAt,
    updatedAt,
  }];
}

function normalizeResultEntry(value: unknown, date: string, index: number): TimelineEvent[] {
  const obj = toObject(value);
  if (!obj) {
    return [];
  }
  const at = asString(obj.at) || asString(obj.time) || deriveAt(date, index);
  const zoneId = asString(obj.zoneId) || asString(obj.zone) || asString(obj.areaId);
  const payload: TimelineEventPayload = {
    total: asNumber(obj.total),
    delivered: asNumber(obj.delivered),
    failed: asNumber(obj.failed),
    extra: asNumber(obj.extra),
    reason: asString(obj.reason),
  };
  return [{
    id: asString(obj.id) || asString(obj.eventId) || "result-" + (index + 1),
    type: zoneId ? "zone_end" : "manual_adjust",
    at,
    zoneId,
    payload: compactPayload(payload),
    note: asString(obj.note) || asString(obj.text),
    source: "migration",
    createdAt: asString(obj.createdAt) || at,
    updatedAt: asString(obj.updatedAt) || asString(obj.createdAt) || at,
  }];
}

function normalizeCounts(value: unknown): { total: number; delivered: number; failed: number; extra: number } | undefined {
  const obj = toObject(value);
  if (!obj) {
    return undefined;
  }
  const total = asNumber(obj.total);
  const delivered = asNumber(obj.delivered);
  const failed = asNumber(obj.failed);
  const extra = asNumber(obj.extra);
  if (total === undefined && delivered === undefined && failed === undefined && extra === undefined) {
    return undefined;
  }
  return {
    total: total || 0,
    delivered: delivered || 0,
    failed: failed || 0,
    extra: extra || 0,
  };
}

function normalizePayload(value: unknown): TimelineEventPayload | undefined {
  const obj = toObject(value);
  if (!obj) {
    if (typeof value === "string") {
      return { reason: value };
    }
    return undefined;
  }
  return compactPayload(obj);
}

function compactPayload(payload: object): TimelineEventPayload {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value !== undefined && value !== null && value !== "") {
      out[key] = value;
    }
  }
  return out;
}

function normalizeEventType(value: string): TimelineEventType {
  const known: TimelineEventType[] = [
    "depart_jinjeop",
    "arrive_cheongnyangni",
    "zone_start",
    "sorting_start",
    "sorting_end",
    "delivery_start",
    "zone_end",
    "helper_add",
    "incident",
    "day_close",
    "manual_adjust",
  ];
  return known.indexOf(value as TimelineEventType) >= 0 ? (value as TimelineEventType) : "incident";
}

function normalizeSource(value: string | undefined): EventSource {
  return value === "migration" || value === "import" || value === "recovery" ? value : "migration";
}

function deriveAt(date: string, index: number): string {
  const hour = String(8 + index).padStart(2, "0");
  return date + "T" + hour + ":00:00+09:00";
}

function mapStatus(status: MigrationStatus): DayStatus {
  if (status === "complete") {
    return "closed";
  }
  if (status === "partial") {
    return "active";
  }
  return "reviewNeeded";
}

function describeIssue(issue: string, date: string): string {
  if (issue === "text_only") {
    return "Text-only legacy data for " + date;
  }
  if (issue === "unparsed_logs") {
    return "Legacy logs could not be fully parsed for " + date;
  }
  if (issue === "no_timeline") {
    return "No timeline could be recovered for " + date;
  }
  if (issue === "missing_date") {
    return "Legacy record is missing a date";
  }
  return issue + " for " + date;
}

function looksLikeDayRecord(value: Record<string, unknown>): boolean {
  return typeof value.date === "string" && Array.isArray(value.timeline);
}

function inferDate(value: Record<string, unknown>): string | undefined {
  if (typeof value.date === "string") {
    return value.date;
  }
  if (typeof value.day === "string") {
    return value.day;
  }
  if (typeof value.dateKey === "string") {
    return value.dateKey;
  }
  return undefined;
}

function inferDateFromLogsByDate(value: Record<string, unknown>): string | undefined {
  if (!value.logsByDate || typeof value.logsByDate !== "object") {
    return undefined;
  }
  const keys = Object.keys(value.logsByDate as Record<string, unknown>);
  return keys.length > 0 ? keys[0] : undefined;
}

function normalizeCandidate(candidate: LegacyCandidate): NormalizedCandidate | null {
  if (!candidate.date) {
    return null;
  }
  const obj = toObject(candidate.raw);
  const timeline = obj ? normalizeTimeline(obj, candidate.date) : [];
  const zones = obj ? normalizeZones(obj, timeline) : [];
  const helpers = obj ? normalizeHelpers(obj, timeline) : [];
  const adjustments = obj ? normalizeAdjustments(obj, timeline) : [];
  const textOnly = candidate.detectedKinds.indexOf("reportText") >= 0 && timeline.length === 0;
  const issues = collectIssues(candidate, timeline, zones, helpers, adjustments, textOnly);

  return {
    date: candidate.date,
    kind: candidate.kind,
    sourceKinds: candidate.detectedKinds,
    timeline,
    zones,
    helpers,
    adjustments,
    textOnly,
    issues,
  };
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "legacy";
}

function findEventId(events: TimelineEvent[], type: TimelineEventType): string | undefined {
  const found = events.find((event) => event.type === type);
  return found ? found.id : undefined;
}
