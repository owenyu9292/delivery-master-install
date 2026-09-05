import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDayStore } from "../src/storage/sqliteDayStore";
import type { SqliteDriver, SqliteRow, SqliteValue } from "../src/storage/sqliteDriver";
import { sampleDayRecord } from "../test/fixtures/sample-day-record";
import type { BackupFile } from "../src/storage/dayStore";

const directory = mkdtempSync(join(tmpdir(), "delivery-sqlite-safety-"));
const filename = join(directory, "records.sqlite");
class FileDriver implements SqliteDriver {
  db!: DatabaseSync;
  async open() { this.db = new DatabaseSync(filename); }
  async beginTransaction() { this.db.exec("BEGIN TRANSACTION"); }
  async commitTransaction() { this.db.exec("COMMIT"); }
  async rollbackTransaction() { this.db.exec("ROLLBACK"); }
  async query(sql: string, values: SqliteValue[] = []): Promise<SqliteRow[]> { return this.db.prepare(sql).all(...values); }
  async run(sql: string, values: SqliteValue[] = [], transaction = true) {
    if (transaction) this.db.exec("BEGIN");
    try { this.db.prepare(sql).run(...values); if (transaction) this.db.exec("COMMIT"); }
    catch (error) { if (transaction) this.db.exec("ROLLBACK"); throw error; }
  }
  async execute(sql: string) { this.db.exec(sql); }
  async close() { this.db.close(); }
}
const day = (date: string, id = "day-" + date) => ({ ...structuredClone(sampleDayRecord), date, id });
const backup = (...days: typeof sampleDayRecord[]): BackupFile => ({ schemaVersion: 1, app: "delivery-master-phone-install", backupType: "day-record-store", exportedAt: new Date().toISOString(), scope: { kind: "all" }, days });
let driver = new FileDriver();
let store = new SqliteDayStore({ driver });
const original = day("2026-05-17");
const replacement = day("2026-05-17", "edited-first");
const second = day("2026-05-18");
await store.saveDay(original);
await driver.execute("CREATE TRIGGER fail_second BEFORE INSERT ON day_records WHEN NEW.date = '2026-05-18' BEGIN SELECT RAISE(ABORT, 'TEST_SQLITE_DISK_FAILURE'); END;");
await assert.rejects(store.importBackup(backup(replacement, second), { mode: "overwrite" }), /TEST_SQLITE_DISK_FAILURE/);
assert.deepEqual(await store.getDay(original.date), original);
assert.equal(await store.getDay(second.date), null);
await driver.close();
driver = new FileDriver(); store = new SqliteDayStore({ driver });
assert.deepEqual(await store.getDay(original.date), original, "reopen must not expose partially committed day");
assert.equal(await store.getDay(second.date), null);
await driver.execute("DROP TRIGGER fail_second");
await store.importBackup(backup(replacement, second), { mode: "overwrite" });
await driver.close();
driver = new FileDriver(); store = new SqliteDayStore({ driver });
assert.deepEqual(await store.getDay(original.date), replacement);
assert.deepEqual(await store.getDay(second.date), second);

// Uncommitted changes disappear on a closed connection, like an interrupted app process.
await driver.beginTransaction();
await driver.run("UPDATE day_records SET record_json = ? WHERE date = ?", [JSON.stringify(original), original.date], false);
await driver.close();
driver = new FileDriver(); store = new SqliteDayStore({ driver });
assert.deepEqual(await store.getDay(original.date), replacement);
await driver.run("INSERT INTO day_records VALUES (?, ?, ?, ?)", ["2026-05-19", "{broken", "", 1]);
await driver.run("INSERT INTO day_records VALUES (?, ?, ?, ?)", ["2026-05-20", "null", "", 1]);
assert.equal((await store.listDates()).filter(row => row.status === "reviewNeeded").length, 2);
await assert.rejects(store.getDay("2026-05-19"));
const raw = await store.createBackup();
assert.equal(raw.corruptDays?.length, 2);
assert.equal(raw.corruptDays?.find(row => row.date === "2026-05-19")?.rawCorruptJson, "{broken");
await store.importBackup(backup(day("2026-05-19")), { mode: "overwrite" });
assert.equal((await store.getDay("2026-05-19"))?.date, "2026-05-19");
assert.equal((await store.createBackup()).corruptDays?.length, 1);
await driver.close();
console.log(JSON.stringify({ passed: true, engine: "real SQLite file (not Android plugin)", checks: ["trigger second-write failure rollback", "reopen original unchanged", "successful import survives reopen", "uncommitted close rollback", "raw invalid JSON and null preserved", "targeted repair retains unrelated corruption"], artifacts: directory }));
