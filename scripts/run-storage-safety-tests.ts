import assert from "node:assert/strict";
import { assertPhoneInstallBackup } from "../src/storage/backupImportExport";
import { MemoryDayStore } from "../src/storage/memoryDayStore";
import { SqliteDayStore } from "../src/storage/sqliteDayStore";
import type { SqliteDriver, SqliteRow, SqliteValue } from "../src/storage/sqliteDriver";
import type { BackupFile } from "../src/storage/dayStore";
import { sampleDayRecord } from "../test/fixtures/sample-day-record";

class FaultInjectingDriver implements SqliteDriver {
  private readonly rows = new Map<string, SqliteRow>();
  private snapshot: Map<string, SqliteRow> | null = null;
  private opened = false;
  failOnRun: number | null = null;
  runCount = 0;
  beginCount = 0;
  rollbackCount = 0;

  seedRaw(dayRecord: unknown): void {
    const value = dayRecord as Record<string, any>;
    this.rows.set(String(value.date), {
      date: value.date,
      record_json: JSON.stringify(value),
      updated_at: value.meta?.updatedAt ?? "",
      schema_version: 1,
    });
  }

  seedRawValue(date: string, raw: unknown): void {
    this.rows.set(date, { date, record_json: raw, updated_at: "", schema_version: 1 });
  }

  async open(): Promise<void> { this.opened = true; }
  async close(): Promise<void> { this.opened = false; }
  async beginTransaction(): Promise<void> {
    this.beginCount += 1;
    this.snapshot = new Map([...this.rows.entries()].map(([key, row]) => [key, structuredClone(row)]));
  }
  async commitTransaction(): Promise<void> { this.snapshot = null; }
  async rollbackTransaction(): Promise<void> {
    this.rollbackCount += 1;
    if (!this.snapshot) return;
    this.rows.clear();
    this.snapshot.forEach((row, key) => this.rows.set(key, structuredClone(row)));
    this.snapshot = null;
  }
  async execute(statements: string): Promise<void> {
    assert.equal(this.opened, true);
    if (statements.includes("DELETE FROM day_records")) this.rows.clear();
  }
  async query(statement: string, values: SqliteValue[] = []): Promise<SqliteRow[]> {
    assert.equal(this.opened, true);
    if (statement.includes("WHERE date")) {
      const row = this.rows.get(String(values[0]));
      return row ? [structuredClone(row)] : [];
    }
    return [...this.rows.values()].map((row) => structuredClone(row));
  }
  async run(_statement: string, values: SqliteValue[] = []): Promise<void> {
    this.runCount += 1;
    if (this.failOnRun === this.runCount) throw new Error("injected sqlite write failure");
    this.rows.set(String(values[0]), {
      date: values[0], record_json: values[1], updated_at: values[2], schema_version: values[3],
    });
  }
}

function backup(...days: typeof sampleDayRecord[]): BackupFile {
  return {
    schemaVersion: 1,
    app: "delivery-master-phone-install",
    backupType: "day-record-store",
    exportedAt: "2026-05-17T12:00:00.000Z",
    scope: { kind: "all" },
    days: days.map((day) => structuredClone(day)),
  };
}

function day(date: string, id = `day-${date}`) {
  const out = structuredClone(sampleDayRecord);
  out.date = date;
  out.id = id;
  out.meta.updatedAt = `${date}T12:00:00.000Z`;
  return out;
}

const original = day("2026-05-17");
const driver = new FaultInjectingDriver();
const store = new SqliteDayStore({ driver });
await store.saveDay(original);

const malformed = structuredClone(original) as any;
malformed.timeline = [null];
await assert.rejects(() => store.importBackup(backup(malformed), { mode: "overwrite" }));
assert.deepEqual(await store.getDay(original.date), original, "malformed import must not alter the persisted day");

const replacement = day("2026-05-17", "replacement");
const second = day("2026-05-18");
driver.failOnRun = driver.runCount + 2;
await assert.rejects(() => store.importBackup(backup(replacement, second), { mode: "overwrite" }), /injected sqlite write failure/);
assert.deepEqual(await store.getDay(original.date), original, "rollback must restore an overwritten first date");
assert.equal(await store.getDay(second.date), null, "rollback must remove a later date written in the failed batch");
assert.equal(driver.rollbackCount, 1);

