# Field Requirements

Last updated: 2026-05-25

## 00. Operating Rule: Report Before Action

All implementation work must report the intended change before execution and wait for approval. This includes code edits, file/folder creation, documentation updates, GitHub upload, commits, pushes, deployments, and fallback-path choices.

If the intended folder, repository, or permission is missing, stop and ask the user. Do not create a different lower-level folder or alternate route without approval.

This file is the handoff point between the temporary Season2 PWA field version and the formal phoneInstall build.

## Product Split

### Season2 PWA

Season2 PWA is the temporary field-use version.

- Location: `C:\Codex55Workspace\delivery-master\season2`
- Purpose: urgent field stability and GitHub Pages/PWA use
- Owner flow: field hotfixes may happen quickly, but every change must be documented
- Role: field test source and emergency fallback, not the final install architecture

### phoneInstall

phoneInstall is the formal installable version.

- Location: `C:\#WORKSPACE\AI_HUB\AI_WORKSPACE\PROJECTS\delivery-master-install`
- Source of truth: `DayRecord.timeline`
- Goal: stable installable field app
- Current status: core modules, legacyMigration, uiScreens, phoneInstall, backup/import/export are implemented
- Current deployment note: `owenyu9292/delivery-master-install` is a temporary PWA field-test deployment, not the final install-complete build.
- Next work: reconcile temporary deployment changes, then continue integration wiring / packaging.

## Required Field Learnings To Carry Into phoneInstall

### 0.2 Temporary PWA Deployment And Autosave Rule From 2026-05-25

Current deployment status:

- `owenyu9292/delivery-master-install` is a temporary PWA field-test deployment.
- It is not the final phoneInstall completion target.
- Deployment commit to reconcile: `9a8b72b Deploy install app auto import correction`.
- Service worker cache target: `delivery-master-install-v7`.
- The local source folder is not a git repository, so local source and GitHub deployment output must be compared before the next implementation pass.

Product purpose:

- The app is not a simple daily note log.
- The app must expose drive time, delivery time, zone time, zone quantity, quantity-based efficiency, and weekly/monthly miju/hils/alternate-delivery quantity comparison.

Autosave/autocorrection rule:

- Autosave means automatic save, safety backup, import correction, report/stat recalculation, and backup export where possible.
- During field work, the user must not have to manually inspect hidden copies, choose dates, or remember export steps for ordinary safe recovery.
- Confirmation is required for destructive overwrite/delete choices.
- Safe correction should be automatic where possible.

Field-app import rule:

- If the target date does not exist, import directly.
- If the target date exists only as an empty draft shell, replace it automatically.
- If the target date has real timeline, zone, helper, or adjustment data, never overwrite it silently.
- In real-data conflict, create a protected copy instead.
- After import, switch the visible screen to the imported day when possible.
- Before and after high-risk import, create/export a recovery backup when the browser allows it.
- If browser download is blocked, keep internal data safe and show the import result clearly.

Reference operating document:

- `C:\Codex55Workspace\OpenCloAIOrchestration\docs\15_FIELD_APP_AUTOSAVE_AUTOCORRECTION_RULE.md`

### 0.3 Miju A-Section Input Fix From 2026-05-26

Confirmed field issue:

- Joined A-section input such as `050609` is unsafe on mobile.
- The browser can normalize or mix numeric input in a way that produces impossible quantities.
- Large-number confirmation is only a final guard and does not remove the field stress.

phoneInstall requirement:

- Miju must allow total-only entry for small or rushed days.
- Miju detail entry must be optional.
- If detail entry is used, split it into independent fields:
  - 1-dong
  - 2-dong
  - 3-dong
  - rest of miju
- Each field uses numeric text input, not joined number parsing.
- Each field is limited to 3 digits.
- No automatic focus movement.
- No automatic zero padding.
- A-section can be saved as a checkpoint before the rest of miju is completed.
- Miju completion uses detailed sum when detail exists; otherwise it uses total-only entry.

### 0.1 Field Test Fixes From 2026-05-25

Confirmed field issues:

