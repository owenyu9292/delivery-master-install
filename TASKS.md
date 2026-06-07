# delivery-master-install task list

Last updated: 2026-05-25

## 00. Operating Rule: Report Before Action

- Before coding, file creation, folder creation, document updates, GitHub upload, commit, push, deployment, or fallback-path decisions, report the intended action and wait for user approval.
- If the intended folder or repository does not exist, stop. Do not create a different lower-level folder as a workaround.
- When a task requires a new location or permission, ask the user to create it or explicitly approve the exact action.

## Done

- Core data model: DayRecord, TimelineEvent, ZoneRecord, calculations
- Pure timeline functions: create, update, sort, derive logs, validate
- Pure calculation functions: day and zone calculations
- Report builder: derived report text and preview model
- Backup import/export helpers: export, preview import, copy import, overwrite import
- Legacy migration module: inspect, migrate, and report legacy sources
- UI screen orchestration module
- Memory store: cloned read/write behavior
- IndexedDB store: browser persistence and backup/import support
- Domain tests: 42/42 passing
- Cleanup correction domain helper: close/finish time anchored correction
- End-of-zone cleanup calculation support
- Static phoneInstall app shell
- Build and local preview scripts
- Field ordered app shell: depart, arrive, choose work order, work selected zones, close
- Separated miju and hils input flows
- 대체배송 can be included in the selected work order or appended later
- Named custom zone add flow before close
- Non-miju sorting start/end requirement
- Non-miju zero-minute movement floor: 5 minutes
- Non-miju sorting end is clamped so it cannot precede sorting start.
- Sub-one-minute delivery time hides efficiency instead of producing unrealistic per-hour output.
- Development app backup identity: filename, app id, and backup type separated from field app backups
- Direct restore guard: Season2 PWA field backups are rejected unless routed through migration/import
- Field app backup migration: Season2 PWA backup details/storageItems convert into phoneInstall DayRecord backups
- Weekly/monthly quantity comparison: miju, hils, and alternate delivery ratios
- App shell field import: field-app backup import action wired to migration copy mode
- App shell stats: weekly/monthly quantity ratios displayed
- Field import UX: recognized-date confirmation, safety snapshot notice, and persistent import result summary
- Preserved Season2 format support: `delivery-master-season2`, array exports, single-day exports, and summary-only exports
- Read-time repair for known malformed preserved-export JSON keys; source files are not modified
- Unpaid helper day flow: expected quantity `0` routes to helper-only close instead of zero-quantity zones
- Unpaid helper day finish supports direct finish time input and "finish now"
- Completed-zone post-edit correction: start/end times, sorting times, miju A/B counts, delivery count, failed count, and extra count can be corrected after close
- App shell Korean labels rebuilt for field testing
- Mobile layout stacks dense action/input groups for phone use
- Unpaid helper day close now ends the day instead of continuing into miju.
- Arrival now leads to field order selection: miju/hils, hils/miju, alternate/hils/miju, or hils/alternate/miju.
- Event recording is available during work for meals, vendor visits, return pickup, return loading, waiting, and other field issues.
- Zone-linked event minutes are separated from delivery time in calculation and daily report output.
- Numeric inputs use blank placeholders instead of misleading `0` defaults, with confirmation for unusually large quantities.
- Miju input now supports total-only entry plus optional separated 1-dong/2-dong/3-dong/rest detail entry.
- Miju A-section checkpoint save preserves 1/2/3-dong counts before the rest of miju is completed.
- Miju A-section checkpoint clear and live three-digit numeric limits are included before deployment.
- Completed-zone edit UI is split into time and quantity rows with visible saved-value summaries.
- Temporary GitHub Pages PWA field-test deployment is active at `owenyu9292/delivery-master-install`; it is not the final install-complete app.
- Field-app import auto-correction was deployed so an empty today shell is replaced by the imported record, while real records are protected as copies.
- Backup/export wording was clarified in the deployment: `스냅샷` became `백업 내보내기`.
- Current local service worker cache target after miju input fix: `delivery-master-install-v7`.
- Current deployment commit to reconcile with local source: `9a8b72b Deploy install app auto import correction`.

## In progress

- phone-first field UI refinement and field testing
- field testing field-app backup import and ratio display

## Recent updates

