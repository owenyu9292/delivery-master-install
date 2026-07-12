import { App } from "@capacitor/app";
import { Clipboard } from "@capacitor/clipboard";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { PickedTextFile, PlatformServices } from "./platformServices";

export class CapacitorPlatformServices implements PlatformServices {
  async initialize(): Promise<void> {
    await App.addListener("backButton", () => {
      void App.exitApp();
    });
  }

  async copyText(text: string): Promise<void> {
    await Clipboard.write({ string: text });
  }

  async saveJsonSnapshot(value: unknown, filename: string): Promise<void> {
    await Filesystem.writeFile({
      path: `backups/${filename}`,
      data: JSON.stringify(value, null, 2),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async exportJson(value: unknown, filename: string): Promise<void> {
    const result = await Filesystem.writeFile({
      path: filename,
      data: JSON.stringify(value, null, 2),
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: "백업 파일 저장 또는 공유",
    });
  }

  async pickTextFile(): Promise<PickedTextFile | null> {
    if (typeof document === "undefined") return null;
    const file = await pickJsonFile();
    return file ? { name: file.name, text: await file.text() } : null;
  }

  async hardRefresh(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("Native refresh is not available in this runtime.");
    }
    window.location.reload();
  }
}

function pickJsonFile(): Promise<File | null> {
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
