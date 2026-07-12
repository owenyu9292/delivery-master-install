import assert from "node:assert/strict";
import { BrowserPlatformServices } from "../src/platform/browserPlatform";

type MockFile = { name: string; text(): Promise<string> };

const originalGlobals = {
  navigator: globalThis.navigator,
  document: globalThis.document,
  window: globalThis.window,
  caches: globalThis.caches,
};

const updateCalls: string[] = [];
const unregisterCalls: string[] = [];
const deletedCaches: string[] = [];
const clickedLinks: HTMLAnchorElement[] = [];
const linkClicks: string[] = [];
const linkRemovals: string[] = [];
const createdUrls: string[] = [];
const revokedUrls: string[] = [];
let selectedFile: MockFile | null = { name: "backup.json", text: async () => '{"ok":true}' };
let replacedUrl = "";

const serviceWorker = {
  register: async (script: string, options: { updateViaCache: string }) => {
    assert.equal(script, "./sw.js");
    assert.equal(options.updateViaCache, "none");
    return { update: async () => updateCalls.push(script) };
  },
  getRegistrations: async () => [
    { unregister: async () => unregisterCalls.push("first") },
    { unregister: async () => unregisterCalls.push("second") },
  ],
};

const input = {
  type: "",
  accept: "",
  style: { display: "" },
  files: [] as MockFile[],
  listeners: new Map<string, () => void>(),
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  },
  click() {
    this.files = selectedFile ? [selectedFile] : [];
    this.listeners.get("change")?.();
  },
  remove() {},
};

const body = {
  appendChild(element: unknown) {
    if (element !== input) clickedLinks.push(element as HTMLAnchorElement);
  },
};

const documentMock = {
  body,
  createElement(tag: string) {
    if (tag === "input") return input;
    return {
      href: "",
      download: "",
      click() { linkClicks.push("clicked"); },
      remove() { linkRemovals.push("removed"); },
    };
  },
};

const cachesMock = {
  keys: async () => ["cache-a", "cache-b"],
  delete: async (key: string) => {
    deletedCaches.push(key);
    return true;
  },
};

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { serviceWorker, clipboard: { writeText: async (text: string) => assert.equal(text, "copied") } },
});
Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    caches: cachesMock,
    location: {
      href: "https://example.test/app",
      replace(url: string) {
        replacedUrl = url;
      },
    },
  },
});

const originalUrlMethods = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};
Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (value: Blob) => {
  const url = originalUrlMethods.createObjectURL(value);
  createdUrls.push(url);
  return url;
} });
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (url: string) => {
  revokedUrls.push(url);
  originalUrlMethods.revokeObjectURL(url);
} });

Object.defineProperty(globalThis, "caches", { configurable: true, value: cachesMock });
try {
  const platform = new BrowserPlatformServices();

  await platform.initialize();
  assert.deepEqual(updateCalls, ["./sw.js"]);

  await platform.copyText("copied");

  await platform.exportJson({ ok: true }, "backup.json");
  assert.equal(clickedLinks.length, 1);
  assert.equal(clickedLinks[0]?.download, "backup.json");
  assert.equal(linkClicks.length, 1);
  assert.equal(linkRemovals.length, 1);
  assert.equal(createdUrls.length, 1);
  assert.deepEqual(revokedUrls, createdUrls);

  assert.deepEqual(await platform.pickTextFile(), { name: "backup.json", text: '{"ok":true}' });
  selectedFile = null;
  assert.equal(await platform.pickTextFile(), null);

  await platform.hardRefresh();
  assert.deepEqual(unregisterCalls, ["first", "second"]);
  assert.deepEqual(deletedCaches, ["cache-a", "cache-b"]);
  assert.match(replacedUrl, /^https:\/\/example\.test\/app\?app-refresh=\d+$/);

  console.log("platform tests passed");
} finally {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalGlobals.navigator });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalGlobals.document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalGlobals.window });
  Object.defineProperty(globalThis, "caches", { configurable: true, value: originalGlobals.caches });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalUrlMethods.createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalUrlMethods.revokeObjectURL });
}