- 2026-05-25: Temporary PWA field-test deployment updated outside the original local source flow; local source and GitHub deployment output must be compared before the next implementation pass.
- 2026-05-25: Autosave rule clarified. Autosave means automatic save, safety backup, import correction, report/stat recalculation, and backup export where possible.
- 2026-05-25: Import correction rule clarified. Empty placeholder records may be replaced automatically; real records must never be overwritten silently and should become protected copies on conflict.
- 2026-05-25: User-facing goal clarified. The app is for drive time, delivery time, zone time, zone quantity, efficiency, and miju/hils/alternate quantity comparison, not a simple note log.
- 2026-05-26: Miju A-section joined-number input was replaced with separated 1/2/3-dong fields and optional checkpoint save.
- Document sync between plan and implementation completed.
- README, MODULE_PLAN, and TASKS were aligned with the current codebase state.
- backupImportExport was implemented and verified with domain tests.
- Rule noted: plan first, then update docs/state after every task.
- User requirement captured: phoneInstall must include automatic snapshots, explicit reset only, and recovery UI to prevent Season2-style data loss.
- legacyMigration was implemented and verified with domain tests.
- uiScreens was implemented and verified with domain tests.
- phoneInstall was implemented and verified with domain tests.
- Field requirement added: detect missing cleanup/sorting finish before zone/day close.
- Field requirement added: cleanup/sorting correction must support recommended 30 minutes and direct minute input.
- Field requirement updated: missed cleanup/sorting correction anchors to close/finish time, not original cleanup start time.
- `cleanupCorrection` was implemented and verified with domain tests.
- `deliveryCalc` now treats end-of-zone cleanup as non-delivery time.
- Static app shell was added in `src/app/main.ts` and `public/`.
- `npm run build` creates `dist/`.
- `npm run serve` serves the built app locally.
- `src/app/main.ts` was reorganized into a field ordered flow.
- Miju input now uses A/B counts.
- Hils input now uses delivery count plus cleanup minutes.
- The app now supports selected work order plus 대체배송/custom additions before close.
- Extra zones use the same delivery count and cleanup correction path as hils.
- Missing cleanup finish correction still anchors to close time minus entered minutes.
- Miju is the only zone that can close without sorting start/end.
- For hils, 대체배송, and custom zones, previous zone close is movement departure and sorting start is movement arrival.
- If that movement interval is 0 minutes, calculation uses a fixed 5 minute movement value.
- Development app backups now use `배송마스터_개발앱_백업_절대삭제금지.json`.
- Direct restore now accepts only `delivery-master-phone-install` / `day-record-store` backups.
- Season2 PWA backups with `delivery-master-season2-pwa` must enter through a future migration/import flow.
- `fieldAppMigration` converts Season2 PWA `details`, `days`, `currentState`, and `storageItems` into DayRecord records.
- `backupImportExport` can now build and import a phoneInstall backup from the field app migration result.
- Weekly/monthly stats now compare delivered quantities as `미주:힐스:대체배송지`.
- Quantity ratio uses delivered count totals and reduces by greatest common divisor, for example 60:30:10 -> 6:3:1.
- `src/app/main.ts` now shows weekly/monthly quantity ratio cards.
- `src/app/main.ts` now imports Season2 PWA field backups through migration copy mode after creating a safety snapshot.
- `src/app/main.ts` now shows recognized dates before import and keeps the latest import result visible after import/cancel/failure.
- `public/styles.css` now includes an import result panel.
- `public/sw.js` cache was bumped to refresh the installed app shell.
- `fieldAppMigration` now accepts preserved Season2 exports (`delivery-master-season2`) in addition to Season2 PWA exports (`delivery-master-season2-pwa`).
- `fieldAppMigration` now accepts array backup files, single-day `{ date, state }` files, and summary-only files with `summaries`.
- `src/app/main.ts` now retries JSON import with a narrow read-time repair for known malformed preserved-export keys.
- `src/app/main.ts` now treats expected quantity `0` as an unpaid helper day and skips miju/hils entry after arrival.
- `scripts/run-domain-tests.ts` now verifies unpaid helper days keep drive/helper time, support manual finish time, and stay active until finish is confirmed.
- `src/domain/zoneEdit.ts` now applies completed-zone post-edits to timeline events and clears stale zone count caches.
- `src/app/main.ts` now exposes completed-zone edit forms from each completed zone card and creates a safety snapshot before saving edits.
- `scripts/run-domain-tests.ts` now verifies completed-zone edits recalculate counts/times from timeline.
- `src/app/main.ts` was rewritten with readable Korean field labels for tomorrow's phone test.
- `public/styles.css` now stacks dense controls on narrow screens and adds completed-zone edit styling.
- `public/sw.js` cache was bumped to `delivery-master-install-v7` locally after the miju input fix.
- `npm run check` passed with 42/42 domain tests after browser-review fixes.
- `npm run build` passed.

## Next

1. Field-test the current temporary PWA deployment at `https://owenyu9292.github.io/delivery-master-install/`
2. Confirm phone refresh/app restart picks up service worker cache `delivery-master-install-v7` after deployment.
3. Verify imported field-app records replace empty today shells and do not leave the report at `0`.
4. Verify zone status, report, and weekly/monthly miju:hils:alternate comparisons match field sense.
5. Compare local source with deployment commit `9a8b72b` before the next coding pass.
6. Improve extra-zone and hils correction panels after field testing.
7. Repair or replace encoding-damaged SPEC.md, DECISIONS.md, BUGS.md, DATA_MIGRATION.md, and Korean report labels.

## Notes

- DayRecord.timeline stays the only business source of truth.
- Derived logs, reports, and counts must stay computed from timeline data.
- ZoneRecord.counts remains a cache, not source data.
- Every task should be planned first, then followed immediately by an update to the relevant docs/state.
- Use FIELD_REQUIREMENTS.md as the current reliable source for field-learned safety requirements.
- Field app backups and development app backups must use separate filenames, app ids, and backup types.
- Field app backups should enter the development app through a migration/import flow, not direct restore.
- The OpenClaw-side operating rule source is `C:\Codex55Workspace\OpenCloAIOrchestration\docs\15_FIELD_APP_AUTOSAVE_AUTOCORRECTION_RULE.md`; keep the same intent reflected here.