- Unpaid helper flow recognized `0` at departure, but after finish it could continue into the miju workflow.
- The app forced miju before hils, even when the truck loading order required hils first.
- Alternate delivery may also need to happen before miju or hils.
- Field events such as meals, vendor visits, return pickup, return loading, waiting, and facility issues need direct recording instead of manual time guessing.
- Numeric inputs showing `0` by default caused mistaken entries such as `20233`.
- Very large accidental quantities were accepted without confirmation.
- Completed-zone edit controls were too dense on mobile.

Implemented response:

- Closed unpaid helper days are now rendered as finished before any zone workflow is considered.
- After arrival, the user chooses the day's work order, including alternate-delivery-first options.
- In-work event recording is available with explicit location/scope selection.
- Zone-linked event minutes are separated from delivery minutes.
- Numeric inputs now use blank placeholders and large-number confirmation.
- Completed-zone edit UI now separates time and quantity rows and shows the saved quantity summary.

### 0. Unpaid Helper Day Flow

Confirmed field issue:

- A 4-week routine can include unpaid helper days.
- The app must not assume those days are automatically recorded.
- Expected quantity `0` means an unpaid helper day, not a normal delivery day with zero-quantity zones.
- Drive minutes still matter because they are tied to field cost/fuel tracking.

phoneInstall requirement:

- Expected quantity `0` should route to a separate unpaid-helper flow.
- Record Jinjeop departure and Cheongnyangni arrival normally.
- After arrival, do not enter miju/hils zone entry.
- Show a single work-finish action for the user to press when helper work actually ends.
- The finish action must support both "finish now" and a directly entered finish time.
- If finish is not pressed, keep the day as in-progress and prompt for finish recovery on resume.
- When finish is confirmed:
  - close the day
  - keep `zones: []`
  - add an unpaid helper record/event
  - preserve drive minutes
  - preserve helper minutes as arrival-to-finish
  - report total quantity `0`
  - do not calculate delivery efficiency

### 1. No Silent Data Loss

Confirmed field issue:

- Resume/cancel/back/app switch/restart can confuse the user and must never wipe existing work silently.

phoneInstall requirement:

- Automatic snapshots before destructive or risky operations
- Explicit reset only
- Recovery UI must be visible before destructive reset paths
- Cancel/back/app switch/restart must preserve the current day record

### 2. Missing Cleanup Finish Correction

Confirmed field issue:

- The user often starts cleanup/sorting but forgets to press cleanup finish.
- This can make the whole zone look like cleanup time.
- It can produce `0 min` delivery time or invalid efficiency.
- Manual JSON repair then becomes necessary.

phoneInstall requirement:

- Before zone close or day close, detect `sorting_start` without `sorting_end`.
- Do not silently close the zone in that state.
- Offer correction choices:
  - Apply recommended 30 minutes
  - Directly enter cleanup/sorting minutes
  - Treat as no cleanup/sorting
  - Cancel and return to work
- 30 minutes is only the default recommendation, not a fixed value.
- User-entered minutes always take priority.
- Missing cleanup/sorting correction uses the close/finish time as the anchor:
  - sorting end = zone close or day close time
  - sorting start = sorting end - user-entered minutes
  - this matches the real field case where the missed cleanup finish is noticed at the end or just before the end
- After correction, recalculate:
  - sorting start/end
  - delivery start
  - zone elapsed time
  - delivery minutes
  - actual efficiency
  - total efficiency
  - corrected/event-adjusted efficiency
  - report text
  - backup/export data

Suggested correction model:

```ts
type CleanupCorrection = {
  status: "completed" | "pending" | "estimated" | "skipped";
  zoneId: string;
  sortingStartEventId?: string;
  sortingEndEventId?: string;
  suggestedMinutes: 30;
  userMinutes?: number;
  source: "normal" | "zone_close_prompt" | "day_close_prompt" | "post_edit";
  note?: string;
};
```

Implementation note:

- In the timeline model, the correction should become a corrected `sorting_start`/`sorting_end` window plus a `manual_adjust` or adjustment note.
- The UI may keep a pending state, but calculations and reports must derive from timeline events.

### 2B. Completed Zone Post-Edit Correction

Confirmed field issue:

