import assert from "node:assert/strict";
import { createRuntimeForPlatform } from "../src/app/appRuntime";
import { BrowserPlatformServices } from "../src/platform/browserPlatform";
import { CapacitorPlatformServices } from "../src/platform/capacitorPlatform";
import { IndexedDbDayStore } from "../src/storage/indexedDbAdapter";
import { SqliteDayStore } from "../src/storage/sqliteDayStore";

const originalIndexedDb = globalThis.indexedDB;

try {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {} as IDBFactory,
  });

  const browser = createRuntimeForPlatform("test", false);
  assert.ok(browser.store instanceof IndexedDbDayStore);
  assert.ok(browser.platform instanceof BrowserPlatformServices);

  const native = createRuntimeForPlatform("test", true);
  assert.ok(native.store instanceof SqliteDayStore);
  assert.ok(native.platform instanceof CapacitorPlatformServices);

  console.log("runtime selection tests passed");
} finally {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: originalIndexedDb,
  });
}
