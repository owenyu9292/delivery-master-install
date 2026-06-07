import { buildUiScreens, type UiScreensBundle } from "../ui/uiScreens";
import {
  copyBackupImport,
  overwriteBackupImport,
  previewBackupImport,
} from "../storage/backupImportExport";
import type {
  BackupFile,
  BackupScope,
  DateSummary,
  DayStore,
  ImportOptions,
  ImportResult,
  ResetResult,
} from "../storage/dayStore";
import type { DayRecord } from "../domain/types";

export interface PhoneInstallDashboard {
  installMode: "phoneInstall";
  appVersion?: string;
  latestSummary: DateSummary | null;
  screens: UiScreensBundle | null;
  safetyRules: string[];
  recovery: PhoneInstallRecoveryPanel;
  update: PhoneInstallUpdatePanel;
  reset: PhoneInstallResetPanel;
}

export interface PhoneInstallRecoveryPanel {
  title: string;
  allowedModes: Array<ImportOptions["mode"]>;
  safetyRules: string[];
  note: string;
}

export interface PhoneInstallUpdatePanel {
  title: string;
  requiresAutomaticSnapshot: true;
  safetyRules: string[];
  defaultScope: BackupScope;
}

export interface PhoneInstallResetPanel {
  title: string;
  requiresExplicitConfirmation: true;
  safetyRules: string[];
  destructiveAction: "resetAll";
}

export interface PhoneInstallUpdatePlan {
  scope: BackupScope;
  snapshot: BackupFile;
  recoveryPreview: ImportResult;
  safetyRules: string[];
}

export interface PhoneInstallRecoveryRequest {
  file: BackupFile;
  mode?: ImportOptions["mode"];
}

export interface PhoneInstallResetRequest {
  confirmed: boolean;
  scope?: BackupScope;
}

export interface PhoneInstallResetPlan {
  confirmed: boolean;
  blocked: boolean;
  snapshot: BackupFile;
  reset?: ResetResult;
  reason?: string;
  safetyRules: string[];
}

export async function buildPhoneInstallDashboard(
  dayStore: DayStore,
  scope: BackupScope = { kind: "all" },
): Promise<PhoneInstallDashboard> {
  const { latestSummary, latestDay, history, summaries } = await loadLatestPhoneInstallData(dayStore);

  return {
    installMode: "phoneInstall",
    appVersion: latestDay?.meta.appVersion,
    latestSummary,
    screens: latestDay
      ? buildUiScreens({
          dayRecord: latestDay,
          history,
          dateSummaries: summaries,
          selectedDate: latestDay.date,
          monthKey: latestDay.date.slice(0, 7),
        })
      : null,
    safetyRules: buildSafetyRules(),
    recovery: buildRecoveryPanel(),
    update: buildUpdatePanel(scope),
    reset: buildResetPanel(),
  };
}

export async function preparePhoneInstallUpdate(
  dayStore: DayStore,
  scope: BackupScope = { kind: "all" },
): Promise<PhoneInstallUpdatePlan> {
  const snapshot = await dayStore.createBackup(scope);
  const recoveryPreview = await previewBackupImport(dayStore, snapshot);

  return {
    scope,
    snapshot,
    recoveryPreview,
    safetyRules: [
      "Automatic snapshot captured before update preparation.",
      "Recovery preview must be shown before update proceeds.",
      "No data should be dropped by update preparation.",
    ],
  };
}

export async function recoverPhoneInstall(
  dayStore: DayStore,
  request: PhoneInstallRecoveryRequest,
): Promise<ImportResult> {
  const mode = request.mode ?? "preview";

  if (mode === "copy") {
    return copyBackupImport(dayStore, request.file);
  }

  if (mode === "overwrite") {
    return overwriteBackupImport(dayStore, request.file);
  }

  return previewBackupImport(dayStore, request.file);
}

export async function performExplicitPhoneInstallReset(
  dayStore: DayStore,
  request: PhoneInstallResetRequest,
): Promise<PhoneInstallResetPlan> {
  const scope = request.scope ?? { kind: "all" };
  const snapshot = await dayStore.createBackup(scope);

  if (!request.confirmed) {
    return {
      confirmed: false,
      blocked: true,
      snapshot,
      reason: "explicit_confirmation_required",
      safetyRules: [
        "Reset always creates a snapshot first.",
        "Reset stays blocked until explicit confirmation is provided.",
        "No silent wipe on cancel, back, app switch, or restart.",
      ],
    };
  }

  const reset = await dayStore.resetAll();

  return {
    confirmed: true,
    blocked: false,
    snapshot,
    reset,
    safetyRules: [
      "Reset always creates a snapshot first.",
      "Reset only runs after explicit confirmation.",
      "Recovery UI remains available after reset.",
    ],
  };
}

function buildSafetyRules(): string[] {
  return [
    "Automatic snapshots are mandatory before destructive operations.",
    "Explicit reset only. No silent wipe on cancel, back, app switch, or restart.",
    "Recovery UI must remain visible before any destructive path proceeds.",
  ];
}

function buildRecoveryPanel(): PhoneInstallRecoveryPanel {
  return {
    title: "Recovery",
    allowedModes: ["preview", "copy", "overwrite"],
    safetyRules: [
      "Preview first when the target state is unclear.",
      "Copy mode must never overwrite existing dates.",
      "Overwrite mode should only be used after confirmation.",
    ],
    note: "Recovery uses backup files only. Live data is never treated as its own source of truth.",
  };
}

function buildUpdatePanel(scope: BackupScope): PhoneInstallUpdatePanel {
  return {
    title: "Update",
    requiresAutomaticSnapshot: true,
    safetyRules: [
      "Capture a backup before touching app state.",
      "Offer recovery preview before applying the update.",
    ],
    defaultScope: scope,
  };
}

function buildResetPanel(): PhoneInstallResetPanel {
  return {
    title: "Reset",
    requiresExplicitConfirmation: true,
    safetyRules: [
      "Reset must be confirmed explicitly by the user.",
      "Reset must be preceded by an automatic snapshot.",
    ],
    destructiveAction: "resetAll",
  };
}

async function loadLatestPhoneInstallData(dayStore: DayStore): Promise<{
  latestSummary: DateSummary | null;
  latestDay: DayRecord | null;
  history: DayRecord[];
  summaries: DateSummary[];
}> {
  const summaries = await dayStore.listDates();
  const history = await loadHistory(dayStore, summaries);
  const latestSummary = summaries[0] ?? null;
  const latestDay = latestSummary ? await dayStore.getDay(latestSummary.date) : null;

  return {
    latestSummary,
    latestDay,
    history,
    summaries,
  };
}

async function loadHistory(
  dayStore: DayStore,
  summaries: DateSummary[],
): Promise<DayRecord[]> {
  const days: DayRecord[] = [];

  for (const summary of summaries) {
    const day = await dayStore.getDay(summary.date);
    if (day) {
      days.push(day);
    }
  }

  return days;
}
