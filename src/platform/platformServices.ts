export interface PickedTextFile {
  name: string;
  text: string;
}

export interface PlatformServices {
  initialize(): Promise<void>;
  copyText(text: string): Promise<void>;
  exportJson(value: unknown, filename: string): Promise<void>;
  pickTextFile(): Promise<PickedTextFile | null>;
  hardRefresh(): Promise<void>;
}
