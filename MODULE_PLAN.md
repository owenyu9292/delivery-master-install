# Module Plan

Spec baseline: 2026-05-17

## Goals

- Keep DayRecord.timeline as the single source of truth.
- Derive logs, reports, and calculations from timeline data.
- Keep storage behind dayStore.
- Keep UI as orchestration only.

## Current implementation

Implemented:

- app shell
- eventTimeline
- cleanupCorrection
- deliveryCalc
- reportBuilder
- backupImportExport
- fieldAppMigration
- legacyMigration
- uiScreens
- phoneInstall
- dayStore
- memoryDayStore
- indexedDbAdapter

## Boundary summary

### dayStore

Responsibilities:

- list day summaries
- load and save DayRecord
- create backups
- import backups

API:

- listDates(): Promise<DateSummary[]>
- getDay(date): Promise<DayRecord | null>
- saveDay(dayRecord): Promise<SaveResult>
- createBackup(scope): Promise<BackupFile>
- importBackup(file, options): Promise<ImportResult>

### eventTimeline

Responsibilities:

- create and update timeline events
- validate timeline integrity
- derive log entries from timeline only

API:

- createEvent(dayRecord, input): DayRecord
- updateEvent(dayRecord, eventId, patch): DayRecord
- deriveLog(dayRecord): LogEntry[]
- validateTimeline(dayRecord): TimelineValidation

### cleanupCorrection

Responsibilities:

- detect missing cleanup/sorting finish
- apply close/finish time anchored correction
- preserve correction history through adjustments
- keep calculations derived from timeline events

API:

- hasMissingCleanupFinish(dayRecord, zoneId): boolean
- applyMissingCleanupCorrection(dayRecord, request): CleanupCorrectionResult

### deliveryCalc

Responsibilities:

- derive zone and day calculations from DayRecord.timeline
- compute time, counts, and efficiency
- derive non-miju movement minutes from previous zone close to current sorting start
- exclude movement minutes from delivery minutes

API:

- calculateDay(dayRecord): DayCalculation
- calculateZone(dayRecord, zoneId): ZoneCalculation
- validateCalculation(dayRecord): CalculationWarning[]

### reportBuilder

Responsibilities:

- build report text and preview models from DayRecord + calculations
- never store report text on DayRecord

API:

- buildDailyReport(dayRecord, calculation): ReportResult
- buildPreviewModel(dayRecord, calculation): ReportPreview

### backupImportExport

Responsibilities:

- export all or scoped backups
- preview import conflicts
- copy or overwrite imports through dayStore
- expose store-level helpers for backup workflows
- identify phoneInstall backups with `delivery-master-phone-install` and `day-record-store`
- reject Season2 PWA field backups from direct restore so they can use a migration path
- build phoneInstall backup files from migrated Season2 PWA field backups
- route preserved Season2 exports through migration/import instead of direct restore

### fieldAppMigration

Responsibilities:

- recognize Season2 PWA `delivery-master-season2-pwa` / `full-localStorage` backups
- recognize preserved Season2 `delivery-master-season2` exports
- recognize array exports, single-day exports, and summary-only exports
- collect day records from `details`, `days`, `currentState`, and `storageItems`
- convert field app state/results into DayRecord.timeline, zones, counts, and close events
- preserve field-app backups as a reviewable migration source instead of direct restore data

### legacyMigration

Responsibilities:

- convert legacy season data into DayRecord
- classify migration status as complete, partial, textOnly, needsReview, or failed
- inspect legacy shapes and preserve recoverable timeline data

### uiScreens

Responsibilities:

- orchestrate user actions
- call pure modules
- render derived state only
- detect missing cleanup/sorting finish before zone close or day close
- expose correction choices for recommended 30 minutes, direct minute input, no cleanup/sorting, or cancel
- keep route-specific UI thin enough that extra field zones can be appended without changing calculation logic
- require sorting start/end before hils, 대체배송, or custom zone close
- build weekly/monthly quantity comparison for miju, hils, and alternate delivery zones

### phoneInstall

Responsibilities:

- ship the phone-installable distribution
- maintain automatic snapshots
- provide explicit reset only
- preserve state across cancel, back, app switch, and restart
- expose recovery UI for restoring interrupted work
- carry field-learned cleanup/sorting correction flow into the installable app
- support base miju/hils flow plus appended 대체배송 and named custom zones

Safety rules:

- No silent data loss on navigation or restart.
- If a reset is needed, it must be user-confirmed and explicit.
- Recovery UI should be available before any destructive reset path.
- Missing cleanup/sorting finish should be treated as a review/correction state, not silently accepted.
- The 30 minute cleanup/sorting value is a recommendation only; direct user minute input must take priority.
- Missed cleanup/sorting correction should anchor to zone/day close time: sorting end = close time, sorting start = close time - entered minutes.
- Extra 대체배송/custom zones are normal ZoneRecord and timeline data, not a separate report-only patch.
- Non-miju movement is previous zone close to current sorting start; if this is recorded as 0 minutes, use 5 minutes.

## Notes on mismatches removed from the plan

- deleteDayCopy(date, copyId) is not part of the current dayStore interface.
- logs[], logEntries, and screenLogs are not storage models.
- report data is derived from DayRecord.timeline, not persisted separately.

## Rollout status

- phoneInstall implemented
- static app shell implemented
- field ordered app flow implemented
- field app backup import button implemented in the app shell
- field app backup import result summary implemented in the app shell
- miju/hils input separation implemented
- 대체배송 and named custom zone append flow implemented
- non-miju sorting start/end requirement implemented
- non-miju zero-minute movement floor implemented
- phoneInstall backup identity and direct-restore guard implemented
- Season2 PWA field backup migration path implemented
- preserved Season2 export migration path implemented
- array, single-day, and summary-only field export formats implemented
- weekly/monthly quantity comparison implemented in stats models
- weekly/monthly quantity comparison displayed in the app shell
- cleanup/sorting correction implemented in the domain layer
- phone-first field UI refinement remains next