- Wrong quantity, finish time, or sorting time may be discovered after a zone has already been closed.
- Manual JSON repair is too expensive during field work.

phoneInstall requirement:

- Completed zones must expose a post-edit path.
- Edits must update timeline events, not derived report text.
- Before saving an edit, create an automatic safety snapshot.
- Supported corrections:
  - zone start time
  - zone end time
  - sorting start and sorting end for non-miju zones
  - miju A/B counts
  - non-miju delivered count
  - failed count
  - extra count
- After saving, clear stale count caches and recalculate reports/statistics from `DayRecord.timeline`.
- Mark the day as review-needed after a completed-zone edit.

### 3. PWA Hotfix Documentation Rule

If Season2 PWA receives a field hotfix, record it before phoneInstall work continues.

Minimum record:

- Date/time
- Field symptom
- Modified files
- Patch summary
- Test result
- Whether phoneInstall must carry the behavior

### 4. Field Zone Flexibility And Work Order

Confirmed field need:

- The normal day often includes miju and hils, but the actual field order changes with truck loading and route conditions.
- Hils may need to happen before miju.
- 대체배송 may need to happen before miju or hils, not only after hils.
- 대체배송 must be quick to add during the day.
- A named temporary/custom zone must also be possible when the field situation does not match the fixed route.

phoneInstall requirement:

- After arrival, ask the user to choose today's work order.
- Include at least:
  - miju -> hils
  - hils -> miju
  - alternate -> hils -> miju
  - hils -> alternate -> miju
- Still allow:
  - 대체배송 추가
  - named custom 구역 추가
  - 추가 없이 업무 종료
- Extra zones must be stored as normal `ZoneRecord` entries and normal timeline events.
- Extra zones must participate in calculation, report, backup/export, and cleanup correction.
- Only one extra zone should be active at a time in the field UI.

### 5. Non-Miju Sorting And Movement Rule

Confirmed field rule:

- Miju is the exception and can be handled with A/B counts.
- Every non-miju zone needs sorting start and sorting end.
- The previous zone close time is the movement departure time.
- The current zone sorting start time is the movement arrival time.
- If departure-to-arrival is recorded as 0 minutes, use a fixed 5 minute movement value.

phoneInstall requirement:

- Block non-miju zone close until sorting start and sorting end exist.
- Show sorting start and sorting end controls for hils, 대체배송, and custom zones.
- Derive movement minutes from previous zone close to current sorting start.
- Use 5 minutes when the derived movement interval is under 1 minute.
- Clamp sorting end so it cannot be earlier than sorting start.
- Subtract movement minutes from delivery minutes so movement does not inflate delivery efficiency.
- If delivery time is under one minute, show efficiency as unavailable instead of an inflated per-hour value.

### 6. Backup Separation And Field-App Migration

Confirmed field need:

- Season2 PWA can lose localStorage data during field use.
- The field app and the development app may both use the Downloads folder.
- Their backup files must never be confused.

Required backup identifiers:

- Field app filename: `배송마스터_현장앱_백업_절대삭제금지.json`
- Field app `app`: `delivery-master-season2-pwa`
- Field app `backupType`: `full-localStorage`
- Development app filename: `배송마스터_개발앱_백업_절대삭제금지.json`
- Development app `app`: `delivery-master-phone-install`
- Development app `backupType`: `day-record-store`

phoneInstall requirement:

- Reject direct restore of field-app backups into the development app unless the user chooses a migration/import path.
- Provide a future "field app backup import" flow that converts Season2 PWA `storageItems`, `details`, `days`, `logsByDate`, and reports into `DayRecord.timeline`.
- Accept preserved field-app exports from the original preservation app (`delivery-master-season2`) through the same migration/import path.
- Accept field-app export variants found in the field: array files, single-day `{ date, state }` files, and summary-only files.
- If a preserved export has the known malformed key pattern, repair it only while reading the file; do not modify the original backup file.
- Keep direct restore for development-app backups only.
- Keep migration from field-app backups auditable and reviewable.

## Current Verification

2026-05-23:

