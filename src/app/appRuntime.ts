import { Capacitor } from "@capacitor/core";
import { BrowserPlatformServices } from "../platform/browserPlatform";
import { CapacitorPlatformServices } from "../platform/capacitorPlatform";
import type { PlatformServices } from "../platform/platformServices";
import { CapacitorSqliteDriver } from "../storage/capacitorSqliteDriver";
import type { DayStore } from "../storage/dayStore";
import { IndexedDbDayStore } from "../storage/indexedDbAdapter";
import { SqliteDayStore } from "../storage/sqliteDayStore";

export interface AppRuntime {
  store: DayStore;
  platform: PlatformServices;
}

export function createBrowserRuntime(appVersion: string): AppRuntime {
  return {
    store: new IndexedDbDayStore({
      dbName: "delivery-master-install",
      storeName: "dayRecords",
      appVersion,
    }),
    platform: new BrowserPlatformServices(),
  };
}

export function createNativeRuntime(appVersion: string): AppRuntime {
  return {
    store: new SqliteDayStore({
      driver: new CapacitorSqliteDriver({ database: "delivery-master" }),
      appVersion,
    }),
    platform: new CapacitorPlatformServices(),
  };
}

export function createRuntimeForPlatform(appVersion: string, native: boolean): AppRuntime {
  return native
    ? createNativeRuntime(appVersion)
    : createBrowserRuntime(appVersion);
}

export function createAppRuntime(appVersion: string): AppRuntime {
  return createRuntimeForPlatform(appVersion, Capacitor.isNativePlatform());
}
