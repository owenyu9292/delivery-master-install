export type DayStatus = "draft" | "active" | "closed" | "reviewNeeded";

export type EventSource = "manual" | "migration" | "import" | "recovery";

export type TimelineEventType =
  | "depart_jinjeop"
  | "arrive_cheongnyangni"
  | "zone_start"
  | "sorting_start"
  | "sorting_end"
  | "delivery_start"
  | "zone_end"
  | "helper_add"
  | "incident"
  | "day_close"
  | "manual_adjust";

export type RecoveryStatus =
  | "none"
  | "complete"
  | "partial"
  | "textOnly"
  | "needsReview"
  | "failed";

export interface DayRecord {
  schemaVersion: 1;
  id: string;
  date: string;
  status: DayStatus;
  timeline: TimelineEvent[];
  zones: ZoneRecord[];
  helpers: HelperRecord[];
  adjustments: AdjustmentRecord[];
  meta: DayRecordMeta;
}

export interface DayRecordMeta {
  createdAt: string;
  updatedAt: string;
  deviceId?: string;
  appVersion?: string;
  migrationSource?: string;
  recoveryStatus: RecoveryStatus;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  at: string;
  zoneId?: string;
  payload?: TimelineEventPayload;
  note?: string;
  source: EventSource;
  createdAt: string;
  updatedAt: string;
}

export type TimelineEventPayload =
  | CountPayload
  | HelperPayload
  | IncidentPayload
  | ManualAdjustPayload
  | ZonePayload
  | Record<string, unknown>;

export interface CountPayload {
  total?: number;
  delivered?: number;
  failed?: number;
  extra?: number;
  reason?: string;
}

export interface HelperPayload {
  helperId?: string;
  name: string;
  action?: "add" | "remove" | "update";
  helperKind?: "free_received" | "paid_received" | "unpaid_given";
  quantity?: number;
  countsForEfficiency?: boolean;
  unpaid?: boolean;
  sourceZoneId?: string;
}

export interface IncidentPayload {
  title: string;
  detail?: string;
  severity?: "info" | "warning" | "critical";
}

export interface ManualAdjustPayload {
  targetEventId?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}

export interface ZonePayload {
  zoneName?: string;
  order?: number;
}

export interface ZoneRecord {
  id: string;
  name: string;
  order: number;
  startEventId?: string;
  sortingStartEventId?: string;
  sortingEndEventId?: string;
  deliveryStartEventId?: string;
  endEventId?: string;
  counts?: ZoneCountsCache;
  countsSourceEventIds?: string[];
  countsCalculatedAt?: string;
  memo?: string;
}

export interface ZoneCountsCache {
  total: number;
  delivered: number;
  failed: number;
  extra: number;
}

export interface HelperRecord {
  id: string;
  name: string;
  linkedEventIds: string[];
  memo?: string;
  kind?: "free_received" | "paid_received" | "unpaid_given";
  quantity?: number;
  countsForEfficiency?: boolean;
}

export interface AdjustmentRecord {
  id: string;
  eventId?: string;
  reason: string;
  note?: string;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  eventId: string;
  at: string;
  label: string;
  zoneId?: string;
  detail?: string;
}

export interface DayCalculation {
  date: string;
  zones: ZoneCalculation[];
  totals: DayCalculationTotals;
  warnings: CalculationWarning[];
}

export interface ZoneCalculation {
  zoneId: string;
  elapsedMinutes?: number;
  movementMinutes?: number;
  sortingMinutes?: number;
  deliveryMinutes?: number;
  eventMinutes?: number;
  counts: ZoneCountsCache;
  efficiencyPerHour?: number;
  sourceEventIds: string[];
}

export interface DayCalculationTotals {
  totalCount: number;
  deliveredCount: number;
  efficiencyCount?: number;
  helperFreeCount?: number;
  helperPaidCount?: number;
  failedCount: number;
  extraCount: number;
  totalElapsedMinutes?: number;
  deliveryMinutes?: number;
  efficiencyPerHour?: number;
}

export interface CalculationWarning {
  code: string;
  message: string;
  eventIds?: string[];
  zoneId?: string;
}

export interface ReportResult {
  date: string;
  text: string;
  sourceEventIds: string[];
  warnings: CalculationWarning[];
}
