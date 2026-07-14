import assert from "node:assert/strict";
import { SqliteDayStore } from "../src/storage/sqliteDayStore";
import type { SqliteDriver, SqliteRow, SqliteValue } from "../src/storage/sqliteDriver";
import { sampleDayRecord } from "../test/fixtures/sample-day-record";

class FakeSqliteDriver implements SqliteDriver {
  private readonly rows = new Map<string, SqliteRow>();
  private opened = false;
  async open(): Promise<void> { this.opened = true; }
  async close(): Promise<void> { this.opened = false; }
  async execute(statements: string): Promise<void> {
    assert.equal(this.opened, true);
    if (statements.includes("DELETE FROM day_records")) this.rows.clear();
  }
  async query(statement: string, values: SqliteValue[] = []): Promise<SqliteRow[]> {
    assert.equal(this.opened, true);
    if (statement.includes("COUNT(*)")) return [{ count: this.rows.size }];
    if (statement.includes("WHERE date")) {
      const row = this.rows.get(String(values[0]));
      return row ? [structuredClone(row)] : [];
    }
    return [...this.rows.values()].map((row) => structuredClone(row));
  }
  async run(_statement: string, values: SqliteValue[] = []): Promise<void> {
    assert.equal(this.opened, true);
    this.rows.set(String(values[0]), {
      date: values[0], record_json: values[1], updated_at: values[2], schema_version: values[3],
    });
  }
}

const first = structuredClone(sampleDayRecord);
const second = structuredClone(sampleDayRecord);
second.date = "2026-05-18";
second.meta.updatedAt = "2026-05-18T10:00:00.000Z";
const driver = new FakeSqliteDriver();
const store = new SqliteDayStore({ driver });

const created = await store.saveDay(first);
assert.equal(created.created, true);
assert.equal((await store.saveDay(first)).created, false);
await store.saveDay(second);
assert.deepEqual((await store.getDay(first.date))?.date, first.date);
assert.deepEqual((await store.listDates()).map((item) => item.date), [second.date, first.date]);

const allBackup = await store.createBackup();
assert.equal(allBackup.days.length, 2);
assert.equal((await store.createBackup({ kind: "date", date: first.date })).days.length, 1);
const preview = await store.importBackup({ ...allBackup, days: [first] }, { mode: "preview" });
assert.equal(preview.preview, true);
assert.equal(preview.skipped.length, 1);
const skip = await store.importBackup({ ...allBackup, days: [first] }, { mode: "skip" });
assert.equal(skip.imported.length, 0);
assert.equal(skip.skipped[0]?.reason, "existing_day_preserved");const copy = await store.importBackup({ ...allBackup, days: [first] }, { mode: "copy" });
assert.equal(copy.imported.length, 1);
assert.notEqual(copy.imported[0]?.date, first.date);
const overwrite = await store.importBackup({ ...allBackup, days: [first] }, { mode: "overwrite" });
assert.equal(overwrite.imported.length, 1);
assert.deepEqual((await store.resetAll()).clearedCount, 3);
assert.deepEqual(await store.listDates(), []);
await driver.close();
console.log("SQLiteDayStore tests passed");