- Preserved field-app export id `delivery-master-season2` is recognized as a migration source.
- Season2 PWA export id `delivery-master-season2-pwa` remains recognized as a migration source.
- Array exports, single-day exports, and summary-only exports are accepted by `fieldAppMigration`.
- Known malformed preserved-export JSON keys are repaired at read time in the app import path.
- Source backup files are not modified by the repair/import flow.
- `npm run check` passed with 35/35 domain tests.
- `npm run build` passed.

2026-05-24:

- Unpaid helper day requirement added.
- Expected quantity `0` is a helper-only workday, not a normal zero-quantity zone day.
- The flow preserves departure, arrival, drive minutes, and finish time.
- Helper minutes are arrival-to-finish.
- Delivery efficiency is not calculated for unpaid helper days.
- Finish time direct input and unfinished-helper recovery requirements were added.
- Completed-zone post-edit correction was added to the development app.
- `src/domain/zoneEdit.ts` updates completed-zone timeline events and clears stale zone count caches.
- `src/app/main.ts` creates a safety snapshot before saving a completed-zone edit.
- App shell Korean labels were rebuilt for field testing.
- Mobile layout now stacks dense action/input groups on narrow screens.
- `npm run check` later reached 40/40 domain tests after event-minute coverage was added.
- `npm run build` passed.

2026-05-25:

- Temporary PWA field-test deployment was updated outside the original local source flow.
- Field-app backup import now auto-corrects an empty today shell into the imported record.
- Existing real records are protected and should be copied instead of silently overwritten.
- Backup/export wording was clarified in the deployed UI.
- Service worker cache target is `delivery-master-install-v7`.
- Deployment commit: `9a8b72b Deploy install app auto import correction`.
- Next worker must compare local source and deployment output before continuing implementation.

2026-05-26:

- Miju A-section joined-number input was replaced locally with separated 1-dong/2-dong/3-dong fields.
- Miju total-only entry remains available.
- Miju A-section checkpoint save was added so counts survive before miju is fully closed.
- Miju A-section checkpoint can be cleared, and miju numeric fields are limited while typing to prevent four-plus-digit mobile input.
- Completed-zone miju edit supports the same separated detail fields.
- `npm run check` passed with 42/42 domain tests after browser-review fixes.

2026-05-22:

- Direct restore guard is implemented for phoneInstall backups.
- Development app backup filename constant: `배송마스터_개발앱_백업_절대삭제금지.json`
- Development app backup id/type: `delivery-master-phone-install` / `day-record-store`
- Field app backups with `delivery-master-season2-pwa` are rejected from direct restore and reserved for migration/import.
- Field app backup migration is implemented in `src/domain/fieldAppMigration.ts`.
- Migration collects Season2 PWA `details`, `days`, `currentState`, and `storageItems`.
- Migration converts field-app state/results into phoneInstall DayRecord.timeline, ZoneRecord, counts, sorting windows, and day close events.
- Weekly/monthly stats compare delivered quantities as `미주:힐스:대체배송지`.
- Quantity ratio uses delivered count totals and reduces by greatest common divisor, for example 60:30:10 -> 6:3:1.
- Daily reports do not include this ratio because daily variance is too noisy for the current field use case.
- App shell displays weekly/monthly quantity ratio cards.
- App shell includes a field-app backup import action.
- Field-app backup import uses migration copy mode after creating a safety snapshot, so existing days are not overwritten by default.
- Field-app backup import confirms recognized dates before import and leaves a visible result summary after import, cancel, or failure.
- `npm run check` passed with 34/34 domain tests.
- `npm run build` passed.

2026-05-20:

- `npm run check` passed
- `30/30 domain tests passed`
- `npm run build` passed
- Static app shell preview served locally during early implementation.
- App shell separated miju/hils input flows, supports 대체배송/custom zones, and applies non-miju movement correction. Later field updates added explicit work-order selection.

## Documentation Risk

`SPEC.md`, `DECISIONS.md`, and `BUGS.md` currently show encoding damage in this workspace. Until they are repaired, use these files as the reliable handoff set:

- `README.md`
- `MODULE_PLAN.md`
- `TASKS.md`
- `FIELD_REQUIREMENTS.md`
