export interface PickedTextFile {
  name: string;
  text: string;
}

export interface ExportJsonResult {
  status: "saved" | "cancelled";
  filename: string;
  uri?: string;
}

export interface PlatformServices {
  initialize(onBack?: () => boolean | Promise<boolean>): Promise<void>;
  copyText(text: string): Promise<void>;
  saveJsonSnapshot(value: unknown, filename: string): Promise<void>;
  exportJson(value: unknown, filename: string): Promise<ExportJsonResult>;
  pickTextFile(): Promise<PickedTextFile | null>;
  hardRefresh(): Promise<void>;
}
