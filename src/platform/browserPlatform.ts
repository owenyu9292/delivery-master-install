import type { PlatformServices, PickedTextFile } from "./platformServices";

export class BrowserPlatformServices implements PlatformServices {
  async initialize(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none",
      });
      await registration.update();
    } catch (error) {
      console.warn("Service worker registration failed; app boot continues.", error);
    }
  }

  async copyText(text: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API is not available in this browser.");
    }

    await navigator.clipboard.writeText(text);
  }

  async exportJson(value: unknown, filename: string): Promise<void> {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      throw new Error("File export is not available in this runtime.");
    }

    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async pickTextFile(): Promise<PickedTextFile | null> {
    if (typeof document === "undefined") {
      return null;
    }

    const file = await pickFile();
    return file ? { name: file.name, text: await file.text() } : null;
  }

  async hardRefresh(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("Hard refresh is not available in this runtime.");
    }

    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.warn("Hard refresh cache cleanup failed; forcing reload anyway.", error);
    }

    const url = new URL(window.location.href);
    url.searchParams.set("app-refresh", String(Date.now()));
    window.location.replace(url.toString());
  }
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.click();
  });
}