const corruptTarget = day("2026-05-24");
(corruptTarget as any).timeline = [null];
driver.seedRaw(corruptTarget);
assert.equal((await store.listDates()).find((item) => item.date === corruptTarget.date)?.status, "reviewNeeded");
await assert.rejects(() => store.getDay(corruptTarget.date));
const repaired = day(corruptTarget.date, "repaired");
const repairedResult = await store.importBackup(backup(repaired), { mode: "overwrite" });
assert.equal(repairedResult.imported.length, 1);
assert.equal((await store.getDay(corruptTarget.date))?.id, "repaired");

const unrelatedCorrupt = day("2026-05-25");
(unrelatedCorrupt as any).timeline = [null];
driver.seedRaw(unrelatedCorrupt);
const goodOtherDate = day("2026-05-26");
const mixedResult = await store.importBackup(backup(goodOtherDate), { mode: "overwrite" });
assert.equal(mixedResult.imported.length, 1);
assert.equal((await store.listDates()).find((item) => item.date === unrelatedCorrupt.date)?.status, "reviewNeeded");
await assert.rejects(() => store.getDay(unrelatedCorrupt.date));

driver.seedRawValue("2026-05-27", "{not-json");
driver.seedRawValue("2026-05-28", null);
const rawBackup = await store.createBackup();
assert.equal(rawBackup.corruptDays?.find((item) => item.date === "2026-05-27")?.rawCorruptJson, "{not-json");
assert.equal(rawBackup.corruptDays?.find((item) => item.date === "2026-05-28")?.rawCorruptJson, "null");
await assert.rejects(() => store.getDay("2026-05-27"));
await assert.rejects(() => store.getDay("2026-05-28"));
const rawRepair = await store.importBackup(backup(day("2026-05-27", "raw-repaired")), { mode: "overwrite" });
assert.equal(rawRepair.imported.length, 1);
assert.equal((await store.getDay("2026-05-27"))?.id, "raw-repaired");

const compatible = day("2026-05-19");
(compatible as any).extraFutureField = { preserved: true };
delete (compatible.meta as any).deviceId;
delete (compatible.meta as any).appVersion;
delete (compatible.meta as any).migrationSource;
compatible.timeline[0].at = "not-orderable-but-parseable";
compatible.timeline[4].payload = { total: 0, delivered: 99999, futureField: "kept" };
assert.doesNotThrow(() => assertPhoneInstallBackup(backup(compatible)));
const copiedSuffix = day("2026-05-19__copy_20260517120000_2");
assert.doesNotThrow(() => assertPhoneInstallBackup(backup(copiedSuffix)));
const malformedPayload = day("2026-05-19");
(malformedPayload.timeline[0] as any).payload = { total: {} };
await assert.rejects(() => store.importBackup(backup(malformedPayload), { mode: "overwrite" }), /invalid/);
await store.importBackup(backup(compatible), { mode: "overwrite" });
assert.equal((await store.getDay(compatible.date))?.timeline[4]?.payload && "total" in ((await store.getDay(compatible.date))?.timeline[4]?.payload as object), true);

const duplicateId = day("2026-05-20", "day-2026-05-21");
await assert.rejects(() => store.importBackup(backup(day("2026-05-21"), duplicateId), { mode: "overwrite" }), /id.*중복|duplicate/i);
const duplicateDate = day("2026-05-22");
await assert.rejects(() => store.importBackup(backup(duplicateDate, structuredClone(duplicateDate)), { mode: "overwrite" }), /중복 날짜|duplicate/i);

const memory = new MemoryDayStore([original]);
const missing = day("2026-05-23");
const skipped = await memory.importBackup(backup(original, missing), { mode: "skip" });
assert.equal(skipped.imported.length, 1);
assert.equal(skipped.skipped.length, 1);
assert.deepEqual(await memory.getDay(original.date), original);
const overwritten = await memory.importBackup(backup(day(original.date, "new-id")), { mode: "overwrite" });
assert.equal(overwritten.imported.length, 1);
assert.equal(overwritten.skipped.length, 0);

console.log("Storage safety tests passed: malformed=1 rollback=1 compatibility=1 duplicate=2 skip/overwrite counts=2");
