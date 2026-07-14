import { App } from "@capacitor/app";
import { Clipboard } from "@capacitor/clipboard";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { DocumentFile, type DocumentFilePluginContract } from "./nativeDocumentPlugin";
import type { ExportJsonResult, PickedTextFile, PlatformServices } from "./platformServices";

const SNAPSHOT_DIRECTORY = "backups";
const SNAPSHOT_RETENTION_COUNT = 5;

export class CapacitorPlatformServices implements PlatformServices {
  constructor(private readonly documentFile: DocumentFilePluginContract = DocumentFile) {}
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
      path: `${SNAPSHOT_DIRECTORY}/${filename}`,
      data: JSON.stringify(value, null, 2),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await pruneSnapshots();
  }

  async exportJson(value: unknown, filename: string): Promise<ExportJsonResult> {
    const result = await this.documentFile.saveJson({
      filename,
      text: JSON.stringify(value, null, 2),
    });
    return result.canceled
      ? { status: "cancelled", filename }
      : { status: "saved", filename, uri: result.uri };
  }

  async pickTextFile(): Promise<PickedTextFile | null> {
    const result = await this.documentFile.openJson();
    if (result.canceled) return null;
    if (!result.name || typeof result.text !== "string") {
      throw new Error("선택한 JSON 파일을 읽지 못했습니다.");
    }
    return { name: result.name, text: result.text };
  }

  async hardRefresh(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("Native refresh is not available in this runtime.");
    }
    window.location.reload();
  }
}

async function pruneSnapshots(): Promise<void> {
  try {
    const entries = await Filesystem.readdir({
      path: SNAPSHOT_DIRECTORY,
      directory: Directory.Data,
    });
    const files = entries.files
      .filter((entry) => entry.type === "file")
      .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    for (const entry of files.slice(SNAPSHOT_RETENTION_COUNT)) {
      await Filesystem.deleteFile({
        path: `${SNAPSHOT_DIRECTORY}/${entry.name}`,
        directory: Directory.Data,
      });
    }
  } catch (error) {
    console.warn("Internal backup rotation failed; the new snapshot is still preserved.", error);
  }
}